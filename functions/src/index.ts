import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentUpdated, onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { mirrorTicketSummary as mirrorTicketSummaryDoc } from "./ticket-summary.js";
import { defineSecret } from "firebase-functions/params";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
    loadMailboxConfigs,
    getCachedMailboxConfigs,
    recordMailboxSync,
    MAILBOXES_COLLECTION,
    type MailboxConfig,
    type MailboxRoute,
} from "./mailboxes.js";
import * as admin from "firebase-admin";
import { getStorage } from "firebase-admin/storage";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

const GMAIL_SERVICE_ACCOUNT_KEY = defineSecret("GMAIL_SERVICE_ACCOUNT_KEY");

admin.initializeApp();

const BASE_URL = "https://crm.nis-egypt.com";
const DEFAULT_SENDER_EMAIL = "info@nis-egypt.com";

type ResolvedRouting = {
    selectedRoute: MailboxRoute | null;
    schoolName: string | null;
    divisionName: string | null;
    gradeName: string | null;
    schools: string[];
    divisions: string[];
    allowedGrades: string[];
};

function normalizeMessageId(value?: string | null): string | null {
    if (!value) return null;
    return value.trim().replace(/^<|>$/g, "");
}

function parseReferences(value?: string | null): string[] {
    if (!value) return [];
    return value
        .split(/\s+/)
        .map((v) => normalizeMessageId(v))
        .filter((v): v is string => Boolean(v));
}

function generateRandom4Digit(): number {
    return Math.floor(1000 + Math.random() * 9000);
}

function isWorkingTime(workingHours: any): boolean {
    if (!workingHours) return true;

    const now = new Date();

    const dayName = new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        timeZone: "Africa/Cairo",
    }).format(now);

    const currentTimeStr = new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Africa/Cairo",
    }).format(now);

    const config = workingHours[dayName];

    if (!config || !config.isOpen) return false;

    return currentTimeStr >= config.start && currentTimeStr <= config.end;
}

function getWorkingHoursSummary(workingHours: any): string {
    if (!workingHours) return "24/7";

    const days = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
    ];

    const summaries = days
        .filter((day) => workingHours[day] && workingHours[day].isOpen)
        .map(
            (day) =>
                `${day.substring(0, 3)}: ${workingHours[day].start}-${workingHours[day].end}`
        );

    return summaries.length > 0 ? summaries.join(", ") : "Closed";
}

function replacePlaceholders(text: string, ticket: any, dept: any): string {
    const submittedAt = ticket.createdAt
        ? ticket.createdAt instanceof admin.firestore.Timestamp
            ? ticket.createdAt.toDate()
            : new Date(ticket.createdAt)
        : new Date();

    return String(text || "")
        .replace(
            /{{userName}}/g,
            ticket.parentName || ticket.createdBy?.name || "User"
        )
        .replace(/{{ticketId}}/g, String(ticket.ticketNumber || ""))
        .replace(
            /{{departmentName}}/g,
            ticket.departmentName || ticket.categoryName || ""
        )
        .replace(/{{subject}}/g, ticket.subject || "")
        .replace(
            /{{submittedAt}}/g,
            submittedAt.toLocaleString("en-US", {
                timeZone: "Africa/Cairo",
            })
        )
        .replace(
            /{{workingHours}}/g,
            getWorkingHoursSummary(dept?.workingHours)
        );
}

function escapeHtml(value: string): string {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function wrapInProfessionalTemplate(
    title: string,
    subtitle: string,
    greeting: string,
    content: string,
    ticketUrl: string,
    ticketId: string,
    subject: string
): string {
    void ticketId;

    return `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background-color: #1e3a8a; color: white; padding: 24px; text-align: center;">
            <h1 style="margin: 0; font-size: 22px;">${escapeHtml(title)}</h1>
            <p style="margin: 4px 0 0 0; opacity: 0.8; font-size: 14px;">${escapeHtml(subtitle)}</p>
        </div>
        <div style="padding: 40px 30px; line-height: 1.6; color: #334155;">
            <p>Hello <strong>${escapeHtml(greeting)}</strong>,</p>
            <p>Update regarding: <strong>"${escapeHtml(subject)}"</strong></p>
            <div style="background-color: #f8fafc; padding: 24px; border-left: 4px solid #1e3a8a; border-radius: 4px; margin: 24px 0; white-space: pre-wrap;">${escapeHtml(content)}</div>
            <div style="text-align: center; margin: 40px 0;">
                <a href="${escapeHtml(ticketUrl)}" style="background-color: #1e3a8a; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold;">View Details</a>
            </div>
        </div>
    </div>
    `;
}

function encodeRawEmail(rawMessage: string): string {
    return Buffer.from(rawMessage)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

async function createGmailClient(
    key: any,
    senderEmail: string,
    scopes: string[]
): Promise<any> {
    // Dynamic import keeps the heavy googleapis package out of Firebase's
    // deployment-time module initialization path.
    const { google } = await import("googleapis");

    const auth = new google.auth.JWT({
        email: key.client_email,
        key: key.private_key,
        scopes,
        subject: senderEmail,
    });

    return google.gmail({
        version: "v1",
        auth,
    });
}

/**
 * Staging only: recipients that may receive real emails from the test environment
 * (testers using their own address as the "parent"). Comma-separated in
 * STAGING_EMAIL_ALLOWLIST. Everyone else is redirected to STAGING_EMAIL_REDIRECT_TO,
 * so a real parent can never be emailed from staging. Production passes no redirect
 * and is unaffected.
 */
const STAGING_EMAIL_ALLOWLIST = new Set(
    String(process.env.STAGING_EMAIL_ALLOWLIST || "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
);

function plainAddress(value: string): string {
    const match = String(value || "").match(/<([^>]+)>/);
    return (match ? match[1] : String(value || "")).trim().toLowerCase();
}

async function sendHtmlEmail(args: {
    key: any;
    senderEmail: string;
    to: string;
    subject: string;
    html: string;
    fromName?: string;
    extraHeaders?: string[];
    redirectTo?: string;
}): Promise<void> {
    const gmail = await createGmailClient(
        args.key,
        args.senderEmail,
        ["https://www.googleapis.com/auth/gmail.send"]
    );

    // redirectTo is only set by the staging functions.
    const allowDirect = Boolean(args.redirectTo) && STAGING_EMAIL_ALLOWLIST.has(plainAddress(args.to));
    const recipient = args.redirectTo && !allowDirect ? args.redirectTo : args.to;
    if (args.redirectTo) {
        console.log(
            allowDirect
                ? `STAGING EMAIL delivered directly to allow-listed ${args.to}`
                : `STAGING EMAIL for ${args.to} redirected to ${args.redirectTo} (not in STAGING_EMAIL_ALLOWLIST)`
        );
    }

    const rawMessage = [
        `From: ${args.fromName || "NIS CRM Support"} <${args.senderEmail}>`,
        `To: ${recipient}`,
        `Subject: ${args.redirectTo ? `[STAGING] ${args.subject}` : args.subject}`,
        ...(args.extraHeaders || []).filter(Boolean),
        "MIME-Version: 1.0",
        "Content-Type: text/html; charset=UTF-8",
        "",
        args.html,
    ].join("\r\n");

    await gmail.users.messages.send({
        userId: "me",
        requestBody: {
            raw: encodeRawEmail(rawMessage),
        },
    });
}

/** Resolve sender for form-created tickets using the same mailbox definitions
 * used by the Gmail synchronization process. Fail closed on missing/ambiguous
 * routes instead of sending as the wrong department or campus. */
async function getSenderMailbox(
    ticket: any,
    db: admin.firestore.Firestore = admin.firestore()
): Promise<string> {
    // Tickets received by email must reply from their original inbox.
    if (ticket?.originalRecipientEmail) return ticket.originalRecipientEmail;

    const department = normalizeRoutingText(ticket?.departmentName || ticket?.categoryName || "");
    const campusId = String(ticket?.campusId || "");
    const candidates = (await getCachedMailboxConfigs(db)).filter((mailbox) =>
        mailbox.enabled !== false &&
        normalizeRoutingText(mailbox.department) === department &&
        (!mailbox.campusId || mailbox.campusId === campusId)
    );

    // Campus-specific mailboxes must take precedence over department-wide ones.
    const scoped = candidates.filter((mailbox) => mailbox.campusId === campusId);
    const pool = scoped.length ? scoped : candidates.filter((mailbox) => !mailbox.campusId);

    const matching = pool.filter((mailbox) => {
        if (!mailbox.routes?.length) return true;
        return mailbox.routes.some((route) =>
            normalizeRoutingText(route.school) === normalizeRoutingText(ticket?.schoolName || "") &&
            normalizeRoutingText(route.division) === normalizeRoutingText(ticket?.divisionName || ticket?.division || "") &&
            route.grades.some((grade) =>
                normalizeRoutingText(grade) === normalizeRoutingText(ticket?.gradeName || ticket?.grade || "")
            )
        );
    });

    // More than one match needs explicit routing configuration, not guesswork.
    const uniqueEmails = Array.from(new Set(matching.map((mailbox) => mailbox.email.toLowerCase())));
    if (uniqueEmails.length === 1) return matching[0].email;
    console.warn("SENDER_MAILBOX_UNRESOLVED", {
        ticketNumber: ticket?.ticketNumber,
        department: ticket?.departmentName,
        campusId,
        school: ticket?.schoolName,
        division: ticket?.divisionName,
        grade: ticket?.gradeName,
        matches: uniqueEmails.length,
    });
    // Use the organization's standard verified sender, never a random mailbox.
    return DEFAULT_SENDER_EMAIL;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return Array.from(
        new Set(
            values
                .filter((value): value is string => Boolean(value))
                .map((value) => value.trim())
                .filter(Boolean)
        )
    );
}

function normalizeRoutingText(value: string): string {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/pre[\s-]*school/g, "preschool")
        .replace(/foundation\s*stage\s*(\d+)/g, "foundationstage$1")
        .replace(/grade\s*(\d+)/g, "grade$1")
        .replace(/kg\s*(\d+)/g, "kg$1")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizedContains(haystack: string, needle: string): boolean {
    const normalizedNeedle = normalizeRoutingText(needle);
    if (!normalizedNeedle) return false;
    return ` ${haystack} `.includes(` ${normalizedNeedle} `);
}

function resolveMailboxRouting(
    mailbox: MailboxConfig,
    subject: string,
    body: string
): ResolvedRouting {
    const routes = mailbox.routes || [];

    if (routes.length === 0) {
        return {
            selectedRoute: null,
            schoolName: null,
            divisionName: null,
            gradeName: null,
            schools: [],
            divisions: [],
            allowedGrades: [],
        };
    }

    const schools = uniqueStrings(routes.map((route) => route.school));
    const divisions = uniqueStrings(routes.map((route) => route.division));
    const allowedGrades = uniqueStrings(
        routes.flatMap((route) => route.grades || [])
    );

    const haystack = normalizeRoutingText(`${subject} ${body}`);

    const matchedGrades = allowedGrades.filter((grade) =>
        normalizedContains(haystack, grade)
    );

    let selectedRoute: MailboxRoute | null =
        routes.length === 1 ? routes[0] : null;

    if (!selectedRoute && haystack) {
        const scored = routes
            .map((route) => {
                let score = 0;

                if (normalizedContains(haystack, route.school)) {
                    score += 4;
                }

                if (normalizedContains(haystack, route.division)) {
                    score += 2;
                }

                for (const grade of route.grades || []) {
                    if (normalizedContains(haystack, grade)) {
                        score += 5;
                    }
                }

                return { route, score };
            })
            .sort((a, b) => b.score - a.score);

        if (
            scored.length > 0 &&
            scored[0].score > 0 &&
            (scored.length === 1 || scored[0].score > scored[1].score)
        ) {
            selectedRoute = scored[0].route;
        }
    }

    return {
        selectedRoute,
        schoolName:
            selectedRoute?.school ||
            (schools.length === 1 ? schools[0] : null),
        divisionName:
            selectedRoute?.division ||
            (divisions.length === 1 ? divisions[0] : null),
        gradeName:
            matchedGrades.length === 1 &&
                selectedRoute?.grades.some((g) => normalizeRoutingText(g) === normalizeRoutingText(matchedGrades[0]))
                ? matchedGrades[0] : null,
        schools,
        divisions,
        allowedGrades,
    };
}

function collectEmployeeValues(...values: any[]): string[] {
    const result: string[] = [];

    for (const value of values) {
        if (Array.isArray(value)) {
            for (const item of value) {
                if (typeof item === "string" && item.trim()) {
                    result.push(item.trim());
                }
            }
        } else if (typeof value === "string" && value.trim()) {
            result.push(value.trim());
        }
    }

    return uniqueStrings(result);
}

function hasNormalizedOverlap(left: string[], right: string[]): boolean {
    const normalizedRight = new Set(
        right.map((value) => normalizeRoutingText(value))
    );

    return left.some((value) =>
        normalizedRight.has(normalizeRoutingText(value))
    );
}

type AcademicTaxonomy = {
    schools: Map<string, string[]>;
    divisions: Map<string, string[]>;
    grades: Map<string, string[]>;
};

async function loadAcademicTaxonomy(
    db: admin.firestore.Firestore
): Promise<AcademicTaxonomy> {
    const readCatalog = async (collectionName: string): Promise<Map<string, string[]>> => {
        const snapshot = await db.collection(collectionName).get();
        const map = new Map<string, string[]>();
        for (const doc of snapshot.docs) {
            const data = doc.data() as any;
            const aliases = collectEmployeeValues(
                data.name, data.nameEn, data.label, data.title,
                data.code, data.displayName
            );
            for (const alias of aliases) {
                const key = normalizeRoutingText(alias);
                if (!key) continue;
                const ids = map.get(key) || [];
                if (!ids.includes(doc.id)) ids.push(doc.id);
                map.set(key, ids);
            }
        }
        return map;
    };

    const [schools, divisions, grades] = await Promise.all([
        readCatalog("schools"),
        readCatalog("divisions"),
        readCatalog("grades"),
    ]);
    return { schools, divisions, grades };
}

function taxonomyIds(catalog: Map<string, string[]>, name: string | null): string[] {
    return name ? catalog.get(normalizeRoutingText(name)) || [] : [];
}

function employeeHasScope(
    ids: unknown,
    names: unknown,
    requiredName: string,
    catalog: Map<string, string[]>
): boolean {
    const requiredIds = taxonomyIds(catalog, requiredName);
    // Fail closed when an academic scope has no matching Firestore taxonomy record.
    if (!requiredIds.length) return false;
    const employeeIds = collectEmployeeValues(ids);
    if (employeeIds.length > 0) {
        return employeeIds.some((id) => requiredIds.includes(id));
    }
    // Support older user documents containing names rather than IDs.
    return hasNormalizedOverlap(collectEmployeeValues(names), [requiredName]);
}

function employeeMatchesMailbox(
    employee: any,
    mailbox: MailboxConfig,
    routing: ResolvedRouting,
    taxonomy: AcademicTaxonomy,
    departmentId: string
): boolean {
    if (employee.role !== "Employee" || employee.status !== "Available") return false;
    if (!employee.activeSessionId) return false;
    void departmentId;

    // Staff attached to specific mailboxes (Settings > Employees > "by mailbox")
    // only receive tickets from those mailboxes.
    const mailboxEmails = collectEmployeeValues(
        employee.mailboxEmails, employee.queueEmails, employee.mailboxes
    );
    if (mailboxEmails.length &&
        !mailboxEmails.some((email) => email.toLowerCase() === mailbox.email.toLowerCase())) {
        return false;
    }

    // Category-wide queues (no campus) do not require campus, school, division or grade.
    if (mailbox.scope === "department") return true;

    const campuses = collectEmployeeValues(employee.campusId, employee.campusIds);
    if (!mailbox.campusId || !campuses.includes(mailbox.campusId)) return false;

    // Campus-only mailboxes (e.g. Admissions/Collection) do not require academic scope.
    // Role, Available status, active session, department (query), and campus still apply.
    if (mailbox.scope === "campus") return true;

    // Director-style queues: only the staff listed in the CRM sheet, matched on
    // campus and (when the queue has one division) division. School and grade
    // are not required because the queue covers every school.
    if (mailbox.assignTo?.length) {
        const email = String(employee.email || "").trim().toLowerCase();
        if (!email || !mailbox.assignTo.includes(email)) return false;
        if (routing.divisionName && !employeeHasScope(
            employee.divisionIds,
            [employee.divisions, employee.divisionNames, employee.division, employee.divisionName],
            routing.divisionName,
            taxonomy.divisions
        )) return false;
        return true;
    }

    // Academic mailboxes must resolve to one coherent school/division route.
    if (!routing.selectedRoute || !routing.schoolName || !routing.divisionName) return false;

    if (!employeeHasScope(
        employee.schoolIds,
        [employee.schools, employee.schoolNames, employee.school, employee.schoolName],
        routing.schoolName,
        taxonomy.schools
    )) return false;

    if (!employeeHasScope(
        employee.divisionIds,
        [employee.divisions, employee.divisionNames, employee.division, employee.divisionName],
        routing.divisionName,
        taxonomy.divisions
    )) return false;

    const requiredGrades = routing.gradeName
        ? [routing.gradeName]
        : routing.selectedRoute.grades;
    if (!requiredGrades.length) return false;
    if (!requiredGrades.some((grade) => employeeHasScope(
        employee.gradeIds,
        [employee.grades, employee.gradeNames, employee.grade, employee.gradeName],
        grade,
        taxonomy.grades
    ))) return false;

    return true;
}

async function extractEmailBody(
    gmail: any,
    messageId: string,
    payload: any
): Promise<string> {
    const decode = (data: string): string => {
        return Buffer.from(
            data.replace(/-/g, "+").replace(/_/g, "/"),
            "base64"
        ).toString("utf-8");
    };

    const htmlToText = (html: string): string => {
        return html
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/p>/gi, "\n")
            .replace(/<\/div>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    };

    async function getPartBody(part: any): Promise<string> {
        if (!part) return "";

        if (part.body?.data) {
            return decode(part.body.data);
        }

        if (part.body?.attachmentId) {
            const response = await gmail.users.messages.attachments.get({
                userId: "me",
                messageId,
                id: part.body.attachmentId,
            });

            if (response.data.data) {
                return decode(response.data.data);
            }
        }

        return "";
    }

    const plainParts: string[] = [];
    const htmlParts: string[] = [];

    async function walkParts(part: any): Promise<void> {
        if (!part) return;

        const isAttachment =
            Boolean(part.filename) ||
            part.headers?.some(
                (header: any) =>
                    header.name?.toLowerCase() === "content-disposition" &&
                    header.value?.toLowerCase().includes("attachment")
            );

        if (part.mimeType === "text/plain" && !isAttachment) {
            const body = await getPartBody(part);
            if (body.trim()) plainParts.push(body.trim());
        }

        if (part.mimeType === "text/html" && !isAttachment) {
            const body = await getPartBody(part);
            if (body.trim()) {
                const converted = htmlToText(body);
                if (converted.trim()) htmlParts.push(converted);
            }
        }

        if (Array.isArray(part.parts)) {
            for (const child of part.parts) {
                await walkParts(child);
            }
        }
    }

    await walkParts(payload);

    const plainText = plainParts.join("\n\n").trim();
    const htmlText = htmlParts.join("\n\n").trim();

    console.log("EMAIL BODY EXTRACTION:", {
        messageId,
        mimeType: payload?.mimeType,
        plainParts: plainParts.length,
        htmlParts: htmlParts.length,
        plainLength: plainText.length,
        htmlLength: htmlText.length,
    });

    if (htmlText) return htmlText;
    if (plainText) return plainText;

    const directBody = await getPartBody(payload);

    if (directBody) {
        return payload?.mimeType === "text/html"
            ? htmlToText(directBody)
            : directBody.trim();
    }

    console.error(`EMAIL BODY EXTRACTION FAILED: ${messageId}`);
    return "";
}

async function extractAndUploadEmailAttachments(
    gmail: any,
    messageId: string,
    payload: any,
    storagePrefix = ""
): Promise<string[]> {
    const attachmentUrls: string[] = [];
    const bucket = getStorage().bucket();

    async function walkPart(part: any): Promise<void> {
        if (!part) return;

        if (part.filename) {
            try {
                let attachmentData: string | undefined;

                if (part.body?.data) {
                    attachmentData = part.body.data;
                }

                if (!attachmentData && part.body?.attachmentId) {
                    const attachmentResponse =
                        await gmail.users.messages.attachments.get({
                            userId: "me",
                            messageId,
                            id: part.body.attachmentId,
                        });

                    attachmentData =
                        attachmentResponse.data.data || undefined;
                }

                if (attachmentData) {
                    const normalizedData = attachmentData
                        .replace(/-/g, "+")
                        .replace(/_/g, "/");

                    const buffer = Buffer.from(normalizedData, "base64");

                    const originalName =
                        part.filename || `attachment-${Date.now()}`;

                    const safeName = originalName.replace(
                        /[^a-zA-Z0-9._-]/g,
                        "_"
                    );

                    const filePath =
                        `${storagePrefix}attachments/email/${messageId}/` +
                        `${Date.now()}_${randomUUID()}_${safeName}`;

                    const token = randomUUID();
                    const file = bucket.file(filePath);

                    await file.save(buffer, {
                        resumable: false,
                        contentType:
                            part.mimeType || "application/octet-stream",
                        metadata: {
                            metadata: {
                                firebaseStorageDownloadTokens: token,
                            },
                        },
                    });

                    const downloadUrl =
                        "https://firebasestorage.googleapis.com/v0/b/" +
                        `${bucket.name}/o/${encodeURIComponent(filePath)}` +
                        `?alt=media&token=${token}`;

                    attachmentUrls.push(downloadUrl);

                    console.log(
                        `Email attachment uploaded: ${originalName}`
                    );
                }
            } catch (attachmentError) {
                console.error(
                    `Failed to process attachment ${part.filename}:`,
                    attachmentError
                );
            }
        }

        if (Array.isArray(part.parts)) {
            for (const childPart of part.parts) {
                await walkPart(childPart);
            }
        }
    }

    await walkPart(payload);
    return attachmentUrls;
}

async function acquireMessageLock(
    processedRef: admin.firestore.DocumentReference,
    mailboxEmail: string,
    messageId: string
): Promise<boolean> {
    const existing = await processedRef.get();

    if (existing.exists) {
        const data = existing.data() as any;

        const isFailed = data?.status === "failed";

        const startedAtMillis =
            typeof data?.startedAt?.toMillis === "function"
                ? data.startedAt.toMillis()
                : null;

        const isStaleProcessing =
            data?.status === "processing" &&
            startedAtMillis !== null &&
            Date.now() - startedAtMillis > 10 * 60 * 1000;

        if (!isFailed && !isStaleProcessing) {
            return false;
        }

        await processedRef.set(
            {
                status: "processing",
                mailbox: mailboxEmail,
                messageId,
                startedAt: admin.firestore.FieldValue.serverTimestamp(),
                lastError: admin.firestore.FieldValue.delete(),
            },
            { merge: true }
        );

        return true;
    }

    try {
        await processedRef.create({
            status: "processing",
            mailbox: mailboxEmail,
            messageId,
            startedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return true;
    } catch (error: any) {
        if (
            error?.code === 6 ||
            error?.code === "already-exists" ||
            error?.code === "ALREADY_EXISTS"
        ) {
            return false;
        }

        throw error;
    }
}

async function runWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>
): Promise<void> {
    let cursor = 0;

    async function runner(): Promise<void> {
        while (true) {
            const index = cursor++;
            if (index >= items.length) return;
            await worker(items[index]);
        }
    }

    await Promise.all(
        Array.from(
            { length: Math.min(limit, items.length) },
            () => runner()
        )
    );
}

/**
 * Gmail -> tickets sync for ONE Firestore database.
 * Mailboxes come from that database's `mailboxes` collection (Settings > Email
 * Configurations); tickets, processed markers, taxonomy and assignment all use the
 * same database. Production and staging therefore never see each other's queues.
 * Do not enable the same mailbox in both environments: each would create its own ticket.
 */
const makeSyncEmails = (database: string) => onSchedule(
    {
        schedule: "every 2 minutes",
        secrets: [GMAIL_SERVICE_ACCOUNT_KEY],
        timeoutSeconds: 540,
        memory: "512MiB",
    },
    async () => {
        try {
            const keyString = GMAIL_SERVICE_ACCOUNT_KEY.value();

            if (!keyString) {
                throw new Error("Missing GMAIL_SERVICE_ACCOUNT_KEY secret.");
            }

            const key = JSON.parse(keyString);
            const db = getFirestore(admin.app(), database);
            const storagePrefix = database === "(default)" ? "" : `${database}/`;

            // Resolve mailbox names to actual Firestore document IDs once per sync run.
            const taxonomy = await loadAcademicTaxonomy(db);

            const deptsSnapshot = await db.collection("departments").get();

            // Document id LAST: a stray "id" field inside the document must never replace it,
            // or employees are looked up under the wrong category and nothing is assigned.
            const allDepts = deptsSnapshot.docs.map((doc) => ({
                ...(doc.data() as any),
                id: doc.id,
            }));

            const mailboxConfigs = await loadMailboxConfigs(db);
            const enabledMailboxes = mailboxConfigs.filter((item) => item.enabled);
            if (!enabledMailboxes.length) {
                console.warn("No enabled mailboxes in Settings > Email Configurations; nothing to sync.");
            }

            await runWithConcurrency(
                enabledMailboxes,
                6,
                async (mailbox) => {
                    try {
                        console.log(`START MAILBOX: ${mailbox.email}`);

                        const gmail = await createGmailClient(
                            key,
                            mailbox.email,
                            [
                                "https://www.googleapis.com/auth/gmail.readonly",
                                "https://www.googleapis.com/auth/gmail.modify",
                                "https://www.googleapis.com/auth/gmail.send",
                            ]
                        );

                        const listRes = await gmail.users.messages.list({
                            userId: "me",
                            q: "in:inbox newer_than:7d",
                            maxResults: 25,
                        });

                        const messages = listRes.data.messages || [];

                        console.log(
                            `SUCCESS MAILBOX: ${mailbox.email} - ${messages.length} messages`
                        );
                        await recordMailboxSync(db, mailbox.id, {
                            status: "ok",
                            messageCount: messages.length,
                        });

                        for (const msg of messages) {
                            if (!msg.id) continue;

                            const safeMailbox = mailbox.email
                                .toLowerCase()
                                .replace(/[^a-z0-9]/g, "_");

                            const processedRef = db
                                .collection("processed_emails")
                                .doc(`${safeMailbox}_${msg.id}`);

                            const ticketDocId =
                                `${safeMailbox}_${msg.id}`;

                            const ticketRef = db
                                .collection("tickets")
                                .doc(ticketDocId);

                            let locked = false;

                            try {
                                locked = await acquireMessageLock(
                                    processedRef,
                                    mailbox.email,
                                    msg.id
                                );

                                if (!locked) {
                                    console.log(
                                        `SKIPPING DUPLICATE MESSAGE: ${msg.id} from ${mailbox.email}`
                                    );
                                    continue;
                                }

                                console.log(
                                    `PROCESSING MESSAGE: ${msg.id} from ${mailbox.email}`
                                );

                                const msgData =
                                    await gmail.users.messages.get({
                                        userId: "me",
                                        id: msg.id,
                                        format: "full",
                                    });

                                const headers =
                                    msgData.data.payload?.headers || [];

                                const emailAttachments =
                                    await extractAndUploadEmailAttachments(
                                        gmail,
                                        msg.id,
                                        msgData.data.payload,
                                        storagePrefix
                                    );

                                let fullBodyText = (
                                    await extractEmailBody(
                                        gmail,
                                        msg.id,
                                        msgData.data.payload
                                    )
                                ).trim();

                                if (!fullBodyText) {
                                    console.error(
                                        `FULL BODY EXTRACTION FAILED: ${msg.id}`,
                                        {
                                            snippet: msgData.data.snippet,
                                            mimeType:
                                                msgData.data.payload?.mimeType,
                                        }
                                    );

                                    fullBodyText = msgData.data.snippet
                                        ? `[Email body could not be fully extracted]\n\n${msgData.data.snippet}`
                                        : "";
                                }

                                if (
                                    !fullBodyText &&
                                    emailAttachments.length === 0
                                ) {
                                    await processedRef.set(
                                        {
                                            status: "completed",
                                            skipped: true,
                                            reason: "empty",
                                            mailbox: mailbox.email,
                                            processedAt:
                                                admin.firestore.FieldValue.serverTimestamp(),
                                        },
                                        { merge: true }
                                    );

                                    continue;
                                }

                                if (
                                    !fullBodyText &&
                                    emailAttachments.length > 0
                                ) {
                                    fullBodyText = "Attachment received";
                                }

                                const subject =
                                    headers.find(
                                        (header: any) =>
                                            header.name?.toLowerCase() ===
                                            "subject"
                                    )?.value || "No subject";

                                const fromHeader =
                                    headers.find(
                                        (header: any) =>
                                            header.name?.toLowerCase() ===
                                            "from"
                                    )?.value || "Unknown";

                                const messageIdHeader =
                                    normalizeMessageId(
                                        headers.find(
                                            (header: any) =>
                                                header.name?.toLowerCase() ===
                                                "message-id"
                                        )?.value
                                    );

                                const inReplyTo =
                                    normalizeMessageId(
                                        headers.find(
                                            (header: any) =>
                                                header.name?.toLowerCase() ===
                                                "in-reply-to"
                                        )?.value
                                    );

                                const references =
                                    parseReferences(
                                        headers.find(
                                            (header: any) =>
                                                header.name?.toLowerCase() ===
                                                "references"
                                        )?.value
                                    );

                                const emailMatch =
                                    fromHeader.match(/<(.*?)>/);

                                const senderEmail = (
                                    emailMatch
                                        ? emailMatch[1]
                                        : fromHeader
                                ).trim();

                                const senderName =
                                    fromHeader
                                        .replace(/<.*?>/, "")
                                        .replace(/"/g, "")
                                        .trim() || senderEmail;

                                const normalizedSubject = subject.toLowerCase().trim();
                                const normalizedSender = senderEmail.toLowerCase().trim();

                                const isDeliveryNotification =
                                    normalizedSubject.includes("delivery status notification") ||
                                    normalizedSubject.includes("delivery status notification (failure)") ||
                                    normalizedSubject.includes("undelivered mail returned to sender") ||
                                    normalizedSubject.includes("mail delivery failed") ||
                                    normalizedSubject.includes("delivery failure") ||
                                    normalizedSender.startsWith("mailer-daemon@") ||
                                    normalizedSender.startsWith("postmaster@");

                                if (isDeliveryNotification) {
                                    console.log(
                                        `SKIPPING DELIVERY NOTIFICATION: ${subject} from ${senderEmail}`
                                    );

                                    await processedRef.set(
                                        {
                                            status: "completed",
                                            skipped: true,
                                            reason: "delivery-notification",
                                            mailbox: mailbox.email,
                                            processedAt:
                                                admin.firestore.FieldValue.serverTimestamp(),
                                        },
                                        { merge: true }
                                    );

                                    continue;
                                }

                                if (
                                    senderEmail.toLowerCase() ===
                                    mailbox.email.toLowerCase()
                                ) {
                                    await processedRef.set(
                                        {
                                            status: "completed",
                                            skipped: true,
                                            reason: "self-email",
                                            processedAt:
                                                admin.firestore.FieldValue.serverTimestamp(),
                                        },
                                        { merge: true }
                                    );

                                    continue;
                                }

                                let existingTicketDoc:
                                    | admin.firestore.QueryDocumentSnapshot
                                    | null = null;

                                const candidateIds = [
                                    inReplyTo,
                                    ...references,
                                ].filter(
                                    (item): item is string =>
                                        Boolean(item)
                                );

                                for (const candidateId of candidateIds) {
                                    const existingTicket =
                                        await db
                                            .collection("tickets")
                                            .where(
                                                "emailMessageIds",
                                                "array-contains",
                                                candidateId
                                            )
                                            .limit(1)
                                            .get();

                                    if (!existingTicket.empty) {
                                        const doc =
                                            existingTicket.docs[0];

                                        const ticketData =
                                            doc.data() as any;

                                        if (
                                            !["Resolved", "Closed"].includes(
                                                ticketData.status
                                            )
                                        ) {
                                            existingTicketDoc = doc;
                                        }

                                        break;
                                    }
                                }

                                const targetDept =
                                    allDepts.find(
                                        (department) =>
                                            department.id === mailbox.departmentId
                                    ) ||
                                    allDepts.find(
                                        (department) =>
                                            department.name
                                                ?.trim()
                                                .toLowerCase() ===
                                            mailbox.department
                                                .trim()
                                                .toLowerCase()
                                    );

                                if (!targetDept) {
                                    console.error(
                                        `Department "${mailbox.department}" not found for mailbox ${mailbox.email}`
                                    );

                                    await processedRef.set(
                                        {
                                            status: "completed",
                                            skipped: true,
                                            reason:
                                                "department-not-found",
                                            mailbox: mailbox.email,
                                            department:
                                                mailbox.department,
                                            processedAt:
                                                admin.firestore.FieldValue.serverTimestamp(),
                                        },
                                        { merge: true }
                                    );

                                    continue;
                                }

                                const now = new Date();

                                const creatorUserId =
                                    `email_${senderEmail.replace(
                                        /[^a-zA-Z0-9]/g,
                                        "_"
                                    )}`;

                                if (existingTicketDoc) {
                                    const replyUpdate: any = {
                                        updatedAt:
                                            admin.firestore.FieldValue.serverTimestamp(),

                                        status:
                                            (existingTicketDoc.data() as any)
                                                .status === "Queue"
                                                ? "Queue"
                                                : "Open",

                                        emailMessageIds:
                                            admin.firestore.FieldValue.arrayUnion(
                                                ...(messageIdHeader
                                                    ? [messageIdHeader]
                                                    : [])
                                            ),

                                        messages:
                                            admin.firestore.FieldValue.arrayUnion(
                                                {
                                                    id: String(
                                                        generateRandom4Digit()
                                                    ),
                                                    author: {
                                                        userId:
                                                            creatorUserId,
                                                        name: senderName,
                                                        email: senderEmail,
                                                        avatarUrl: "",
                                                    },
                                                    text: fullBodyText,
                                                    createdAt:
                                                        now.toISOString(),
                                                    source: "email",
                                                    attachments:
                                                        emailAttachments,
                                                }
                                            ),
                                    };

                                    if (emailAttachments.length > 0) {
                                        replyUpdate.attachments =
                                            admin.firestore.FieldValue.arrayUnion(
                                                ...emailAttachments
                                            );
                                    }

                                    await existingTicketDoc.ref.update(
                                        replyUpdate
                                    );

                                    await processedRef.set(
                                        {
                                            status: "completed",
                                            type: "reply",
                                            ticketId:
                                                existingTicketDoc.id,
                                            mailbox: mailbox.email,
                                            processedAt:
                                                admin.firestore.FieldValue.serverTimestamp(),
                                        },
                                        { merge: true }
                                    );

                                    await gmail.users.messages.modify({
                                        userId: "me",
                                        id: msg.id,
                                        requestBody: {
                                            removeLabelIds: ["UNREAD"],
                                        },
                                    });

                                    console.log(
                                        `Reply added to ticket ${existingTicketDoc.id} from ${mailbox.email}`
                                    );

                                    continue;
                                }

                                const routing =
                                    resolveMailboxRouting(
                                        mailbox,
                                        subject,
                                        fullBodyText
                                    );

                                const selectedGradeNames = routing.selectedRoute?.grades || [];
                                const schoolIds = taxonomyIds(taxonomy.schools, routing.schoolName);
                                const divisionIds = taxonomyIds(taxonomy.divisions, routing.divisionName);
                                const gradeIds = routing.gradeName
                                    ? taxonomyIds(taxonomy.grades, routing.gradeName)
                                    : [];
                                if (mailbox.scope === "academic" && !mailbox.assignTo?.length &&
                                    (!routing.selectedRoute || schoolIds.length !== 1 || divisionIds.length !== 1 ||
                                        !selectedGradeNames.length ||
                                        selectedGradeNames.some((grade) => !taxonomyIds(taxonomy.grades, grade).length))) {
                                    console.warn("ACADEMIC ROUTING INCOMPLETE: ticket will remain in Queue", {
                                        mailbox: mailbox.email,
                                        school: routing.schoolName,
                                        division: routing.divisionName,
                                        routeResolved: Boolean(routing.selectedRoute),
                                    });
                                }

                                let assignedTo: any = null;
                                let status: "Queue" | "Open" = "Queue";

                                const departmentOnlyMailbox =
                                    mailbox.scope === "department";

                                const campusOnlyMailbox =
                                    mailbox.scope === "campus" &&
                                    Boolean(mailbox.campusId);

                                const directorMailbox =
                                    mailbox.scope === "academic" &&
                                    Boolean(mailbox.assignTo?.length) &&
                                    divisionIds.length <= 1;

                                const academicRouteValid =
                                    directorMailbox ||
                                    mailbox.scope === "academic" &&
                                    Boolean(routing.selectedRoute) &&
                                    schoolIds.length === 1 &&
                                    divisionIds.length === 1 &&
                                    selectedGradeNames.length > 0 &&
                                    selectedGradeNames.every((grade) => taxonomyIds(taxonomy.grades, grade).length > 0);

                                if (
                                    isWorkingTime(targetDept.workingHours) &&
                                    (departmentOnlyMailbox || campusOnlyMailbox || academicRouteValid)
                                ) {
                                    const deptRef = db
                                        .collection("departments")
                                        .doc(targetDept.id);

                                    await db.runTransaction(
                                        async (transaction) => {
                                            const empSnapshot =
                                                await transaction.get(
                                                    db
                                                        .collection("users")
                                                        .where(
                                                            "departmentId",
                                                            "==",
                                                            targetDept.id
                                                        )
                                                        .where(
                                                            "role",
                                                            "==",
                                                            "Employee"
                                                        )
                                                );

                                            const available =
                                                empSnapshot.docs
                                                    .map((doc) => ({
                                                        ...(doc.data() as any),
                                                        id: doc.id,
                                                    }))
                                                    .filter((employee) =>
                                                        employeeMatchesMailbox(
                                                            employee,
                                                            mailbox,
                                                            routing,
                                                            taxonomy,
                                                            targetDept.id
                                                        )
                                                    )
                                                    .sort((a, b) =>
                                                        a.id.localeCompare(
                                                            b.id
                                                        )
                                                    );

                                            if (available.length > 0) {
                                                const deptSnapshot =
                                                    await transaction.get(
                                                        deptRef
                                                    );

                                                const deptData =
                                                    deptSnapshot.data() ||
                                                    {};

                                                const assignmentKey =
                                                    mailbox.scope === "academic"
                                                        ? `${mailbox.campusId ||
                                                        "all"
                                                        }_${safeMailbox}`
                                                        : mailbox.campusId ||
                                                        "all";

                                                const lastIdx =
                                                    (
                                                        deptData.lastAssignedUserIndexes ||
                                                        {}
                                                    )[assignmentKey] ?? -1;

                                                const nextIdx =
                                                    (lastIdx + 1) %
                                                    available.length;

                                                assignedTo =
                                                    available[nextIdx];

                                                status = "Open";

                                                transaction.update(
                                                    deptRef,
                                                    {
                                                        [`lastAssignedUserIndexes.${assignmentKey}`]:
                                                            nextIdx,
                                                    }
                                                );
                                            }
                                        }
                                    );
                                }

                                const ticketNumber =
                                    generateRandom4Digit();

                                console.log(
                                    "ABOUT TO CREATE TICKET",
                                    {
                                        mailbox: mailbox.email,
                                        senderEmail,
                                        subject,
                                        department:
                                            targetDept.name,
                                        campus:
                                            mailbox.campusName,
                                        division:
                                            routing.divisionName,
                                        school:
                                            routing.schoolName,
                                        grade:
                                            routing.gradeName,
                                        attachmentsCount:
                                            emailAttachments.length,
                                    }
                                );

                                const existingTicketRef =
                                    await ticketRef.get();

                                if (existingTicketRef.exists) {
                                    await processedRef.set(
                                        {
                                            status: "completed",
                                            type: "new",
                                            ticketId: ticketRef.id,
                                            mailbox: mailbox.email,
                                            processedAt:
                                                admin.firestore.FieldValue.serverTimestamp(),
                                        },
                                        { merge: true }
                                    );

                                    await gmail.users.messages.modify({
                                        userId: "me",
                                        id: msg.id,
                                        requestBody: {
                                            removeLabelIds: ["UNREAD"],
                                        },
                                    });

                                    console.log(
                                        `Existing deterministic ticket ${ticketRef.id} reused for message ${msg.id}`
                                    );

                                    continue;
                                }

                                await ticketRef.create({
                                    ticketNumber,

                                    subject,
                                    description: fullBodyText,

                                    status,
                                    priority: "Normal",

                                    departmentId: targetDept.id,
                                    departmentName: targetDept.name,

                                    // Kept for systems that call this field "category".
                                    categoryId: targetDept.id,
                                    categoryName: targetDept.name,

                                    campusId:
                                        mailbox.campusId || null,
                                    campusName:
                                        mailbox.campusName || null,

                                    division:
                                        routing.divisionName,
                                    divisionName:
                                        routing.divisionName,
                                    divisionNames:
                                        routing.divisions,

                                    // IDs are resolved from Firestore taxonomy; never guess IDs from names.
                                    schoolId: schoolIds.length === 1 ? schoolIds[0] : null,
                                    divisionId: divisionIds.length === 1 ? divisionIds[0] : null,
                                    gradeId: gradeIds.length === 1 ? gradeIds[0] : null,

                                    school:
                                        routing.schoolName,
                                    schoolName:
                                        routing.schoolName,
                                    schoolNames:
                                        routing.schools,

                                    grade:
                                        routing.gradeName,
                                    gradeName:
                                        routing.gradeName,
                                    grades:
                                        routing.selectedRoute?.grades || routing.allowedGrades,
                                    allowedGrades:
                                        routing.selectedRoute?.grades || routing.allowedGrades,

                                    routingOptions:
                                        mailbox.routes || [],

                                    parentName: senderName,
                                    parentEmail: senderEmail,

                                    createdBy: {
                                        userId: creatorUserId,
                                        name: senderName,
                                        email: senderEmail,
                                        avatarUrl: "",
                                    },

                                    assignedTo: assignedTo
                                        ? {
                                            userId:
                                                assignedTo.id,
                                            name:
                                                assignedTo.name,
                                            email:
                                                assignedTo.email ||
                                                "",
                                            avatarUrl:
                                                assignedTo.avatarUrl ||
                                                "",
                                        }
                                        : null,

                                    source: "email",

                                    gmailMessageId: msg.id,

                                    emailMessageIds:
                                        messageIdHeader
                                            ? [messageIdHeader]
                                            : [],

                                    mailboxEmail:
                                        mailbox.email,
                                    mailboxId: mailbox.id,
                                    originalRecipientEmail:
                                        mailbox.email,

                                    attachments:
                                        emailAttachments,

                                    createdAt:
                                        admin.firestore.FieldValue.serverTimestamp(),

                                    updatedAt:
                                        admin.firestore.FieldValue.serverTimestamp(),

                                    messages: [
                                        {
                                            id: String(
                                                generateRandom4Digit()
                                            ),

                                            author: {
                                                userId:
                                                    creatorUserId,
                                                name: senderName,
                                                email: senderEmail,
                                                avatarUrl: "",
                                            },

                                            text: fullBodyText,
                                            createdAt:
                                                now.toISOString(),
                                            source: "email",
                                            attachments:
                                                emailAttachments,
                                        },
                                    ],
                                });

                                await processedRef.set(
                                    {
                                        status: "completed",
                                        type: "new",
                                        ticketId:
                                            ticketRef.id,
                                        mailbox:
                                            mailbox.email,
                                        processedAt:
                                            admin.firestore.FieldValue.serverTimestamp(),
                                    },
                                    { merge: true }
                                );

                                await gmail.users.messages.modify({
                                    userId: "me",
                                    id: msg.id,
                                    requestBody: {
                                        removeLabelIds: ["UNREAD"],
                                    },
                                });

                                console.log(
                                    `New ticket #${ticketNumber} created from ${mailbox.email}`
                                );
                            } catch (messageError: any) {
                                console.error(
                                    `MESSAGE ERROR [${mailbox.email}] [${msg.id}]:`,
                                    messageError
                                );

                                if (locked) {
                                    try {
                                        await processedRef.set(
                                            {
                                                status: "failed",
                                                lastError:
                                                    String(
                                                        messageError?.message ||
                                                        messageError
                                                    ).slice(0, 1500),
                                                failedAt:
                                                    admin.firestore.FieldValue.serverTimestamp(),
                                            },
                                            { merge: true }
                                        );
                                    } catch (lockError) {
                                        console.error(
                                            "Failed to save processing error:",
                                            lockError
                                        );
                                    }
                                }
                            }
                        }
                    } catch (mailboxError) {
                        console.error(
                            `MAILBOX FAILED: ${mailbox.email}`,
                            mailboxError
                        );
                        await recordMailboxSync(db, mailbox.id, {
                            status: "failed",
                            error: String((mailboxError as any)?.message || mailboxError),
                        });
                    }
                }
            );
        } catch (error) {
            console.error("Global Error:", error);
        }
    }
);

type TicketEmailFunctionOptions = {
    database: string;
    baseUrl: string;
    redirectTo?: string;
    requireRedirect?: boolean;
};

const makeSendAfterHoursAutoReply = ({ database, baseUrl, redirectTo, requireRedirect }: TicketEmailFunctionOptions) => onDocumentCreated(
    {
        document: "tickets/{ticketId}",
        database,
        secrets: [GMAIL_SERVICE_ACCOUNT_KEY],
        timeoutSeconds: 120,
        memory: "256MiB",
    },
    async (event) => {
        if (requireRedirect && !redirectTo) {
            console.warn(`No email redirect set for database "${database}"; ticket ${event.params.ticketId} email skipped.`);
            return;
        }

        try {
            const ticket = event.data?.data() as any;

            if (!ticket) return;

            const db = getFirestore(admin.app(), database);

            if (!ticket.departmentId) {
                console.log(
                    `Ticket #${ticket.ticketNumber} has no departmentId; after-hours email skipped.`
                );
                return;
            }

            const deptSnap = await db
                .collection("departments")
                .doc(ticket.departmentId)
                .get();

            const dept = deptSnap.data() as any;

            // Form-created tickets record the decision at creation time using
            // the server-side working-hours utility (including official holidays).
            // Older/email-created tickets retain the existing check.
            const isOutsideHours = typeof ticket.createdOutsideWorkingHours === "boolean"
                ? ticket.createdOutsideWorkingHours
                : !isWorkingTime(dept?.workingHours);
            if (!isOutsideHours) return;

            const globalSnap = await db
                .collection("settings")
                .doc("afterHoursTicketEmail")
                .get();

            const globalSettings = globalSnap.data() as any;
            const settings =
                dept?.afterHoursEmail || globalSettings;

            if (!settings || settings.enabled === false) {
                console.log("After-hours email is disabled.");
                return;
            }

            const recipientEmail =
                ticket.parentEmail ||
                ticket.requesterEmail ||
                ticket.createdFor?.email ||
                ticket.createdBy?.email;

            if (!recipientEmail) {
                console.log(
                    `No recipient email found for ticket #${ticket.ticketNumber}`
                );
                return;
            }

            const key = JSON.parse(
                GMAIL_SERVICE_ACCOUNT_KEY.value()
            );

            const senderEmail = await getSenderMailbox(ticket, getFirestore(admin.app(), database));

            const bodyText = replacePlaceholders(
                settings.body || "",
                ticket,
                dept
            );

            const subjectText = replacePlaceholders(
                settings.subject ||
                "We received your request",
                ticket,
                dept
            );

            const htmlBody =
                wrapInProfessionalTemplate(
                    "Automated Response",
                    "Outside Working Hours",
                    ticket.parentName ||
                    ticket.createdBy?.name ||
                    "User",
                    bodyText,
                    `${baseUrl}/tickets/${event.params.ticketId}`,
                    String(ticket.ticketNumber),
                    ticket.subject || "Ticket"
                );

            await sendHtmlEmail({
                key,
                senderEmail,
                to: recipientEmail,
                subject: subjectText,
                html: htmlBody,
                redirectTo,
            });

            console.log(
                `After-hours email sent to ${recipientEmail} for ticket #${ticket.ticketNumber}`
            );
        } catch (error) {
            console.error("Auto-reply error:", error);
        }
    }
);

async function getAssigneeEmail(
    db: admin.firestore.Firestore,
    ticket: any
): Promise<string | null> {
    if (ticket?.assignedTo?.email) {
        return ticket.assignedTo.email;
    }

    const userId = ticket?.assignedTo?.userId;

    if (!userId) return null;

    const userSnap = await db
        .collection("users")
        .doc(userId)
        .get();

    if (!userSnap.exists) return null;

    const user = userSnap.data() as any;
    return user?.email || null;
}

const makeSendEmailOnAgentReply = ({ database, baseUrl, redirectTo, requireRedirect }: TicketEmailFunctionOptions) => onDocumentUpdated(
    {
        document: "tickets/{ticketId}",
        database,
        secrets: [GMAIL_SERVICE_ACCOUNT_KEY],
        timeoutSeconds: 120,
        memory: "256MiB",
    },
    async (event) => {
        if (requireRedirect && !redirectTo) {
            console.warn(`No email redirect set for database "${database}"; ticket ${event.params.ticketId} email skipped.`);
            return;
        }

        try {
            const after =
                event.data?.after.data() as any;

            const before =
                event.data?.before.data() as any;

            if (!after || !before) return;

            const afterMessages =
                after.messages || [];

            const beforeMessages =
                before.messages || [];

            if (
                afterMessages.length <=
                beforeMessages.length
            ) {
                return;
            }

            const lastMsg =
                afterMessages[
                afterMessages.length - 1
                ];

            if (
                lastMsg.source === "email" ||
                lastMsg.isInternal
            ) {
                return;
            }

            const recipientEmail =
                after.parentEmail ||
                after.requesterEmail ||
                after.createdFor?.email ||
                after.createdBy?.email;

            if (!recipientEmail) {
                console.error(
                    `Ticket ${event.params.ticketId} has no requester email`
                );
                return;
            }

            const senderMailbox =
                await getSenderMailbox(after, getFirestore(admin.app(), database));

            const key = JSON.parse(
                GMAIL_SERVICE_ACCOUNT_KEY.value()
            );

            const previousIds =
                after.emailMessageIds || [];

            const newMessageId =
                `<ticket-${event.params.ticketId}-${Date.now()}@nis-crm.app>`;

            const htmlBody =
                wrapInProfessionalTemplate(
                    "Ticket Update",
                    "NIS CRM Support",
                    after.parentName ||
                    after.createdBy?.name ||
                    "User",
                    lastMsg.text ||
                    lastMsg.content ||
                    "",
                    `${baseUrl}/tickets/${event.params.ticketId}`,
                    String(after.ticketNumber),
                    after.subject || "Ticket"
                );

            const extraHeaders: string[] = [
                `Message-ID: ${newMessageId}`,
            ];

            if (previousIds.length) {
                extraHeaders.push(
                    `In-Reply-To: <${previousIds[
                    previousIds.length - 1
                    ]
                    }>`
                );

                extraHeaders.push(
                    `References: ${previousIds
                        .map(
                            (id: string) =>
                                `<${id}>`
                        )
                        .join(" ")}`
                );
            }

            await sendHtmlEmail({
                key,
                senderEmail: senderMailbox,
                to: recipientEmail,
                subject:
                    `Re: [Ticket #${after.ticketNumber}] ${after.subject}`,
                html: htmlBody,
                fromName: "Support Team",
                extraHeaders,
                redirectTo,
            });

            await event.data?.after.ref.update({
                emailMessageIds:
                    admin.firestore.FieldValue.arrayUnion(
                        newMessageId.replace(
                            /^<|>$/g,
                            ""
                        )
                    ),
            });

            console.log(
                `Parent email sent successfully to ${recipientEmail} for ticket #${after.ticketNumber}`
            );
        } catch (error) {
            console.error("Reply Error:", error);
        }
    }
);

const makeSendEmailOnAssignment = ({ database, baseUrl, redirectTo, requireRedirect }: TicketEmailFunctionOptions) => onDocumentUpdated(
    {
        document: "tickets/{ticketId}",
        database,
        secrets: [GMAIL_SERVICE_ACCOUNT_KEY],
        timeoutSeconds: 120,
        memory: "256MiB",
    },
    async (event) => {
        if (requireRedirect && !redirectTo) {
            console.warn(`No email redirect set for database "${database}"; ticket ${event.params.ticketId} email skipped.`);
            return;
        }

        try {
            const after =
                event.data?.after.data() as any;

            const before =
                event.data?.before.data() as any;

            if (!after?.assignedTo?.userId) return;

            const beforeAssigneeId =
                before?.assignedTo?.userId;

            const afterAssigneeId =
                after.assignedTo.userId;

            if (
                beforeAssigneeId ===
                afterAssigneeId
            ) {
                return;
            }

            const db = getFirestore(admin.app(), database);

            const employeeEmail =
                await getAssigneeEmail(
                    db,
                    after
                );

            if (!employeeEmail) {
                console.log(
                    `No employee email found for ticket #${after.ticketNumber}`
                );
                return;
            }

            const key = JSON.parse(
                GMAIL_SERVICE_ACCOUNT_KEY.value()
            );

            const senderEmail =
                await getSenderMailbox(after, getFirestore(admin.app(), database));

            const content =
                "A ticket has been assigned to you for review.\n\n" +
                `Ticket Number: #${after.ticketNumber}\n` +
                `Subject: ${after.subject}\n` +
                `Campus: ${after.campusName || "N/A"}\n` +
                `Division: ${after.divisionName || after.division || "N/A"}\n` +
                `School: ${after.schoolName || after.school || "N/A"}\n` +
                `Grade: ${after.gradeName || after.grade || "N/A"}\n` +
                `Parent: ${after.parentName || "N/A"}\n\n` +
                "Please log in to the portal to view the full details and respond.";

            const htmlBody =
                wrapInProfessionalTemplate(
                    "Ticket Assigned to You",
                    "NIS CRM Notification",
                    after.assignedTo.name ||
                    "Staff Member",
                    content,
                    `${baseUrl}/tickets/${event.params.ticketId}`,
                    String(after.ticketNumber),
                    after.subject || "Ticket"
                );

            await sendHtmlEmail({
                key,
                senderEmail,
                to: employeeEmail,
                subject:
                    `New Ticket Assigned: #${after.ticketNumber}`,
                html: htmlBody,
                redirectTo,
            });

            console.log(
                `Assignment email sent to ${employeeEmail}`
            );
        } catch (error) {
            console.error(
                "Assignment notification error:",
                error
            );
        }
    }
);

const makeSendEmailOnNewTicketAssignment = ({ database, baseUrl, redirectTo, requireRedirect }: TicketEmailFunctionOptions) => onDocumentCreated(
    {
        document: "tickets/{ticketId}",
        database,
        secrets: [GMAIL_SERVICE_ACCOUNT_KEY],
        timeoutSeconds: 120,
        memory: "256MiB",
    },
    async (event) => {
        if (requireRedirect && !redirectTo) {
            console.warn(`No email redirect set for database "${database}"; ticket ${event.params.ticketId} email skipped.`);
            return;
        }

        try {
            const ticket =
                event.data?.data() as any;

            if (
                !ticket?.assignedTo?.userId
            ) {
                return;
            }

            const db = getFirestore(admin.app(), database);

            const employeeEmail =
                await getAssigneeEmail(
                    db,
                    ticket
                );

            if (!employeeEmail) {
                console.log(
                    `No employee email found for ticket #${ticket.ticketNumber}`
                );
                return;
            }

            const key = JSON.parse(
                GMAIL_SERVICE_ACCOUNT_KEY.value()
            );

            const senderEmail =
                await getSenderMailbox(ticket, getFirestore(admin.app(), database));

            const content =
                "A new ticket was created and assigned to you.\n\n" +
                `Ticket Number: #${ticket.ticketNumber}\n` +
                `Subject: ${ticket.subject}\n` +
                `Campus: ${ticket.campusName || "N/A"}\n` +
                `Division: ${ticket.divisionName || ticket.division || "N/A"}\n` +
                `School: ${ticket.schoolName || ticket.school || "N/A"}\n` +
                `Grade: ${ticket.gradeName || ticket.grade || "N/A"}\n` +
                `Parent: ${ticket.parentName || "N/A"}\n\n` +
                "Please log in to the portal to review the ticket.";

            const htmlBody =
                wrapInProfessionalTemplate(
                    "New Ticket Assignment",
                    "NIS CRM Notification",
                    ticket.assignedTo.name ||
                    "Staff Member",
                    content,
                    `${baseUrl}/tickets/${event.params.ticketId}`,
                    String(ticket.ticketNumber),
                    ticket.subject || "Ticket"
                );

            await sendHtmlEmail({
                key,
                senderEmail,
                to: employeeEmail,
                subject:
                    `New Ticket Assigned: #${ticket.ticketNumber}`,
                html: htmlBody,
                redirectTo,
            });

            console.log(
                `New ticket email sent to ${employeeEmail}`
            );
        } catch (error) {
            console.error(
                "New ticket assignment notification error:",
                error
            );
        }
    }
);

function getTransferIdentity(ticket: any): {
    id: string | null;
    name: string;
} {
    return {
        id:
            ticket?.categoryId ||
            ticket?.departmentId ||
            null,
        name:
            ticket?.categoryName ||
            ticket?.departmentName ||
            "Unknown Category",
    };
}

async function getTransferStaffRecipients(
    db: admin.firestore.Firestore,
    before: any,
    after: any
): Promise<string[]> {
    const snapshot = await db
        .collection("users")
        .where(
            "role",
            "in",
            ["Manager", "Admin", "manager", "admin"]
        )
        .get();

    const oldIdentity =
        getTransferIdentity(before);

    const newIdentity =
        getTransferIdentity(after);

    const ticketCampusId =
        after.campusId || before.campusId;

    const emails: string[] = [];

    for (const doc of snapshot.docs) {
        const user = doc.data() as any;
        const role = String(
            user.role || ""
        ).toLowerCase();

        if (!user.email) continue;

        if (role === "admin") {
            emails.push(user.email);
            continue;
        }

        if (role !== "manager") continue;

        const managerDepartmentIds =
            collectEmployeeValues(
                user.departmentId,
                user.departmentIds,
                user.categoryId,
                user.categoryIds
            );

        const managerCampusIds =
            collectEmployeeValues(
                user.campusId,
                user.campusIds
            );

        const hasDepartmentRestriction =
            managerDepartmentIds.length > 0;

        const hasCampusRestriction =
            managerCampusIds.length > 0;

        const matchesDepartment =
            !hasDepartmentRestriction ||
            managerDepartmentIds.includes(
                oldIdentity.id || ""
            ) ||
            managerDepartmentIds.includes(
                newIdentity.id || ""
            );

        const matchesCampus =
            !hasCampusRestriction ||
            !ticketCampusId ||
            managerCampusIds.includes(
                ticketCampusId
            );

        if (
            matchesDepartment &&
            matchesCampus
        ) {
            emails.push(user.email);
        }
    }

    return uniqueStrings(emails);
}

const makeSendEmailToParentOnTransfer = ({ database, baseUrl, redirectTo, requireRedirect }: TicketEmailFunctionOptions) => onDocumentUpdated(
    {
        document: "tickets/{ticketId}",
        database,
        secrets: [GMAIL_SERVICE_ACCOUNT_KEY],
        timeoutSeconds: 120,
        memory: "256MiB",
    },
    async (event) => {
        if (requireRedirect && !redirectTo) {
            console.warn(`No email redirect set for database "${database}"; ticket ${event.params.ticketId} email skipped.`);
            return;
        }

        try {
            const after =
                event.data?.after.data() as any;

            const before =
                event.data?.before.data() as any;

            if (!after || !before) return;

            const oldIdentity =
                getTransferIdentity(before);

            const newIdentity =
                getTransferIdentity(after);

            if (
                oldIdentity.id ===
                newIdentity.id
            ) {
                return;
            }

            const db = getFirestore(admin.app(), database);

            const key = JSON.parse(
                GMAIL_SERVICE_ACCOUNT_KEY.value()
            );

            const senderEmail =
                await getSenderMailbox(after, getFirestore(admin.app(), database));

            const parentEmail =
                after.parentEmail ||
                after.requesterEmail ||
                after.createdFor?.email ||
                after.createdBy?.email;

            if (parentEmail) {
                const parentContent =
                    "Your ticket has been transferred to a different category.\n\n" +
                    `Ticket Number: #${after.ticketNumber}\n` +
                    `Subject: ${after.subject}\n` +
                    `Previous Category: ${oldIdentity.name}\n` +
                    `New Category: ${newIdentity.name}\n\n` +
                    "Your request will now be handled by the appropriate team.";

                const parentHtml =
                    wrapInProfessionalTemplate(
                        "Ticket Category Updated",
                        "NIS CRM Support",
                        after.parentName ||
                        after.createdBy?.name ||
                        "User",
                        parentContent,
                        `${baseUrl}/tickets/${event.params.ticketId}`,
                        String(after.ticketNumber),
                        after.subject || "Ticket"
                    );

                await sendHtmlEmail({
                    key,
                    senderEmail,
                    to: parentEmail,
                    subject:
                        `Ticket #${after.ticketNumber} Category Updated`,
                    html: parentHtml,
                    redirectTo,
                });

                console.log(
                    `Transfer email sent to user ${parentEmail}`
                );
            }

            const staffRecipients =
                await getTransferStaffRecipients(
                    db,
                    before,
                    after
                );

            for (const staffEmail of staffRecipients) {
                try {
                    const staffContent =
                        "A ticket has been transferred to a different category.\n\n" +
                        `Ticket Number: #${after.ticketNumber}\n` +
                        `Subject: ${after.subject}\n` +
                        `Previous Category: ${oldIdentity.name}\n` +
                        `New Category: ${newIdentity.name}\n` +
                        `Campus: ${after.campusName || "N/A"}\n` +
                        `Parent: ${after.parentName || "N/A"}\n\n` +
                        "Please review the ticket if any action is required.";

                    const staffHtml =
                        wrapInProfessionalTemplate(
                            "Ticket Category Transfer",
                            "NIS CRM Notification",
                            "Manager / Admin",
                            staffContent,
                            `${baseUrl}/tickets/${event.params.ticketId}`,
                            String(after.ticketNumber),
                            after.subject || "Ticket"
                        );

                    await sendHtmlEmail({
                        key,
                        senderEmail,
                        to: staffEmail,
                        subject:
                            `Ticket #${after.ticketNumber} Transferred: ${oldIdentity.name} to ${newIdentity.name}`,
                        html: staffHtml,
                        redirectTo,
                    });

                    console.log(
                        `Transfer notification sent to ${staffEmail}`
                    );
                } catch (staffError) {
                    console.error(
                        `Failed to notify ${staffEmail} about transfer:`,
                        staffError
                    );
                }
            }
        } catch (error) {
            console.error(
                "Category transfer notification error:",
                error
            );
        }
    }
);

function makeTicketEmailFunctions(options: TicketEmailFunctionOptions) {
    return {
        sendAfterHoursAutoReply: makeSendAfterHoursAutoReply(options),
        sendEmailOnAgentReply: makeSendEmailOnAgentReply(options),
        sendEmailOnAssignment: makeSendEmailOnAssignment(options),
        sendEmailOnNewTicketAssignment: makeSendEmailOnNewTicketAssignment(options),
        sendEmailToParentOnTransfer: makeSendEmailToParentOnTransfer(options),
    };
}

export const {
    sendAfterHoursAutoReply,
    sendEmailOnAgentReply,
    sendEmailOnAssignment,
    sendEmailOnNewTicketAssignment,
    sendEmailToParentOnTransfer,
} = makeTicketEmailFunctions({ database: "(default)", baseUrl: BASE_URL, redirectTo: undefined });

export const syncEmails = makeSyncEmails("(default)");

export const staging = {
    ...makeTicketEmailFunctions({
        database: "staging",
        baseUrl: "https://staging-tickting--studio-7708718228-149dc.us-central1.hosted.app",
        redirectTo: process.env.STAGING_EMAIL_REDIRECT_TO,
        requireRedirect: true,
    }),
    // Deployed as `staging-syncEmails`: polls only the mailboxes configured in the staging database.
    syncEmails: makeSyncEmails("staging"),
};

/**
 * Keeps ticket_summaries/{ticketId} (a lightweight copy without messages,
 * description, attachments, transferHistory, emailMessageIds) in sync with
 * tickets/{ticketId} for the list pages. It only READS tickets and writes
 * ticket_summaries — it never modifies tickets, so it cannot re-trigger itself
 * or any other ticket trigger. Mirrors the current ticket state inside a
 * transaction, so retries / out-of-order events always converge.
 */
export const mirrorTicketSummary = onDocumentWritten(
    // minInstances: 1 keeps one warm instance so list pages see changes in ~1s
    // instead of waiting for a cold start of this (large) functions bundle.
    { document: "tickets/{ticketId}", retry: true, minInstances: 1 },
    async (event) => {
        const ticketId = event.params.ticketId;
        const result = await mirrorTicketSummaryDoc(admin.firestore(), ticketId);
        if (result === "deleted") {
            console.log(`[mirrorTicketSummary] removed summary for deleted ticket ${ticketId}`);
        }
    }
);

/**
 * Settings > Email Configurations > "Test connection".
 * Admin only. Impersonates the mailbox with the Gmail service account exactly
 * like syncEmails does, so a failure here is the same failure the sync would hit.
 */
const ALLOWED_DATABASES = new Set(["(default)", "staging"]);

export const testMailboxConnection = onCall(
    {
        secrets: [GMAIL_SERVICE_ACCOUNT_KEY],
        memory: "256MiB",
        timeoutSeconds: 60,
    },
    async (request) => {
        const uid = request.auth?.uid;
        if (!uid) {
            throw new HttpsError("unauthenticated", "Sign in required.");
        }
        // The web app passes its Firestore database id so the test runs against the same
        // environment (production "(default)" or test "staging"); anything else is rejected.
        const requestedDb = String(request.data?.database || "(default)");
        if (!ALLOWED_DATABASES.has(requestedDb)) {
            throw new HttpsError("invalid-argument", `Unknown database "${requestedDb}".`);
        }
        const db = getFirestore(admin.app(), requestedDb);
        let actor = (await db.collection("users").doc(uid).get()).data();
        if (!actor) {
            const byAuth = await db.collection("users").where("authId", "==", uid).limit(1).get();
            actor = byAuth.docs[0]?.data();
        }
        if (actor?.role !== "Admin") {
            throw new HttpsError("permission-denied", "Only administrators can test mailboxes.");
        }

        const email = String(request.data?.email || "").trim().toLowerCase();
        const mailboxId = String(request.data?.mailboxId || "").trim();
        if (!email || !email.includes("@")) {
            throw new HttpsError("invalid-argument", "A mailbox email address is required.");
        }

        const keyString = GMAIL_SERVICE_ACCOUNT_KEY.value();
        if (!keyString) {
            throw new HttpsError("failed-precondition", "GMAIL_SERVICE_ACCOUNT_KEY secret is missing.");
        }
        const key = JSON.parse(keyString);
        const startedAt = Date.now();
        const mailboxRef = mailboxId ? db.collection(MAILBOXES_COLLECTION).doc(mailboxId) : null;

        try {
            const gmail = await createGmailClient(key, email, [
                "https://www.googleapis.com/auth/gmail.readonly",
                "https://www.googleapis.com/auth/gmail.modify",
                "https://www.googleapis.com/auth/gmail.send",
            ]);
            const profile = await gmail.users.getProfile({ userId: "me" });
            const inbox = await gmail.users.messages.list({
                userId: "me",
                q: "in:inbox newer_than:7d",
                maxResults: 1,
            });
            if (mailboxRef) {
                await mailboxRef.set(
                    {
                        lastTestAt: admin.firestore.FieldValue.serverTimestamp(),
                        lastTestStatus: "ok",
                        lastTestError: null,
                    },
                    { merge: true }
                );
            }
            return {
                ok: true,
                emailAddress: profile.data.emailAddress || email,
                messagesTotal: profile.data.messagesTotal ?? null,
                inboxLast7Days: inbox.data.resultSizeEstimate ?? 0,
                durationMs: Date.now() - startedAt,
            };
        } catch (error: any) {
            const message = String(error?.message || error);
            console.warn(`MAILBOX TEST FAILED: ${email}: ${message}`);
            if (mailboxRef) {
                await mailboxRef.set(
                    {
                        lastTestAt: admin.firestore.FieldValue.serverTimestamp(),
                        lastTestStatus: "failed",
                        lastTestError: message.slice(0, 500),
                    },
                    { merge: true }
                );
            }
            return { ok: false, error: message, durationMs: Date.now() - startedAt };
        }
    }
);

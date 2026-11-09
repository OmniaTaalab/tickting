/**
 * Mailbox (email queue) configuration loaded from Firestore.
 *
 * Settings > Email Configurations writes `mailboxes/{id}`; this module turns
 * those documents plus the campus tree (`campuses/{id}.schoolConfigs[].divisions[]`)
 * into the routing shape the Gmail sync has always used: one route per
 * (school, division) pair with the grade NAMES that belong to it.
 *
 * Nothing about mailboxes is hard-coded any more. Seed the collection from the
 * previous code list with `node functions/scripts/seed-mailboxes.cjs`.
 */
import type * as FirebaseFirestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

export type MailboxScope = "department" | "campus" | "academic";

export type MailboxRoute = {
    division: string;
    school: string;
    grades: string[];
};

export type MailboxConfig = {
    id: string;
    email: string;
    displayName?: string;
    /** Category (department) display name, kept for logs and legacy readers. */
    department: string;
    departmentId: string;
    scope: MailboxScope;
    campusId?: string;
    campusName?: string;
    routes: MailboxRoute[];
    enabled: boolean;
    /** Director-style queues: only these staff emails (lower-cased) are assigned. */
    assignTo?: string[];
    /** Ids as stored, used when a ticket is written. */
    schoolIds: string[];
    divisionIds: string[];
};

export const MAILBOXES_COLLECTION = "mailboxes";

type CampusDivisionConfig = { divisionId: string; gradeIds?: string[] };
type CampusSchoolConfig = { schoolId: string; gradeIds?: string[]; divisions?: CampusDivisionConfig[] };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const strList = (v: unknown): string[] =>
    Array.isArray(v) ? Array.from(new Set(v.map(str).filter(Boolean))) : [];

async function nameMap(
    db: FirebaseFirestore.Firestore,
    collection: string
): Promise<Map<string, string>> {
    const snap = await db.collection(collection).get();
    const map = new Map<string, string>();
    for (const doc of snap.docs) {
        const name = str((doc.data() as any)?.name);
        if (name) map.set(doc.id, name);
    }
    return map;
}

function routesFor(
    schoolIds: string[],
    divisionIds: string[],
    schoolConfigs: CampusSchoolConfig[],
    names: { schools: Map<string, string>; divisions: Map<string, string>; grades: Map<string, string> },
    directorStyle: boolean
): MailboxRoute[] {
    const routes: MailboxRoute[] = [];
    for (const cfg of schoolConfigs) {
        if (!cfg?.schoolId || !schoolIds.includes(cfg.schoolId)) continue;
        const school = names.schools.get(cfg.schoolId);
        if (!school) continue;
        // Director-style queue: selected divisions label the queue and cover every grade
        // the school offers (legacy school grades + division grades).
        if (directorStyle) {
            const all = Array.from(new Set([...(cfg.gradeIds || []), ...(cfg.divisions || []).flatMap((d) => d.gradeIds || [])]));
            const grades = Array.from(new Set(all.map((g) => names.grades.get(g)).filter((g): g is string => Boolean(g))));
            for (const divisionId of divisionIds) {
                const division = names.divisions.get(divisionId);
                if (division && grades.length) routes.push({ school, division, grades });
            }
            continue;
        }
        for (const div of cfg.divisions || []) {
            if (!div?.divisionId || !divisionIds.includes(div.divisionId)) continue;
            const division = names.divisions.get(div.divisionId);
            if (!division) continue;
            const grades = Array.from(
                new Set((div.gradeIds || []).map((g) => names.grades.get(g)).filter((g): g is string => Boolean(g)))
            );
            if (!grades.length) continue;
            routes.push({ school, division, grades });
        }
    }
    return routes;
}

/** Read every mailbox document and resolve its routes against the campus tree. */
export async function loadMailboxConfigs(
    db: FirebaseFirestore.Firestore
): Promise<MailboxConfig[]> {
    const [mailboxSnap, campusSnap, schools, divisions, grades, departments] = await Promise.all([
        db.collection(MAILBOXES_COLLECTION).get(),
        db.collection("campuses").get(),
        nameMap(db, "schools"),
        nameMap(db, "divisions"),
        nameMap(db, "grades"),
        nameMap(db, "departments"),
    ]);

    const campuses = new Map<string, { name: string; schoolConfigs: CampusSchoolConfig[] }>();
    for (const doc of campusSnap.docs) {
        const data = doc.data() as any;
        campuses.set(doc.id, {
            name: str(data?.name),
            schoolConfigs: Array.isArray(data?.schoolConfigs) ? data.schoolConfigs : [],
        });
    }

    const configs: MailboxConfig[] = [];
    for (const doc of mailboxSnap.docs) {
        const data = doc.data() as any;
        const email = str(data?.email).toLowerCase();
        const departmentId = str(data?.departmentId);
        if (!email || !departmentId) {
            console.warn(`MAILBOX CONFIG SKIPPED (missing email or category): ${doc.id}`);
            continue;
        }
        const scope: MailboxScope =
            data?.scope === "academic" || data?.scope === "campus" || data?.scope === "department"
                ? data.scope
                : "department";
        const campusId = scope === "department" ? undefined : str(data?.campusId) || undefined;
        const campus = campusId ? campuses.get(campusId) : undefined;
        const schoolIds = strList(data?.schoolIds);
        const divisionIds = strList(data?.divisionIds);
        const assignTo = strList(data?.assignTo).map((e) => e.toLowerCase());
        const routes =
            scope === "academic" && campus
                ? routesFor(schoolIds, divisionIds, campus.schoolConfigs, { schools, divisions, grades }, assignTo.length > 0)
                : [];
        if (scope === "academic" && !routes.length) {
            console.warn(`MAILBOX ${email}: academic scope but no resolvable routes on campus ${campusId}`);
        }
        configs.push({
            id: doc.id,
            email,
            displayName: str(data?.displayName) || undefined,
            department: departments.get(departmentId) || str(data?.departmentName) || departmentId,
            departmentId,
            scope,
            campusId,
            campusName: campus?.name || str(data?.campusName) || undefined,
            routes,
            enabled: data?.enabled !== false,
            assignTo,
            schoolIds,
            divisionIds,
        });
    }

    return configs.sort((a, b) => a.email.localeCompare(b.email));
}

let cache: { at: number; configs: MailboxConfig[] } | null = null;

/** Cached loader for the email triggers (they run far more often than the config changes). */
export async function getCachedMailboxConfigs(
    db: FirebaseFirestore.Firestore,
    maxAgeMs = 60_000
): Promise<MailboxConfig[]> {
    if (cache && Date.now() - cache.at < maxAgeMs) return cache.configs;
    const configs = await loadMailboxConfigs(db);
    cache = { at: Date.now(), configs };
    return configs;
}

const lastRecorded = new Map<string, { status: string; at: number }>();
const SYNC_STATUS_REFRESH_MS = 10 * 60_000;

/**
 * Store the result of the latest Gmail poll on the mailbox document (shown in Settings).
 * The sync runs every 2 minutes for every mailbox, so the write is throttled per instance:
 * immediately when the status flips (ok <-> failed), otherwise at most every 10 minutes.
 */
export async function recordMailboxSync(
    db: FirebaseFirestore.Firestore,
    mailboxId: string,
    result: { status: "ok"; messageCount: number } | { status: "failed"; error: string }
): Promise<void> {
    const previous = lastRecorded.get(mailboxId);
    if (previous && previous.status === result.status && Date.now() - previous.at < SYNC_STATUS_REFRESH_MS) {
        return;
    }
    lastRecorded.set(mailboxId, { status: result.status, at: Date.now() });
    try {
        await db.collection(MAILBOXES_COLLECTION).doc(mailboxId).set(
            {
                lastSyncAt: FieldValue.serverTimestamp(),
                lastSyncStatus: result.status,
                lastSyncError: result.status === "failed" ? result.error.slice(0, 500) : null,
                lastSyncMessageCount: result.status === "ok" ? result.messageCount : null,
            },
            { merge: true }
        );
    } catch (error) {
        console.warn(`Could not record sync status for mailbox ${mailboxId}:`, error);
    }
}

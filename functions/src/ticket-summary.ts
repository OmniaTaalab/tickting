/**
 * ticket_summaries mirror
 * =======================
 * A lightweight copy of every `tickets/{id}` document, stored at
 * `ticket_summaries/{id}` (same id), used ONLY by the list pages
 * (sidebar, tickets list, dashboard, tasks, analytics, track-history).
 *
 * Those pages never read the heavy fields below (verified by a full code map),
 * so they produce identical output from a summary as from the full ticket.
 * The ticket detail page and every server action keep reading `tickets`.
 *
 * Shared by the Cloud Function trigger (mirrorTicketSummary) and the backfill
 * script (functions/scripts/backfill-ticket-summaries.cjs) so they can never drift.
 */
import type * as FirebaseFirestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

export const TICKETS_COLLECTION = "tickets";
export const SUMMARIES_COLLECTION = "ticket_summaries";
/** Tombstones: ticket_summaries_deleted/{id} { deletedAt } written when a summary is removed. */
export const DELETED_COLLECTION = "ticket_summaries_deleted";
/**
 * Server commit time of the last summary write. Lets a client that loaded a snapshot
 * at time T subscribe to "summaries changed since T" instead of re-streaming everything.
 * Not part of the summary content (ignored by equality checks).
 */
export const SYNCED_AT_FIELD = "_summarySyncedAt";

/** Summary content without bookkeeping fields. */
export function summaryContent(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!data || !Object.prototype.hasOwnProperty.call(data, SYNCED_AT_FIELD)) return data;
    const rest = { ...data };
    delete rest[SYNCED_AT_FIELD];
    return rest;
}

/** Fields no list page reads. Everything else is copied verbatim. */
export const DROPPED_FIELDS: ReadonlySet<string> = new Set([
    "messages",
    "description",
    "attachments",
    "transferHistory",
    "emailMessageIds",
]);

type Scalar = string | number | boolean | null;

function isScalar(v: unknown): v is Scalar | undefined {
    return v === undefined || v === null ||
        typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v) &&
        Object.getPrototypeOf(v) === Object.prototype;
}

function addUnique(target: Scalar[], seen: Set<string>, value: Scalar | undefined) {
    const v: Scalar = value === undefined ? null : value;
    const key = typeof v + ":" + String(v);
    if (!seen.has(key)) {
        seen.add(key);
        target.push(v);
    }
}

/**
 * The tickets page scope filter only ever reads
 *   routingOptions.map(r => r.school)
 *   routingOptions.map(r => r.division)
 *   routingOptions.flatMap(r => r.grades || [])
 * and tests "does ANY value match" after normalising each value with
 * String(value ?? ''). So the de-duplicated value sets are equivalent.
 * (undefined is stored as null; both normalise to ''.)
 *
 * Returns null when routingOptions has any shape where that equivalence is not
 * provable (non-object entries, nested objects/arrays as values); the caller
 * then keeps the raw routingOptions so behaviour stays identical.
 */
export function compactRoutingScope(routingOptions: unknown):
    { schools: Scalar[]; divisions: Scalar[]; grades: Scalar[] } | null {
    if (!Array.isArray(routingOptions)) return null;
    const schools: Scalar[] = [];
    const divisions: Scalar[] = [];
    const grades: Scalar[] = [];
    const seenS = new Set<string>();
    const seenD = new Set<string>();
    const seenG = new Set<string>();
    for (const route of routingOptions) {
        if (!isPlainObject(route)) return null;
        const school = route.school;
        const division = route.division;
        if (!isScalar(school) || !isScalar(division)) return null;
        addUnique(schools, seenS, school);
        addUnique(divisions, seenD, division);
        const g = route.grades;
        if (!g) continue; // `r.grades || []` contributes nothing
        if (Array.isArray(g)) {
            for (const item of g) {
                if (!isScalar(item)) return null;
                addUnique(grades, seenG, item);
            }
        } else if (isScalar(g)) {
            addUnique(grades, seenG, g); // flatMap keeps a non-array value as one element
        } else {
            return null;
        }
    }
    return { schools, divisions, grades };
}

/** Build the summary document for a ticket's current data. */
export function buildTicketSummary(ticket: Record<string, unknown>): Record<string, unknown> {
    const summary: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(ticket)) {
        if (DROPPED_FIELDS.has(key) || key === "routingOptions" || key === SYNCED_AT_FIELD) continue;
        summary[key] = value;
    }
    if (Object.prototype.hasOwnProperty.call(ticket, "routingOptions")) {
        const scope = compactRoutingScope(ticket.routingOptions);
        if (scope) {
            summary.routingScope = scope;
        } else {
            summary.routingOptions = ticket.routingOptions; // keep raw: exact behaviour
        }
    }
    return summary;
}

/** Deep equality for Firestore values (Timestamp/GeoPoint/DocumentReference via isEqual). */
export function firestoreValuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null || a === undefined || b === undefined) return false;
    if (typeof a !== typeof b) return false;
    if (typeof a === "number") return Number.isNaN(a) && Number.isNaN(b as number);
    if (typeof a !== "object") return false;
    const ae = (a as { isEqual?: (o: unknown) => boolean }).isEqual;
    if (typeof ae === "function") {
        try {
            return ae.call(a, b);
        } catch {
            return false;
        }
    }
    if (Buffer.isBuffer(a) || Buffer.isBuffer(b)) {
        return Buffer.isBuffer(a) && Buffer.isBuffer(b) && a.equals(b);
    }
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!firestoreValuesEqual(a[i], b[i])) return false;
        }
        return true;
    }
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
        if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
        if (!firestoreValuesEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
            return false;
        }
    }
    return true;
}

export type MirrorResult = "written" | "deleted" | "unchanged" | "absent";

/**
 * Make ticket_summaries/{id} match the CURRENT state of tickets/{id}.
 *
 * Reads the ticket inside a transaction (instead of trusting event payloads), so
 * out-of-order / duplicate / retried trigger events always converge to the
 * latest committed ticket state, and deletes are never "resurrected".
 * Idempotent: safe to run any number of times (trigger retries, backfill reruns).
 */
export async function mirrorTicketSummary(
    db: FirebaseFirestore.Firestore,
    ticketId: string,
    options: { dryRun?: boolean } = {}
): Promise<MirrorResult> {
    const ticketRef = db.collection(TICKETS_COLLECTION).doc(ticketId);
    const summaryRef = db.collection(SUMMARIES_COLLECTION).doc(ticketId);
    const tombstoneRef = db.collection(DELETED_COLLECTION).doc(ticketId);
    const dryRun = options.dryRun === true;
    // Dry runs use a read-only transaction: no locks are taken on live tickets.
    return db.runTransaction(async (tx) => {
        const [ticketSnap, summarySnap] = await tx.getAll(ticketRef, summaryRef);
        if (!ticketSnap.exists) {
            if (!summarySnap.exists) return "absent";
            if (!dryRun) {
                tx.delete(summaryRef);
                tx.set(tombstoneRef, { deletedAt: FieldValue.serverTimestamp() });
            }
            return "deleted";
        }
        const summary = buildTicketSummary(ticketSnap.data() as Record<string, unknown>);
        if (summarySnap.exists && firestoreValuesEqual(summaryContent(summarySnap.data()), summary)) {
            return "unchanged";
        }
        if (!dryRun) tx.set(summaryRef, { ...summary, [SYNCED_AT_FIELD]: FieldValue.serverTimestamp() });
        return "written";
    }, dryRun ? { readOnly: true } : undefined);
}

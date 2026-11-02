import { Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { TIMESTAMP_MARKER } from '@/lib/ticket-scope';

/**
 * Per-instance in-memory copy of ticket_summaries for /api/ticket-summaries.
 *
 * PULL model (no background listener): Cloud Run throttles CPU between requests, so a
 * background listener could silently fall behind. Instead:
 *  - bootstrap: read every summary once (read-only transaction => one consistent readTime);
 *  - on each request (at most every SYNC_INTERVAL_MS): in a read-only transaction, read the
 *    summaries with _summarySyncedAt >= readTime and tombstones with deletedAt >= readTime,
 *    apply them, and advance readTime to that transaction's read time.
 * Every summary write (mirrorTicketSummary) stamps _summarySyncedAt = commit time and every
 * delete writes a tombstone in the same transaction, so the map always equals
 * ticket_summaries "as of readTime".
 */
const SUMMARIES = 'ticket_summaries';
const DELETED = 'ticket_summaries_deleted';
const SYNCED_AT = '_summarySyncedAt';
const SYNC_INTERVAL_MS = 2_000;

type Snapshot = { docs: Map<string, DocumentData>; readTime: Timestamp };

let current: Snapshot | null = null;
const lastTs = new Map<string, Timestamp>(); // latest applied commit time per id
let lastSyncAt = 0;
let inflight: Promise<Snapshot> | null = null;

function newer(a: Timestamp, b: Timestamp | undefined) {
  return !b || a.toMillis() > b.toMillis() || (a.toMillis() === b.toMillis() && a.nanoseconds >= b.nanoseconds);
}

async function bootstrap(db: Firestore): Promise<Snapshot> {
  const t0 = Date.now();
  const snap = await db.runTransaction(tx => tx.get(db.collection(SUMMARIES)), { readOnly: true });
  const docs = new Map<string, DocumentData>();
  for (const d of snap.docs) {
    const data = d.data();
    docs.set(d.id, data);
    const ts = data[SYNCED_AT];
    if (ts instanceof Timestamp) lastTs.set(d.id, ts);
  }
  console.log(`[ticket-summary-cache] bootstrap ${docs.size} summaries in ${Date.now() - t0}ms`);
  return { docs, readTime: snap.readTime };
}

async function catchUp(db: Firestore, prev: Snapshot): Promise<Snapshot> {
  const [changed, deleted] = await db.runTransaction(
    async tx => [
      await tx.get(db.collection(SUMMARIES).where(SYNCED_AT, '>=', prev.readTime)),
      await tx.get(db.collection(DELETED).where('deletedAt', '>=', prev.readTime)),
    ] as const,
    { readOnly: true }
  );
  if (changed.empty && deleted.empty) return { docs: prev.docs, readTime: changed.readTime };
  const docs = new Map(prev.docs); // copy-on-write: in-flight requests keep their view
  for (const d of changed.docs) {
    const data = d.data();
    const ts = data[SYNCED_AT];
    if (!(ts instanceof Timestamp) || !newer(ts, lastTs.get(d.id))) continue;
    lastTs.set(d.id, ts);
    docs.set(d.id, data);
  }
  for (const d of deleted.docs) {
    const ts = d.get('deletedAt');
    if (!(ts instanceof Timestamp) || !newer(ts, lastTs.get(d.id))) continue;
    lastTs.set(d.id, ts);
    docs.delete(d.id);
  }
  return { docs, readTime: changed.readTime };
}

/** Consistent snapshot of all summaries "as of readTime". Single-flight. */
export function getTicketSummarySnapshot(db: Firestore): Promise<Snapshot> {
  if (inflight) return inflight;
  if (current && Date.now() - lastSyncAt < SYNC_INTERVAL_MS) return Promise.resolve(current);
  inflight = (current ? catchUp(db, current) : bootstrap(db))
    .then(s => {
      current = s;
      lastSyncAt = Date.now();
      return s;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Warm the cache in the background (server boot). Errors are logged, not thrown. */
export function warmTicketSummaryCache(db: Firestore) {
  getTicketSummarySnapshot(db).catch(e => console.error('[ticket-summary-cache] warm-up failed:', e?.message || e));
}

export class UnsupportedValueError extends Error {}

/**
 * Encode an Admin-SDK value as JSON that the client decodes back into exactly what the
 * client SDK's doc.data() would return (Timestamps as firebase/firestore Timestamp).
 * Any value type we cannot round-trip exactly throws, and the client falls back to the
 * normal Firestore listener path.
 */
export function encodeValue(v: unknown): unknown {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || Object.is(v, -0)) throw new UnsupportedValueError('non-JSON number');
    return v;
  }
  if (v instanceof Timestamp) return { [TIMESTAMP_MARKER]: [v.seconds, v.nanoseconds] };
  if (Array.isArray(v)) return v.map(encodeValue);
  if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === TIMESTAMP_MARKER) throw new UnsupportedValueError('reserved key');
      out[k] = encodeValue(val);
    }
    return out;
  }
  throw new UnsupportedValueError(`unsupported value type ${(v as object)?.constructor?.name ?? typeof v}`);
}

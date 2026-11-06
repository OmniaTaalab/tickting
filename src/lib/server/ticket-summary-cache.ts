import { Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { TIMESTAMP_MARKER } from '@/lib/ticket-scope';

/**
 * Per-instance in-memory copy of ticket_summaries for /api/ticket-summaries.
 *
 * PULL model (no background listener): Cloud Run allocates CPU only while a request is
 * in flight, so background work stalls. Instead:
 *  - bootstrap (first request on an instance): read every summary once in a read-only
 *    transaction => one consistent readTime;
 *  - on each request (at most every SYNC_INTERVAL_MS): in a read-only transaction, read the
 *    summaries with _summarySyncedAt >= readTime and tombstones with deletedAt >= readTime,
 *    apply them, and advance readTime to that transaction's read time.
 * Every summary write (mirrorTicketSummary) stamps _summarySyncedAt = commit time and every
 * delete writes a tombstone in the same transaction, so the map always equals
 * ticket_summaries "as of readTime".
 *
 * Each document's JSON row is serialised ONCE (when it is loaded or changes) and cached, so
 * building a response is a filter + join of pre-built strings instead of re-encoding ~17k
 * documents per request.
 */
const SUMMARIES = 'ticket_summaries';
const DELETED = 'ticket_summaries_deleted';
const SYNCED_AT = '_summarySyncedAt';
const SYNC_INTERVAL_MS = 2_000;

export type CachedDoc = {
  data: DocumentData;
  /** { ...data, id } — the shape list pages receive from a Firestore listener. Treat as immutable. */
  item: DocumentData & { id: string };
  /** JSON.stringify([id, encodeValue(data)]), or null if the doc cannot be encoded exactly. */
  row: string | null;
};
type Snapshot = { docs: Map<string, CachedDoc>; readTime: Timestamp };

let current: Snapshot | null = null;
const lastTs = new Map<string, Timestamp>(); // latest applied commit time per id
let lastSyncAt = 0;
let inflight: Promise<Snapshot> | null = null;

function newer(a: Timestamp, b: Timestamp | undefined) {
  return !b || a.toMillis() > b.toMillis() || (a.toMillis() === b.toMillis() && a.nanoseconds >= b.nanoseconds);
}

function toCached(id: string, data: DocumentData): CachedDoc {
  let row: string | null = null;
  try {
    row = JSON.stringify([id, encodeValue(data)]);
  } catch (e) {
    if (!(e instanceof UnsupportedValueError)) throw e;
    console.warn(`[ticket-summary-cache] ${id} cannot be encoded exactly: ${e.message}`);
  }
  return { data, item: { ...data, id }, row };
}

async function bootstrap(db: Firestore): Promise<Snapshot> {
  const t0 = Date.now();
  const snap = await db.runTransaction(tx => tx.get(db.collection(SUMMARIES)), { readOnly: true });
  const t1 = Date.now();
  const docs = new Map<string, CachedDoc>();
  for (const d of snap.docs) {
    const data = d.data();
    docs.set(d.id, toCached(d.id, data));
    const ts = data[SYNCED_AT];
    if (ts instanceof Timestamp) lastTs.set(d.id, ts);
  }
  console.log(`[ticket-summary-cache] bootstrap ${docs.size} summaries: read ${t1 - t0}ms, encode ${Date.now() - t1}ms`);
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
    docs.set(d.id, toCached(d.id, data));
  }
  for (const d of deleted.docs) {
    const ts = d.get('deletedAt');
    if (!(ts instanceof Timestamp) || !newer(ts, lastTs.get(d.id))) continue;
    lastTs.set(d.id, ts);
    docs.delete(d.id);
  }
  return { docs, readTime: changed.readTime };
}

function sync(db: Firestore, force: boolean): Promise<Snapshot> {
  if (inflight) return inflight;
  if (!force && current && Date.now() - lastSyncAt < SYNC_INTERVAL_MS) return Promise.resolve(current);
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

const tsLess = (a: Timestamp, b: Timestamp) =>
  a.seconds < b.seconds || (a.seconds === b.seconds && a.nanoseconds < b.nanoseconds);

/**
 * Consistent snapshot of all summaries "as of readTime". Single-flight; served from the
 * last sync when it is less than SYNC_INTERVAL_MS old.
 *
 * `minReadTime`: a client that has already observed a commit (through its own Firestore
 * listener) passes that commit time, and the snapshot is re-synced until readTime >= it,
 * so a response can never be older than what the client already knows. A catch-up started
 * after the commit always sees it (transaction readTime >= commit time), so one extra sync
 * normally suffices; bounded to avoid spinning on a bogus far-future value.
 */
export async function getTicketSummarySnapshot(db: Firestore, minReadTime?: Timestamp | null): Promise<Snapshot> {
  let snap = await sync(db, false);
  if (!minReadTime) return snap;
  for (let attempt = 0; attempt < 3 && tsLess(snap.readTime, minReadTime); attempt++) {
    snap = await sync(db, true);
  }
  if (tsLess(snap.readTime, minReadTime)) {
    console.warn(`[ticket-summary-cache] could not reach minReadTime ${minReadTime.toMillis()} (have ${snap.readTime.toMillis()})`);
  }
  return snap;
}

export class UnsupportedValueError extends Error {}

/**
 * Timestamp detection that also works if the bundle contains more than one copy of the
 * Firestore library (then `instanceof` fails across copies). A Firestore map value is always
 * a plain object, so a non-plain object named Timestamp with toMillis() is unambiguous.
 */
function isTimestamp(v: unknown): v is Timestamp {
  if (v instanceof Timestamp) return true;
  if (typeof v !== 'object' || v === null || Object.getPrototypeOf(v) === Object.prototype) return false;
  const t = v as { seconds?: unknown; nanoseconds?: unknown; toMillis?: unknown; constructor?: { name?: string } };
  return (
    t.constructor?.name === 'Timestamp' &&
    typeof t.seconds === 'number' &&
    typeof t.nanoseconds === 'number' &&
    typeof t.toMillis === 'function'
  );
}

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
  if (isTimestamp(v)) return { [TIMESTAMP_MARKER]: [v.seconds, v.nanoseconds] };
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

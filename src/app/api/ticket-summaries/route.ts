import { gzip } from 'zlib';
import { promisify } from 'util';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';
import { compareDocIds, inTicketScope, parseTicketScope, scopeKey, type TicketScope } from '@/lib/ticket-scope';
import { encodeValue, getTicketSummarySnapshot, UnsupportedValueError } from '@/lib/server/ticket-summary-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const gzipAsync = promisify(gzip);

/**
 * POST /api/ticket-summaries  { scope }   (Authorization: Bearer <Firebase ID token>)
 *
 * Returns the ticket_summaries documents in `scope` (same predicate as the Firestore query
 * the page would otherwise run), in Firestore document-id order, plus the snapshot readTime
 * (also in the x-read-time header). The client subscribes only to summaries changed at/after
 * readTime and shows nothing until it has caught up, so it is exactly as live as a listener.
 * gzip: ~2.3 MB for all ~15k summaries instead of ~70 MB streamed by a Firestore listener.
 */

// Short-lived per-scope cache of compressed bodies (bounded: TTL + entry + byte caps).
const BODY_TTL_MS = 10_000;
const MAX_ENTRIES = 24;
const MAX_BYTES = 64 * 1024 * 1024;
type Body = { at: number; body: Buffer; readTime: string; rows: number };
const bodyCache = new Map<string, Body>();
const building = new Map<string, Promise<Body>>();

function evict() {
  const now = Date.now();
  let bytes = 0;
  for (const [k, v] of bodyCache) {
    if (now - v.at >= BODY_TTL_MS) bodyCache.delete(k);
    else bytes += v.body.length;
  }
  // Oldest first (Map keeps insertion order).
  for (const [k, v] of bodyCache) {
    if (bodyCache.size <= MAX_ENTRIES && bytes <= MAX_BYTES) break;
    bodyCache.delete(k);
    bytes -= v.body.length;
  }
}

async function buildBody(scope: TicketScope): Promise<Body> {
  const t0 = Date.now();
  const { docs, readTime } = await getTicketSummarySnapshot(adminDb!);
  const ids: string[] = [];
  docs.forEach((data, id) => {
    if (inTicketScope(scope, data)) ids.push(id);
  });
  ids.sort(compareDocIds);
  const rows = ids.map(id => [id, encodeValue(docs.get(id))]);
  const json = JSON.stringify({ v: 1, readTime: [readTime.seconds, readTime.nanoseconds], rows });
  const t1 = Date.now();
  const body = await gzipAsync(json);
  console.log(
    `[api/ticket-summaries] ${scopeKey(scope).slice(0, 24)} rows=${rows.length} raw=${json.length} gz=${body.length} ` +
      `build=${t1 - t0}ms gzip=${Date.now() - t1}ms readTimeAge=${Date.now() - readTime.toMillis()}ms`
  );
  return { at: Date.now(), body, readTime: `${readTime.seconds}.${readTime.nanoseconds}`, rows: rows.length };
}

export async function POST(req: Request) {
  if (!adminAuth || !adminDb) {
    return Response.json({ error: 'admin-unavailable' }, { status: 503 });
  }

  const authHeader = req.headers.get('authorization') || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  try {
    await adminAuth.verifyIdToken(idToken);
  } catch {
    return Response.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let scope: TicketScope | null;
  try {
    scope = parseTicketScope((await req.json())?.scope);
  } catch {
    scope = null;
  }
  if (!scope) return Response.json({ error: 'bad-scope' }, { status: 400 });

  const key = scopeKey(scope);
  evict();
  let entry = bodyCache.get(key);
  if (!entry) {
    let pending = building.get(key);
    if (!pending) {
      pending = buildBody(scope).finally(() => building.delete(key));
      building.set(key, pending);
    }
    try {
      entry = await pending;
    } catch (e) {
      if (e instanceof UnsupportedValueError) {
        console.warn('[api/ticket-summaries] unsupported value, client will fall back:', e.message);
        return Response.json({ error: 'unsupported-value' }, { status: 409 });
      }
      console.error('[api/ticket-summaries] failed:', e);
      return Response.json({ error: 'failed' }, { status: 500 });
    }
    bodyCache.set(key, entry);
    evict();
  }

  return new Response(new Uint8Array(entry.body), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-encoding': 'gzip',
      'cache-control': 'no-store',
      'x-read-time': entry.readTime,
    },
  });
}

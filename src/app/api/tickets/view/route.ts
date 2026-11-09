import { gzip } from 'zlib';
import { promisify } from 'util';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';
import { UnsupportedValueError } from '@/lib/server/ticket-summary-cache';
import { computeTicketsView, parseTicketsViewRequest } from '@/lib/server/tickets-view-server';
import type { ViewerProfile } from '@/lib/tickets-view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const gzipAsync = promisify(gzip);

/**
 * POST /api/tickets/view   (Authorization: Bearer <Firebase ID token>)
 * Body: { filters, status, page, pageSize, mode: 'page' | 'all' }
 *
 * Returns one page of the tickets list (or all filtered rows for export) plus the
 * totals the page shows, computed on the server with the same code the page runs
 * (src/lib/tickets-view.ts). The viewer's role/department come from users/{uid} on the
 * server — never from the request.
 */
export async function POST(req: Request) {
  if (!adminAuth || !adminDb) {
    return Response.json({ error: 'admin-unavailable' }, { status: 503 });
  }

  const authHeader = req.headers.get('authorization') || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try {
    uid = (await adminAuth.verifyIdToken(idToken)).uid;
  } catch {
    return Response.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let request;
  try {
    request = parseTicketsViewRequest(await req.json());
  } catch {
    request = null;
  }
  if (!request) return Response.json({ error: 'bad-request' }, { status: 400 });

  const t0 = Date.now();
  try {
    const profileSnap = await adminDb.collection('users').doc(uid).get();
    const profile = (profileSnap.exists ? (profileSnap.data() as ViewerProfile) : null);
    const view = await computeTicketsView(adminDb, uid, profile, request);
    const t1 = Date.now();
    const json =
      `{"v":1,"readTime":[${view.readTime[0]},${view.readTime[1]}],"totalItems":${view.totalItems},` +
      `"statusCounts":${JSON.stringify(view.statusCounts)},"hasDuplicateTicketNumber":${view.hasDuplicateTicketNumber},` +
      `"assigneeOptions":${JSON.stringify(view.assigneeOptions)},"ids":${view.ids ? JSON.stringify(view.ids) : 'null'},` +
      `"rows":[${view.rows.join(',')}]}`;
    const body = await gzipAsync(json, { level: 4 });
    console.log(
      `[api/tickets/view] uid=${uid.slice(0, 6)} mode=${request.mode} page=${request.page} rows=${view.rows.length}${view.ids ? ` ids=${view.ids.length}` : ''} total=${view.totalItems} ` +
        `compute=${t1 - t0}ms gzip=${Date.now() - t1}ms gz=${body.length}`
    );
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-encoding': 'gzip',
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof UnsupportedValueError) {
      console.warn('[api/tickets/view] unsupported value, client will fall back:', e.message);
      return Response.json({ error: 'unsupported-value' }, { status: 409 });
    }
    console.error('[api/tickets/view] failed:', e);
    return Response.json({ error: 'failed' }, { status: 500 });
  }
}

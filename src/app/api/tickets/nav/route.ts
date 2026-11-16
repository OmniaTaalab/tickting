import { adminAuth, adminDb } from '@/lib/firebaseAdmin';
import { computeTicketNav, parseTicketNavRequest } from '@/lib/server/ticket-nav-server';
import { getViewerProfile } from '@/lib/server/viewer-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/tickets/nav   (Authorization: Bearer <Firebase ID token>)
 * Body: { ticketId, before: string[] | null, after: string[] | null, profileKey?, minReadTime? }
 *
 * Returns { v: 1, visible, prev, next }: the Previous / Next ticket ids for the ticket page,
 * computed on the server (src/lib/server/ticket-nav-server.ts) so the browser does not have
 * to download a list of tickets to find two neighbours. The viewer's role / category /
 * campuses come from users/{uid} on the server — never from the request.
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const request = parseTicketNavRequest(body);
  if (!request) return Response.json({ error: 'bad-request' }, { status: 400 });
  const rawKey = (body as Record<string, unknown>).profileKey;
  const clientProfileKey = typeof rawKey === 'string' && rawKey.length <= 2000 ? rawKey : null;

  const t0 = Date.now();
  try {
    const profile = await getViewerProfile(adminDb, uid, clientProfileKey);
    const nav = await computeTicketNav(adminDb, uid, profile, request);
    const ms = Date.now() - t0;
    if (ms > 1000) console.log(`[api/tickets/nav] uid=${uid.slice(0, 6)} listOrder=${request.before ? 'yes' : 'no'} ${ms}ms`);
    return Response.json(
      { v: 1, visible: nav.visible, prev: nav.prev, next: nav.next },
      { status: 200, headers: { 'cache-control': 'no-store' } }
    );
  } catch (e) {
    console.error('[api/tickets/nav] failed:', e);
    return Response.json({ error: 'failed' }, { status: 500 });
  }
}

import type { Firestore } from 'firebase-admin/firestore';
import type { ViewerProfile } from '@/lib/tickets-view';

/**
 * users/{uid} for the server-computed list endpoints (/api/tickets/view, /api/tickets/nav),
 * cached per server instance for a short time.
 *
 * Those endpoints are called on every page of the list, on every refresh and on every ticket
 * open; reading the profile each time costs one Firestore document read per call. The
 * viewer's role / category / campuses change rarely, and the browser tells us when they do:
 * it sends the key of the profile it currently sees (from its own live users/{uid} listener).
 * A key that differs from the cached profile's key means the profile changed, and it is read
 * again immediately. Role and category always come from Firestore, never from the request.
 */
const PROFILE_TTL_MS = 60_000;
const PROFILE_CACHE_MAX = 2000;

type CachedProfile = { at: number; profile: ViewerProfile | null; key: string };
const profileCache = new Map<string, CachedProfile>();

/** Same expression as the tickets page's `profileKey` (src/app/tickets/page.tsx). */
export function viewerProfileKey(profile: ViewerProfile | null): string {
  if (!profile) return 'none';
  const campuses = Array.isArray(profile.campusIds) ? profile.campusIds.join(',') : '';
  return `${profile.role}|${profile.departmentId}|${campuses}`;
}

export async function getViewerProfile(
  db: Firestore,
  uid: string,
  clientProfileKey?: string | null
): Promise<ViewerProfile | null> {
  const now = Date.now();
  const cached = profileCache.get(uid);
  if (
    cached && now - cached.at < PROFILE_TTL_MS &&
    (clientProfileKey === undefined || clientProfileKey === null || clientProfileKey === cached.key)
  ) {
    return cached.profile;
  }
  const snap = await db.collection('users').doc(uid).get();
  const profile = snap.exists ? (snap.data() as ViewerProfile) : null;
  if (profileCache.size >= PROFILE_CACHE_MAX && !profileCache.has(uid)) {
    // Oldest first (Map keeps insertion order).
    const oldest = profileCache.keys().next().value;
    if (oldest !== undefined) profileCache.delete(oldest);
  }
  profileCache.delete(uid);
  profileCache.set(uid, { at: now, profile, key: viewerProfileKey(profile) });
  return profile;
}

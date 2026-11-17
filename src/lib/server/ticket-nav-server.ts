import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { viewToDate, type ViewerProfile } from '@/lib/tickets-view';
import { getTicketSummarySnapshot, type CachedDoc } from '@/lib/server/ticket-summary-cache';

/**
 * Previous / Next for the ticket page, computed on the in-memory ticket_summaries snapshot.
 *
 * The page used to load a whole list of tickets into the browser to find the two neighbours
 * of the ticket being viewed. This returns just those two ids, using the same rules:
 *
 *   myAssignedTickets (src/app/tickets/[id]/page.tsx)
 *     Admin    -> every ticket
 *     Manager  -> departmentId === myDept && (no campuses || campusId in my campuses)
 *     Employee -> assignedTo.userId === me
 *     other    -> none
 *
 *   order
 *     - opened from the tickets list: the list's own order (the browser sends the ids just
 *       before and just after the ticket in that order); ids that are no longer visible to the
 *       viewer are skipped, exactly as the page filtered its stored list;
 *     - otherwise: created date, newest first, then id.
 */

export type TicketNavRequest = {
  ticketId: string;
  /** Ids preceding the ticket in the list order the browser captured (in that order), or null. */
  before: string[] | null;
  /** Ids following it (in that order), or null. `before` and `after` are both set or both null. */
  after: string[] | null;
  minReadTime: Timestamp | null;
};

export type TicketNavResponse = {
  /** false: the ticket is not one the viewer can navigate from (the page hides the buttons). */
  visible: boolean;
  prev: string | null;
  next: string | null;
};

/** At most this many ids on each side are accepted (the browser sends 150). */
export const NAV_WINDOW_MAX = 300;

type DocsMap = Map<string, CachedDoc>;
type Visible = (data: Record<string, any>) => boolean;

function visibilityFor(profile: ViewerProfile | null, uid: string): { key: string; visible: Visible } {
  if (!profile) return { key: 'none', visible: () => false };
  if (profile.role === 'Admin') return { key: 'A', visible: () => true };
  if (profile.role === 'Manager') {
    const campusIds: any = profile.campusIds || [];
    const dept = profile.departmentId;
    return {
      key: `M|${String(dept)}|${JSON.stringify(campusIds)}`,
      visible: t => t.departmentId === dept && (campusIds.length === 0 || (t.campusId && campusIds.includes(t.campusId))),
    };
  }
  if (profile.role === 'Employee') {
    return { key: `E|${uid}`, visible: t => t.assignedTo?.userId === uid };
  }
  return { key: 'none', visible: () => false };
}

// Per snapshot (the Map's identity changes whenever a sync applied changes): the viewer's
// tickets in "created date, newest first, then id" order, with each id's position.
type Ordered = { ids: string[]; position: Map<string, number> };
const orderedCache = new WeakMap<DocsMap, Map<string, Ordered>>();

function orderedByCreated(docs: DocsMap, key: string, visible: Visible): Ordered {
  let byKey = orderedCache.get(docs);
  if (!byKey) {
    byKey = new Map();
    orderedCache.set(docs, byKey);
  }
  let ordered = byKey.get(key);
  if (!ordered) {
    const rows: Array<{ id: string; created: number }> = [];
    docs.forEach((entry, id) => {
      if (visible(entry.data)) rows.push({ id, created: viewToDate(entry.data.createdAt)?.getTime() || 0 });
    });
    rows.sort((a, b) => (b.created - a.created) || a.id.localeCompare(b.id));
    const ids = rows.map(r => r.id);
    const position = new Map<string, number>();
    ids.forEach((id, i) => position.set(id, i));
    ordered = { ids, position };
    byKey.set(key, ordered);
  }
  return ordered;
}

export async function computeTicketNav(
  db: Firestore,
  uid: string,
  profile: ViewerProfile | null,
  req: TicketNavRequest
): Promise<TicketNavResponse> {
  const { docs } = await getTicketSummarySnapshot(db, req.minReadTime);
  const { key, visible } = visibilityFor(profile, uid);
  const isVisibleId = (id: string) => {
    const entry = docs.get(id);
    return !!entry && !!visible(entry.data);
  };

  if (!isVisibleId(req.ticketId)) return { visible: false, prev: null, next: null };

  if (req.before && req.after) {
    // List order: nearest still-visible id on each side.
    let prev: string | null = null;
    for (let i = req.before.length - 1; i >= 0; i--) {
      if (req.before[i] !== req.ticketId && isVisibleId(req.before[i])) { prev = req.before[i]; break; }
    }
    let next: string | null = null;
    for (let i = 0; i < req.after.length; i++) {
      if (req.after[i] !== req.ticketId && isVisibleId(req.after[i])) { next = req.after[i]; break; }
    }
    return { visible: true, prev, next };
  }

  const ordered = orderedByCreated(docs, key, visible);
  const pos = ordered.position.get(req.ticketId);
  if (pos === undefined) return { visible: false, prev: null, next: null };
  return {
    visible: true,
    prev: pos > 0 ? ordered.ids[pos - 1] : null,
    next: ordered.ids[pos + 1] || null,
  };
}

/** Validate an untrusted request body. Returns null if malformed. */
export function parseTicketNavRequest(body: unknown): TicketNavRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const isId = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 300;
  if (!isId(b.ticketId)) return null;
  const idList = (x: unknown): string[] | null | undefined => {
    if (x === null || x === undefined) return null;
    if (!Array.isArray(x) || x.length > NAV_WINDOW_MAX || !x.every(isId)) return undefined;
    return x as string[];
  };
  const before = idList(b.before);
  const after = idList(b.after);
  if (before === undefined || after === undefined) return null;
  if ((before === null) !== (after === null)) return null;
  let minReadTime: Timestamp | null = null;
  const mrt = b.minReadTime;
  if (Array.isArray(mrt) && mrt.length === 2 && Number.isInteger(mrt[0]) && Number.isInteger(mrt[1]) && mrt[0] >= 0 && mrt[1] >= 0 && mrt[1] < 1e9) {
    minReadTime = new Timestamp(mrt[0], mrt[1]);
  } else if (mrt !== undefined && mrt !== null) {
    return null;
  }
  return { ticketId: b.ticketId, before, after, minReadTime };
}

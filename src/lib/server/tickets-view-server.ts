import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { compareDocIds, inTicketScope, listScope, scopeKey } from '@/lib/ticket-scope';
import {
  applyTicketsFilters,
  hasDuplicateTicketNumber,
  roleFilterTickets,
  sortTicketsForList,
  ticketsAssigneeOptions,
  ticketsStatusCounts,
  type ScopeCatalogs,
  type ScopeOption,
  type StatusCounts,
  type TicketsViewFilters,
  type ViewerProfile,
} from '@/lib/tickets-view';
import { getTicketSummarySnapshot, UnsupportedValueError, type CachedDoc } from '@/lib/server/ticket-summary-cache';

/**
 * Server-side computation of the tickets page view: the same steps, in the same order,
 * as the page itself (rawTickets -> roleFilteredTickets -> applyFilters -> statusCounts ->
 * status tab + sort -> page slice), run on the in-memory ticket_summaries snapshot.
 */

export type TicketsViewRequest = {
  filters: TicketsViewFilters;
  status: string;
  page: number;
  pageSize: number;
  /** page: one page of rows; all: every filtered row (export); ids: [id, assigneeUserId] of every filtered row (navigation order). */
  mode: 'page' | 'all' | 'ids';
  /** Newest commit time the client has already observed (see getTicketSummarySnapshot). */
  minReadTime: Timestamp | null;
};

export type TicketsViewResponse = {
  readTime: [number, number];
  totalItems: number;
  statusCounts: StatusCounts;
  hasDuplicateTicketNumber: boolean;
  /** Assignees present in the role-filtered set (main's Assigned-To filter options). */
  assigneeOptions: Array<{ id: string; name: string }>;
  /** Pre-serialised rows: each is JSON.stringify([id, encodeValue(data)]). Empty for mode 'ids'. */
  rows: string[];
  /** mode 'ids' only: every filtered+sorted ticket as [id, assigneeUserId | null]. */
  ids: Array<[string, string | null]> | null;
};

// Small reference collections the page also subscribes to (campus/school/division/grade
// names for scope matching; departments only for "loaded" gating). Short TTL; a failed
// refresh serves the previous data rather than failing every waiting request.
const REF_TTL_MS = 15_000;
type RefData = { at: number; catalogs: ScopeCatalogs; departmentsLoaded: boolean };
let refCache: RefData | null = null;
let refInflight: Promise<RefData> | null = null;

async function loadReferenceData(db: Firestore): Promise<RefData> {
  if (refCache && Date.now() - refCache.at < REF_TTL_MS) return refCache;
  if (!refInflight) {
    refInflight = (async () => {
      const opts = async (name: string): Promise<ScopeOption[]> =>
        (await db.collection(name).get()).docs.map(d => ({ ...(d.data() as Record<string, unknown>), id: d.id }) as unknown as ScopeOption);
      const [campuses, schools, divisions, grades] = await Promise.all([
        opts('campuses'), opts('schools'), opts('divisions'), opts('grades'),
        // The page's useCollection yields a (possibly empty) array once the collection has
        // loaded, so "departments loaded" is simply true once we have read it.
        db.collection('departments').select().limit(1).get(),
      ]);
      const next: RefData = { at: Date.now(), catalogs: { campuses, schools, divisions, grades }, departmentsLoaded: true };
      refCache = next;
      return next;
    })()
      .catch(e => {
        if (refCache) {
          console.warn('[tickets-view] reference data refresh failed, serving previous:', e?.message || e);
          return refCache;
        }
        throw e;
      })
      .finally(() => {
        refInflight = null;
      });
  }
  return refInflight;
}

// Per-snapshot caches (keyed by the snapshot's Map identity, which changes on every sync
// that applied changes): the scope-filtered, id-ordered base list, and finished views by
// request key, so concurrent viewers with the same role/filters share one computation.
type DocsMap = Map<string, CachedDoc>;
const baseCache = new WeakMap<DocsMap, Map<string, CachedDoc['item'][]>>();
const viewCache = new WeakMap<DocsMap, Map<string, Promise<TicketsViewResponse>>>();

function scopedBase(docs: DocsMap, scope: ReturnType<typeof listScope>): CachedDoc['item'][] {
  let byScope = baseCache.get(docs);
  if (!byScope) {
    byScope = new Map();
    baseCache.set(docs, byScope);
  }
  const key = scopeKey(scope);
  let base = byScope.get(key);
  if (!base) {
    // rawTickets: the page's listener scope (a superset of the role filter), in Firestore
    // document-id order — the order a listener delivers and the order stable sorts preserve.
    const ids: string[] = [];
    docs.forEach((entry, id) => {
      if (inTicketScope(scope, entry.data)) ids.push(id);
    });
    ids.sort(compareDocIds);
    base = ids.map(id => docs.get(id)!.item);
    byScope.set(key, base);
  }
  return base;
}

export async function computeTicketsView(
  db: Firestore,
  uid: string,
  profile: ViewerProfile | null,
  req: TicketsViewRequest
): Promise<TicketsViewResponse> {
  const [{ docs, readTime }, ref] = await Promise.all([getTicketSummarySnapshot(db, req.minReadTime), loadReferenceData(db)]);

  const scope = listScope(profile?.role, uid, profile?.departmentId);
  // The result depends on the viewer's role/department/campuses (and uid only when the
  // scope itself depends on it), never on the uid otherwise.
  const viewKey = JSON.stringify({
    s: scopeKey(scope), role: profile?.role ?? null, dept: profile?.departmentId ?? null,
    campuses: Array.isArray(profile?.campusIds) ? profile!.campusIds : (profile?.campusIds ?? null),
    f: req.filters, st: req.status, p: req.page, ps: req.pageSize, m: req.mode, ref: ref.at,
  });
  let byKey = viewCache.get(docs);
  if (!byKey) {
    byKey = new Map();
    viewCache.set(docs, byKey);
  }
  const cached = byKey.get(viewKey);
  if (cached) return cached;

  const pending = (async (): Promise<TicketsViewResponse> => {
    const rawTickets = scopedBase(docs, scope);
    const duplicate = hasDuplicateTicketNumber(rawTickets);
    const roleFiltered = roleFilterTickets(rawTickets, profile, uid);
    const filteredBase = applyTicketsFilters(roleFiltered, req.filters, ref.catalogs, ref.departmentsLoaded);
    const statusCounts = ticketsStatusCounts(filteredBase);
    const assigneeOptions = ticketsAssigneeOptions(roleFiltered);
    const sorted = sortTicketsForList(filteredBase, req.status);

    if (req.mode === 'ids') {
      return {
        readTime: [readTime.seconds, readTime.nanoseconds],
        totalItems: sorted.length,
        statusCounts,
        hasDuplicateTicketNumber: duplicate,
        assigneeOptions,
        rows: [],
        ids: sorted.map(t => [t.id, (t.assignedTo && typeof t.assignedTo === 'object' && typeof t.assignedTo.userId === 'string') ? t.assignedTo.userId : null] as [string, string | null]),
      };
    }

    const slice = req.mode === 'all'
      ? sorted
      : sorted.slice((req.page - 1) * req.pageSize, (req.page - 1) * req.pageSize + req.pageSize);

    const rows: string[] = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      const row = docs.get(slice[i].id)!.row;
      if (row === null) throw new UnsupportedValueError(`document ${slice[i].id} cannot be encoded exactly`);
      rows[i] = row;
    }

    return {
      readTime: [readTime.seconds, readTime.nanoseconds],
      totalItems: sorted.length,
      statusCounts,
      hasDuplicateTicketNumber: duplicate,
      assigneeOptions,
      rows,
      ids: null,
    };
  })();
  byKey.set(viewKey, pending);
  pending.catch(() => byKey!.delete(viewKey)); // don't cache failures
  return pending;
}

/** Validate an untrusted request body. Returns null if malformed. */
export function parseTicketsViewRequest(body: unknown): TicketsViewRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const f = b.filters;
  if (!f || typeof f !== 'object') return null;
  const fv = f as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === 'string' && x.length <= 500 ? x : null);
  const numOrNull = (x: unknown) => (x === null || x === undefined ? null : typeof x === 'number' && Number.isFinite(x) ? x : undefined);
  const fields = ['search', 'departmentId', 'campusId', 'schoolId', 'divisionId', 'gradeId', 'channel'] as const;
  const filters: Partial<TicketsViewFilters> = {};
  for (const k of fields) {
    const v = str(fv[k] ?? '');
    if (v === null) return null;
    filters[k] = v;
  }
  const dateStartMs = numOrNull(fv.dateStartMs);
  const dateEndMs = numOrNull(fv.dateEndMs);
  if (dateStartMs === undefined || dateEndMs === undefined) return null;
  if ((dateStartMs === null) !== (dateEndMs === null)) return null;
  const status = str(b.status ?? '');
  if (status === null) return null;
  const mode = b.mode === 'all' ? 'all' : b.mode === 'ids' ? 'ids' : b.mode === 'page' || b.mode === undefined ? 'page' : null;
  if (mode === null) return null;
  const page = typeof b.page === 'number' && Number.isInteger(b.page) && b.page >= 1 ? b.page : 1;
  const pageSize = typeof b.pageSize === 'number' && Number.isInteger(b.pageSize) && b.pageSize >= 1 && b.pageSize <= 200 ? b.pageSize : 50;
  let minReadTime: Timestamp | null = null;
  const mrt = b.minReadTime;
  if (Array.isArray(mrt) && mrt.length === 2 && Number.isInteger(mrt[0]) && Number.isInteger(mrt[1]) && mrt[0] >= 0 && mrt[1] >= 0 && mrt[1] < 1e9) {
    minReadTime = new Timestamp(mrt[0], mrt[1]);
  } else if (mrt !== undefined && mrt !== null) {
    return null;
  }
  return {
    filters: { ...(filters as TicketsViewFilters), dateStartMs, dateEndMs },
    status,
    page,
    pageSize,
    mode,
    minReadTime,
  };
}

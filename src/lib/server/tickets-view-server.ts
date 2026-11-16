import { createHash } from 'crypto';
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
  viewToDate,
} from '@/lib/tickets-view';
import { getTicketSummarySnapshot, UnsupportedValueError, type CachedDoc } from '@/lib/server/ticket-summary-cache';
import { calculateWorkingHoursElapsedInZone, isSupportedTimeZone } from '@/lib/working-hours-zoned';
import { DEFAULT_SLA_SETTINGS, type SLASettings, type WorkingHours } from '@/lib/types';

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
  /** The page's SLA filter. 'all' = no SLA filter. */
  sla: TicketsViewSla;
  /** The browser's IANA time zone; required (and validated) when `sla` is not 'all'. */
  timeZone: string | null;
};

export type TicketsViewSla = 'all' | 'breached' | 'at-risk';

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
  /**
   * Fingerprint of the full filtered+sorted [id, assigneeUserId] list (what mode 'ids' returns).
   * The page keeps that list for Previous / Next on the ticket page; with this it re-downloads
   * the list only when it actually changed, instead of after every refresh of the page.
   */
  idsVersion: string;
  /** The SLA filter this response was computed with (the browser checks it got what it asked for). */
  sla: TicketsViewSla;
};

const assigneeUserId = (t: Record<string, any>): string | null =>
  (t.assignedTo && typeof t.assignedTo === 'object' && typeof t.assignedTo.userId === 'string') ? t.assignedTo.userId : null;

function listFingerprint(sorted: Array<Record<string, any>>): string {
  const parts: string[] = new Array(sorted.length);
  for (let i = 0; i < sorted.length; i++) parts[i] = `${sorted[i].id}\u0001${assigneeUserId(sorted[i]) ?? ''}`;
  return createHash('sha1').update(parts.join('\u0002')).digest('base64').slice(0, 20);
}

// Small reference collections the page also subscribes to (campus/school/division/grade
// names for scope matching; departments for "loaded" gating and their working hours; the SLA
// settings and the active official holidays for the SLA filter). A failed refresh serves the
// previous data rather than failing every waiting request. The list is asked for again by
// every open tickets page every 20 s, so this is re-read once a minute, not on each of those.
const REF_TTL_MS = 60_000;
type RefData = {
  at: number;
  catalogs: ScopeCatalogs;
  departmentsLoaded: boolean;
  /** departments as the page holds them: { ...data, id } (document id wins). */
  departments: Array<{ id: string; workingHours?: WorkingHours }>;
  /** settings/sla, or the defaults when that document does not exist (as the page does). */
  slaSettings: SLASettings;
  /** Dates ("YYYY-MM-DD") of official holidays that are not switched off. */
  holidays: Set<string>;
};
let refCache: RefData | null = null;
let refInflight: Promise<RefData> | null = null;

async function loadReferenceData(db: Firestore): Promise<RefData> {
  if (refCache && Date.now() - refCache.at < REF_TTL_MS) return refCache;
  if (!refInflight) {
    refInflight = (async () => {
      const opts = async (name: string): Promise<ScopeOption[]> =>
        (await db.collection(name).get()).docs.map(d => ({ ...(d.data() as Record<string, unknown>), id: d.id }) as unknown as ScopeOption);
      const [campuses, schools, divisions, grades, departmentsSnap, slaSnap, holidaysSnap] = await Promise.all([
        opts('campuses'), opts('schools'), opts('divisions'), opts('grades'),
        // The page's useCollection yields a (possibly empty) array once the collection has
        // loaded, so "departments loaded" is simply true once we have read it.
        db.collection('departments').get(),
        db.collection('settings').doc('sla').get(),
        db.collection('official_holidays').get(),
      ]);
      const departments = departmentsSnap.docs.map(d => ({ ...(d.data() as Record<string, unknown>), id: d.id }) as { id: string; workingHours?: WorkingHours });
      const slaData = slaSnap.exists ? (slaSnap.data() as SLASettings) : null;
      const holidays = new Set<string>();
      holidaysSnap.docs.forEach(d => {
        const h = d.data() as { date?: unknown; isActive?: unknown };
        if (typeof h.date === 'string' && (h.isActive === undefined || h.isActive === true)) holidays.add(h.date);
      });
      const next: RefData = {
        at: Date.now(), catalogs: { campuses, schools, divisions, grades }, departmentsLoaded: true,
        departments, slaSettings: slaData || DEFAULT_SLA_SETTINGS, holidays,
      };
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

// ---- SLA filter ------------------------------------------------------------------------------
/**
 * The page's SLA filter (src/app/tickets/page.tsx, applyFilters), for one ticket: does it pass
 * the 'breached' filter, and does it pass the 'at-risk' filter. Same statements in the same
 * order; the only difference is that the working hours are computed for the browser's time
 * zone explicitly (src/lib/working-hours-zoned.ts) instead of in the machine's local time.
 *
 * The answer for a ticket depends on the minute it is asked in (an unanswered ticket is
 * measured up to "now"), so it is remembered per ticket object for one minute + zone +
 * reference data version, and shared by every viewer who asks within that minute.
 */
type SlaFlags = { bucket: string; breached: boolean; atRisk: boolean };
const slaFlagsCache = new WeakMap<object, SlaFlags>();
const NO_SLA: Pick<SlaFlags, 'breached' | 'atRisk'> = { breached: false, atRisk: false };

function slaFlags(
  t: Record<string, any>,
  bucket: string,
  nowMs: number,
  timeZone: string,
  ref: RefData
): Pick<SlaFlags, 'breached' | 'atRisk'> {
  const cached = slaFlagsCache.get(t);
  if (cached && cached.bucket === bucket) return cached;

  let flags = NO_SLA;
  // Excluded statuses must never appear in breached or at-risk SLA filters.
  if (!(t.status === 'Duplicate' || String(t.status) === 'Ignored')) {
    // MATCH BADGE LOGIC: Start from assignedAt
    const start = viewToDate(t.assignedAt || t.createdAt);
    // Only assigned tickets contribute to SLA stats in the list
    if (start && t.assignedTo) {
      const responded = viewToDate(t.firstRespondedAt);
      const isFinished = ['Resolved', 'Closed'].includes(t.status);
      const finishedAt = isFinished ? viewToDate(t.resolvedAt || t.closedAt) : null;

      const dept = ref.departments.find(d => d.id === t.departmentId);

      // Correct channel normalization for SLA key lookup
      const rawChan = t.channel || 'Email';
      let channelKey = 'Email';
      const lower = rawChan.toLowerCase();
      if (lower.includes('social')) channelKey = 'Social Media';
      else if (lower.includes('walk')) channelKey = 'Walk-in';
      else if (lower === 'website' || lower === 'api') channelKey = 'Web';
      else if (lower === 'whatsapp') channelKey = 'WhatsApp';
      else if (lower === 'form') channelKey = 'Form';
      else if (lower === 'phone') channelKey = 'Phone';
      else channelKey = rawChan.charAt(0).toUpperCase() + rawChan.slice(1).toLowerCase();

      const priority = t.priority || 'Normal';
      const settings = ref.slaSettings as Record<string, Record<string, number> | undefined>;
      const policy = settings[channelKey] || settings['Email'];
      const limitHours = policy?.[priority] || 24;

      const compareTime = finishedAt || responded || new Date(nowMs);
      const workingHoursElapsed = calculateWorkingHoursElapsedInZone(start, compareTime, dept?.workingHours, ref.holidays, timeZone);

      const hoursRemaining = limitHours - workingHoursElapsed;
      flags = {
        breached: workingHoursElapsed >= limitHours,
        atRisk: finishedAt || responded ? false : hoursRemaining > 0 && hoursRemaining <= 2,
      };
    }
  }
  slaFlagsCache.set(t, { bucket, breached: flags.breached, atRisk: flags.atRisk });
  return flags;
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
  req: TicketsViewRequest,
  /** "now" for the SLA filter (tests pass a fixed instant). */
  nowMs: number = Date.now()
): Promise<TicketsViewResponse> {
  const [{ docs, readTime }, ref] = await Promise.all([getTicketSummarySnapshot(db, req.minReadTime), loadReferenceData(db)]);
  // With an SLA filter the answer changes as time passes: one result per minute.
  const slaActive = (req.sla === 'breached' || req.sla === 'at-risk') && typeof req.timeZone === 'string';
  const slaMinute = slaActive ? Math.floor(nowMs / 60_000) : null;

  const scope = listScope(profile?.role, uid, profile?.departmentId, profile?.campusIds);
  // The result depends on the viewer's role/department/campuses (and uid only when the
  // scope itself depends on it), never on the uid otherwise.
  const viewKey = JSON.stringify({
    s: scopeKey(scope), role: profile?.role ?? null, dept: profile?.departmentId ?? null,
    campuses: Array.isArray(profile?.campusIds) ? profile!.campusIds : (profile?.campusIds ?? null),
    f: req.filters, st: req.status, p: req.page, ps: req.pageSize, m: req.mode, ref: ref.at,
    sla: req.sla, tz: slaActive ? req.timeZone : null, minute: slaMinute,
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
    let filteredBase = applyTicketsFilters(roleFiltered, req.filters, ref.catalogs, ref.departmentsLoaded);
    if (slaActive) {
      // The page applies the SLA filter last, on the result of the other filters.
      const bucket = `${req.timeZone}|${slaMinute}|${ref.at}`;
      const wanted = req.sla === 'breached' ? 'breached' : 'atRisk';
      filteredBase = filteredBase.filter(t => slaFlags(t, bucket, nowMs, req.timeZone as string, ref)[wanted]);
    }
    const statusCounts = ticketsStatusCounts(filteredBase);
    const assigneeOptions = ticketsAssigneeOptions(roleFiltered);
    const sorted = sortTicketsForList(filteredBase, req.status);
    const idsVersion = listFingerprint(sorted);

    if (req.mode === 'ids') {
      return {
        readTime: [readTime.seconds, readTime.nanoseconds],
        totalItems: sorted.length,
        statusCounts,
        hasDuplicateTicketNumber: duplicate,
        assigneeOptions,
        rows: [],
        ids: sorted.map(t => [t.id, assigneeUserId(t)] as [string, string | null]),
        idsVersion,
        sla: req.sla,
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
      idsVersion,
      sla: req.sla,
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
  // SLA filter: absent = none. Any other value than the two the page knows, or an SLA filter
  // without a usable time zone, is refused — the browser then computes the list itself.
  let sla: TicketsViewSla = 'all';
  if (b.sla !== undefined && b.sla !== null && b.sla !== 'all') {
    if (b.sla !== 'breached' && b.sla !== 'at-risk') return null;
    sla = b.sla;
  }
  let timeZone: string | null = null;
  if (sla !== 'all') {
    if (!isSupportedTimeZone(b.timeZone)) return null;
    timeZone = b.timeZone;
  }
  return {
    filters: { ...(filters as TicketsViewFilters), dateStartMs, dateEndMs },
    status,
    page,
    pageSize,
    mode,
    minReadTime,
    sla,
    timeZone,
  };
}

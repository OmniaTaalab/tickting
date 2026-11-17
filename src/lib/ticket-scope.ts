/**
 * Which ticket_summaries query each list page subscribes to.
 *
 * RULE: every scope returned here is a SUPERSET of what the page's existing
 * client-side role filter keeps. The page then runs its unchanged filter on it,
 * so the visible result is identical to filtering the full collection.
 * When a superset cannot be expressed exactly (e.g. a profile with no usable
 * departmentId, where the page filter matches tickets *missing* departmentId),
 * we fall back to 'all'.
 */
export const ACTIVE_STATUSES = ['Open', 'In Progress', 'Waiting'] as const;

export type TicketScope =
  | { kind: 'all' }
  | { kind: 'statusIn' }
  | { kind: 'deptStatusIn'; dept: string; campuses?: string[] }
  | { kind: 'assignedStatusIn'; uid: string }
  | { kind: 'assigned'; uid: string }
  | { kind: 'dept'; dept: string; campuses?: string[] }
  | { kind: 'assignedOrDept'; uid: string; dept: string; campuses?: string[] };

/**
 * `campuses` (optional, on the two category scopes): only the category's tickets on these
 * campuses or with no campus (campusId null / ''), instead of the whole category.
 *
 * Every page's role filter drops the category's tickets on other campuses anyway (Academic
 * staff loaded ~26,000 tickets to keep the ~3,600 of their own campus), so this is still a
 * superset of what each page keeps:
 *  - tickets / ticket navigation / analytics keep `campusId in myCampuses`;
 *  - the dashboard additionally keeps tickets with no campus, hence null / '' are included.
 * A ticket always has the campusId field (every creator writes a string or null), so
 * "no campus" is exactly null or ''.
 */
const MAX_SCOPE_CAMPUSES = 25; // keeps the Firestore query within its 30-disjunction limit
// The sidebar query also has `status in [3 active statuses]`: 3 x (campuses + 2) disjunctions.
const MAX_SIDEBAR_CAMPUSES = 6;

/**
 * The viewer's campus list in canonical form, or undefined when the list cannot narrow the
 * query safely (empty = the page shows all campuses; anything that is not a short list of
 * non-empty strings = keep today's whole-category query).
 */
export function scopeCampuses(campusIds: unknown): string[] | undefined {
  if (!Array.isArray(campusIds) || campusIds.length === 0) return undefined;
  if (!campusIds.every(c => typeof c === 'string' && c.length > 0 && c.length < 300)) return undefined;
  const unique = Array.from(new Set(campusIds as string[])).sort();
  return unique.length <= MAX_SCOPE_CAMPUSES ? unique : undefined;
}

const campusKey = (campuses: string[] | undefined) => (campuses ? `:c[${campuses.join(',')}]` : '');

export function scopeKey(scope: TicketScope): string {
  switch (scope.kind) {
    case 'all':
    case 'statusIn':
      return scope.kind;
    case 'deptStatusIn':
      return `${scope.kind}:${scope.dept}${campusKey(scope.campuses)}`;
    case 'dept':
      return `${scope.kind}:${scope.dept}${campusKey(scope.campuses)}`;
    case 'assignedStatusIn':
    case 'assigned':
      return `${scope.kind}:${scope.uid}`;
    case 'assignedOrDept':
      return `${scope.kind}:${scope.uid}:${scope.dept}${campusKey(scope.campuses)}`;
  }
}

function usableDept(dept: unknown): dept is string {
  return typeof dept === 'string' && dept.length > 0;
}

/**
 * sidebar-nav.tsx relevantActiveTickets:
 *  Admin   -> all active
 *  Manager -> active && departmentId === myDept && campus check
 *  other   -> active && assignedTo.userId === uid
 */
export function sidebarScope(role: unknown, uid: string, dept: unknown, campusIds?: unknown): TicketScope {
  if (role === 'Admin') return { kind: 'statusIn' };
  if (role === 'Manager') {
    if (!usableDept(dept)) return { kind: 'statusIn' };
    const campuses = scopeCampuses(campusIds);
    return campuses && campuses.length <= MAX_SIDEBAR_CAMPUSES
      ? { kind: 'deptStatusIn', dept, campuses }
      : { kind: 'deptStatusIn', dept };
  }
  return { kind: 'assignedStatusIn', uid };
}

/** tasks/page.tsx personalTickets: assignedTo.userId === uid && active. */
export function tasksScope(uid: string): TicketScope {
  return { kind: 'assignedStatusIn', uid };
}

/**
 * tickets/page.tsx and dashboard/page.tsx roleFilteredTickets:
 *  Admin    -> all
 *  Manager  -> isSameDept && campus
 *  Employee -> isAssignedToMe || (isSameDept && campus)
 *  other    -> isSameDept && campus
 */
export function listScope(role: unknown, uid: string, dept: unknown, campusIds?: unknown): TicketScope {
  if (role === 'Admin') return { kind: 'all' };
  if (!usableDept(dept)) return { kind: 'all' };
  const campuses = scopeCampuses(campusIds);
  if (role === 'Employee') return campuses ? { kind: 'assignedOrDept', uid, dept, campuses } : { kind: 'assignedOrDept', uid, dept };
  return campuses ? { kind: 'dept', dept, campuses } : { kind: 'dept', dept };
}

/**
 * tickets/[id]/page.tsx myAssignedTickets (Previous / Next navigation):
 *  Admin    -> all
 *  Manager  -> departmentId === myDept && campus
 *  Employee -> assignedTo.userId === uid
 *  other    -> [] (nothing to load)
 * A Manager without a usable departmentId falls back to 'all' (the page filter then matches
 * tickets that are *missing* departmentId, which no narrower query can express).
 */
export function ticketNavScope(role: unknown, uid: string, dept: unknown, campusIds?: unknown): TicketScope | null {
  if (role === 'Admin') return { kind: 'all' };
  if (role === 'Manager') {
    if (!usableDept(dept)) return { kind: 'all' };
    const campuses = scopeCampuses(campusIds);
    return campuses ? { kind: 'dept', dept, campuses } : { kind: 'dept', dept };
  }
  if (role === 'Employee') return { kind: 'assigned', uid };
  return null;
}

/**
 * analytics/page.tsx roleFilteredTickets:
 *  Admin             -> all
 *  Manager/Employee  -> departmentId === myDept && campus
 *  other             -> [] (any superset works; keep 'all' = today's query)
 */
export function analyticsScope(role: unknown, dept: unknown, campusIds?: unknown): TicketScope {
  if ((role === 'Manager' || role === 'Employee') && usableDept(dept)) {
    const campuses = scopeCampuses(campusIds);
    return campuses ? { kind: 'dept', dept, campuses } : { kind: 'dept', dept };
  }
  return { kind: 'all' };
}

/**
 * In-memory equivalent of the Firestore query each scope stands for
 * (see buildSummaryQuery in src/hooks/use-tickets-list.ts). Used by the fast-load
 * route (server) and by the client store when applying live changes.
 * Firestore `==` / `in` are type-strict, like `===` / Array.includes on strings.
 */
function assignedUserId(data: Record<string, unknown>): unknown {
  const a = data.assignedTo;
  if (a === null || typeof a !== 'object' || Array.isArray(a)) return undefined;
  return (a as Record<string, unknown>).userId;
}

/** `campuses` unset: any campus. Otherwise one of them, or no campus (null / ''). */
function onScopeCampus(campuses: string[] | undefined, data: Record<string, unknown>): boolean {
  if (!campuses) return true;
  const campusId = data.campusId;
  return campusId === null || campusId === '' || (typeof campusId === 'string' && campuses.includes(campusId));
}

export function inTicketScope(scope: TicketScope, data: Record<string, unknown>): boolean {
  const status = data.status;
  const isActive = typeof status === 'string' && (ACTIVE_STATUSES as readonly string[]).includes(status);
  switch (scope.kind) {
    case 'all':
      return true;
    case 'statusIn':
      return isActive;
    case 'deptStatusIn':
      return data.departmentId === scope.dept && isActive && onScopeCampus(scope.campuses, data);
    case 'assignedStatusIn':
      return assignedUserId(data) === scope.uid && isActive;
    case 'assigned':
      return assignedUserId(data) === scope.uid;
    case 'dept':
      return data.departmentId === scope.dept && onScopeCampus(scope.campuses, data);
    case 'assignedOrDept':
      return assignedUserId(data) === scope.uid ||
        (data.departmentId === scope.dept && onScopeCampus(scope.campuses, data));
  }
}

/** Validate an untrusted scope object (e.g. from a request body). */
export function parseTicketScope(value: unknown): TicketScope | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const str = (x: unknown) => typeof x === 'string' && x.length > 0 && x.length < 300;
  // Optional campus list: absent is fine; present must already be canonical (what
  // scopeCampuses produces), otherwise the whole scope is rejected.
  let campuses: string[] | undefined;
  if (v.campuses !== undefined) {
    const canonical = scopeCampuses(v.campuses);
    if (!canonical || !Array.isArray(v.campuses) || canonical.length !== v.campuses.length ||
        !canonical.every((c, i) => c === (v.campuses as unknown[])[i])) return null;
    campuses = canonical;
  }
  switch (v.kind) {
    case 'all':
    case 'statusIn':
      return { kind: v.kind };
    case 'deptStatusIn':
      if (!str(v.dept)) return null;
      if (campuses && campuses.length > MAX_SIDEBAR_CAMPUSES) return null;
      return campuses ? { kind: 'deptStatusIn', dept: v.dept as string, campuses } : { kind: 'deptStatusIn', dept: v.dept as string };
    case 'dept':
      if (!str(v.dept)) return null;
      return campuses ? { kind: 'dept', dept: v.dept as string, campuses } : { kind: 'dept', dept: v.dept as string };
    case 'assignedStatusIn':
      return str(v.uid) ? { kind: 'assignedStatusIn', uid: v.uid as string } : null;
    case 'assigned':
      return str(v.uid) ? { kind: 'assigned', uid: v.uid as string } : null;
    case 'assignedOrDept':
      if (!str(v.uid) || !str(v.dept)) return null;
      return campuses
        ? { kind: 'assignedOrDept', uid: v.uid as string, dept: v.dept as string, campuses }
        : { kind: 'assignedOrDept', uid: v.uid as string, dept: v.dept as string };
    default:
      return null;
  }
}

/**
 * Document-id order used by the Firestore JS SDK (BasePath.compareSegments):
 * numeric ids "__id<n>__" first (numerically), then UTF-8 byte order
 * (equivalent to Unicode code point order).
 */
const isNumericId = (id: string) => id.startsWith('__id') && id.endsWith('__');
const numericIdValue = (id: string): bigint => {
  try {
    return BigInt(id.slice(4, -2));
  } catch {
    return BigInt(0);
  }
};
export function compareDocIds(a: string, b: string): number {
  if (a === b) return 0;
  const na = isNumericId(a);
  const nb = isNumericId(b);
  if (na && !nb) return -1;
  if (!na && nb) return 1;
  if (na && nb) {
    const x = numericIdValue(a);
    const y = numericIdValue(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i)!;
    const cb = b.codePointAt(j)!;
    if (ca !== cb) return ca < cb ? -1 : 1;
    i += ca > 0xffff ? 2 : 1;
    j += cb > 0xffff ? 2 : 1;
  }
  const restA = a.length - i;
  const restB = b.length - j;
  return restA === restB ? 0 : restA < restB ? -1 : 1;
}

/** Marker used to carry Firestore Timestamps through JSON (server encode / client decode). */
export const TIMESTAMP_MARKER = '\u0000ts';

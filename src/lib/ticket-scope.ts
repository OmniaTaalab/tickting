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
  | { kind: 'deptStatusIn'; dept: string }
  | { kind: 'assignedStatusIn'; uid: string }
  | { kind: 'dept'; dept: string }
  | { kind: 'assignedOrDept'; uid: string; dept: string };

export function scopeKey(scope: TicketScope): string {
  switch (scope.kind) {
    case 'all':
    case 'statusIn':
      return scope.kind;
    case 'deptStatusIn':
    case 'dept':
      return `${scope.kind}:${scope.dept}`;
    case 'assignedStatusIn':
      return `${scope.kind}:${scope.uid}`;
    case 'assignedOrDept':
      return `${scope.kind}:${scope.uid}:${scope.dept}`;
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
export function sidebarScope(role: unknown, uid: string, dept: unknown): TicketScope {
  if (role === 'Admin') return { kind: 'statusIn' };
  if (role === 'Manager') return usableDept(dept) ? { kind: 'deptStatusIn', dept } : { kind: 'statusIn' };
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
export function listScope(role: unknown, uid: string, dept: unknown): TicketScope {
  if (role === 'Admin') return { kind: 'all' };
  if (!usableDept(dept)) return { kind: 'all' };
  if (role === 'Employee') return { kind: 'assignedOrDept', uid, dept };
  return { kind: 'dept', dept };
}

/**
 * analytics/page.tsx roleFilteredTickets:
 *  Admin             -> all
 *  Manager/Employee  -> departmentId === myDept && campus
 *  other             -> [] (any superset works; keep 'all' = today's query)
 */
export function analyticsScope(role: unknown, dept: unknown): TicketScope {
  if ((role === 'Manager' || role === 'Employee') && usableDept(dept)) return { kind: 'dept', dept };
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

export function inTicketScope(scope: TicketScope, data: Record<string, unknown>): boolean {
  const status = data.status;
  const isActive = typeof status === 'string' && (ACTIVE_STATUSES as readonly string[]).includes(status);
  switch (scope.kind) {
    case 'all':
      return true;
    case 'statusIn':
      return isActive;
    case 'deptStatusIn':
      return data.departmentId === scope.dept && isActive;
    case 'assignedStatusIn':
      return assignedUserId(data) === scope.uid && isActive;
    case 'dept':
      return data.departmentId === scope.dept;
    case 'assignedOrDept':
      return assignedUserId(data) === scope.uid || data.departmentId === scope.dept;
  }
}

/** Validate an untrusted scope object (e.g. from a request body). */
export function parseTicketScope(value: unknown): TicketScope | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const str = (x: unknown) => typeof x === 'string' && x.length > 0 && x.length < 300;
  switch (v.kind) {
    case 'all':
    case 'statusIn':
      return { kind: v.kind };
    case 'deptStatusIn':
    case 'dept':
      return str(v.dept) ? { kind: v.kind, dept: v.dept as string } : null;
    case 'assignedStatusIn':
      return str(v.uid) ? { kind: 'assignedStatusIn', uid: v.uid as string } : null;
    case 'assignedOrDept':
      return str(v.uid) && str(v.dept) ? { kind: 'assignedOrDept', uid: v.uid as string, dept: v.dept as string } : null;
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

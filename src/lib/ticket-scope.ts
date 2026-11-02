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

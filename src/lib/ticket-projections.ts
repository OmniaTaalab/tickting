/**
 * Field projections for list pages that read only part of each ticket summary.
 * A projection copies the listed top-level fields verbatim (present keys only, so
 * missing-vs-null-vs-empty semantics are preserved) and drops everything else.
 *
 * Every field a page or any component it renders reads from a ticket MUST be listed,
 * otherwise that page would silently compute with undefined values. Keep in sync with
 * the golden test (dashboard page + components on full vs projected data).
 */
export const TICKET_PROJECTIONS = {
  /**
   * src/app/dashboard/page.tsx + components/dashboard/{division-health-cards,
   * sla-compliance-trend-chart, tickets-by-campus-chart, tickets-by-status-department-chart,
   * tickets-by-division-chart, channel-mix-chart, tickets-by-assignee-chart}.
   */
  dashboard: [
    'status', 'priority', 'channel', 'source',
    'createdAt', 'assignedAt', 'firstRespondedAt', 'resolvedAt', 'closedAt', 'updatedAt',
    'departmentId', 'departmentName', 'divisionId', 'divisionName', 'campusId', 'campusName',
    'assignedTo', 'reopenedCount',
    // bookkeeping used by the fast store to order live changes
    '_summarySyncedAt',
  ],
} as const;

export type TicketProjection = keyof typeof TICKET_PROJECTIONS;

export function isTicketProjection(v: unknown): v is TicketProjection {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(TICKET_PROJECTIONS, v);
}

/** Pure: pick the projection's fields that are present on `data`. */
export function projectTicket<T extends Record<string, unknown>>(data: T, projection: TicketProjection): Partial<T> {
  const out: Partial<T> = {};
  for (const key of TICKET_PROJECTIONS[projection]) {
    if (Object.prototype.hasOwnProperty.call(data, key)) (out as Record<string, unknown>)[key] = data[key];
  }
  return out;
}

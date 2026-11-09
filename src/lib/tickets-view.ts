/**
 * Tickets list view logic (role filter, filters, status counts, sort, duplicate scan),
 * extracted VERBATIM from src/app/tickets/page.tsx so that the browser (legacy path) and
 * the server (/api/tickets/view, paged path) run exactly the same code.
 *
 * Deliberately excluded: the SLA 'breached' / 'at-risk' filter. It depends on the
 * browser's local time zone (date-fns local-day arithmetic), so when it is active the
 * page keeps computing everything locally.
 *
 * Pure: no React, no Firebase imports. Works on both client-SDK and Admin-SDK ticket
 * objects (both expose Timestamp.toDate()).
 */

export type ScopeOption = { id: string; name: string };

export type ScopeCatalogs = {
  campuses?: ScopeOption[] | null;
  schools?: ScopeOption[] | null;
  divisions?: ScopeOption[] | null;
  grades?: ScopeOption[] | null;
};

export type ViewerProfile = {
  role?: unknown;
  departmentId?: unknown;
  campusIds?: unknown;
};

/**
 * Filters as the page applies them. Date bounds are the exact instants the page computes
 * with startOfDay(from) / endOfDay(to) in the BROWSER's time zone, passed as epoch ms, so
 * the comparison itself is time-zone free.
 */
export type TicketsViewFilters = {
  search: string;
  departmentId: string;
  campusId: string;
  schoolId: string;
  divisionId: string;
  gradeId: string;
  channel: string;
  dateStartMs: number | null;
  dateEndMs: number | null;
};

export type StatusCounts = {
  all: number;
  Open: number;
  'In Progress': number;
  Resolved: number;
  Closed: number;
  Queue: number;
  Duplicate: number;
  Ignored: number;
  Waiting: number;
};

export const EMPTY_STATUS_COUNTS: StatusCounts = {
  all: 0, Open: 0, 'In Progress': 0, Resolved: 0, Closed: 0, Queue: 0, Duplicate: 0, Ignored: 0, Waiting: 0,
};

// --- page.tsx: toDate (module-level) ---
export const viewToDate = (ts: any): Date | null => {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
  if (ts instanceof Date) return isNaN(ts.getTime()) ? null : ts;
  try {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
};

// --- page.tsx: normalizeScope / matchesScope ---
const normalizeScope = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const matchesScope = (ticketValues: unknown[], selectedId: string, options: ScopeOption[] | null | undefined) => {
  if (!selectedId) return true;
  const selected = options?.find(option => option.id === selectedId);
  const accepted = [selectedId, selected?.name].filter(Boolean).map(normalizeScope);
  return ticketValues.some(value => {
    if (Array.isArray(value)) return value.some(item => accepted.includes(normalizeScope(item)));
    return accepted.includes(normalizeScope(value));
  });
};

// --- page.tsx: roleFilteredTickets ---
export function roleFilterTickets<T extends Record<string, any>>(
  tickets: T[] | null | undefined,
  profile: ViewerProfile | null | undefined,
  uid: string | null | undefined
): T[] {
  if (!tickets || !profile || !uid) return [];

  if (profile.role === 'Admin') return tickets;

  const myUserId = uid;
  const myDeptId = profile.departmentId;
  const myCampuses: any = profile.campusIds || [];

  return tickets.filter(t => {
    const isAssignedToMe = t.assignedTo?.userId === myUserId;
    const isSameDept = t.departmentId === myDeptId;
    const isAllowedCampus = myCampuses.length === 0 || (t.campusId && myCampuses.includes(t.campusId));

    if (profile.role === 'Manager') {
      // STRICT: Must be department AND within assigned campuses
      return isSameDept && isAllowedCampus;
    }

    if (profile.role === 'Employee') {
      // Own tasks OR (Dept match if viewing department pool)
      return isAssignedToMe || (isSameDept && isAllowedCampus);
    }

    return isSameDept && isAllowedCampus;
  });
}

// --- page.tsx: applyFilters (without the SLA branch) ---
export function applyTicketsFilters<T extends Record<string, any>>(
  tickets: T[],
  filters: TicketsViewFilters,
  catalogs: ScopeCatalogs,
  departmentsLoaded: boolean
): T[] {
  if (!departmentsLoaded) return tickets;
  let result = [...tickets];

  if (filters.search) {
    const term = filters.search.toLowerCase().trim();
    result = result.filter(t => {
      const idStr = (t.ticketNumber || t.id.substring(0, 4)).toString();
      const combined = `${idStr} ${t.subject} ${t.createdBy?.name || ''} ${t.assignedTo?.name || ''} ${t.departmentName || ''} ${t.parentName || ''} ${(t.tags || []).join(' ')}`.toLowerCase();
      return combined.includes(term);
    });
  }
  if (filters.departmentId) {
    result = result.filter(t => t.departmentId === filters.departmentId);
  }
  if (filters.campusId || filters.schoolId || filters.divisionId || filters.gradeId) {
    result = result.filter(t => {
      // Email tickets may store names / mailbox routing options, instead of IDs.
      const record = t as T & {
        campusName?: string; school?: string; schoolName?: string; schoolNames?: string[];
        division?: string; divisionName?: string; divisionNames?: string[];
        grade?: string; gradeName?: string; grades?: string[]; allowedGrades?: string[];
        routingOptions?: Array<{ school?: string; division?: string; grades?: string[] }>;
        // ticket_summaries carry a de-duplicated copy of the three routingOptions value
        // lists instead of the (large) routingOptions array. matchesScope only checks
        // whether ANY value matches, so the de-duplicated lists give the same result.
        routingScope?: { schools: unknown[]; divisions: unknown[]; grades: unknown[] };
      };
      const routes = record.routingOptions || [];
      const scope = record.routingScope;
      return matchesScope([record.campusId, record.campusName], filters.campusId, catalogs.campuses)
        && matchesScope([record.schoolId, record.school, record.schoolName, record.schoolNames, scope ? scope.schools : routes.map(r => r.school)], filters.schoolId, catalogs.schools)
        && matchesScope([record.divisionId, record.division, record.divisionName, record.divisionNames, scope ? scope.divisions : routes.map(r => r.division)], filters.divisionId, catalogs.divisions)
        && matchesScope([record.gradeId, record.grade, record.gradeName, record.grades, record.allowedGrades, scope ? scope.grades : routes.flatMap(r => r.grades || [])], filters.gradeId, catalogs.grades);
    });
  }
  if (filters.channel) {
    const filterChannel = filters.channel.toLowerCase();
    result = result.filter(t => {
      const chan = (t.channel || '').toLowerCase();
      const source = ((t as any).source || '').toLowerCase();
      if (filterChannel === 'web') return chan === 'web' || chan === 'website' || chan === 'api' || source === 'api' || source === 'website';
      return chan === filterChannel || source === filterChannel;
    });
  }
  if (filters.dateStartMs !== null && filters.dateEndMs !== null) {
    const start = new Date(filters.dateStartMs);
    const end = new Date(filters.dateEndMs);
    result = result.filter(t => {
      const created = viewToDate(t.createdAt);
      return created && created >= start && created <= end;
    });
  }
  return result;
}

// --- page.tsx: statusCounts ---
export function ticketsStatusCounts<T extends Record<string, any>>(base: T[]): StatusCounts {
  return {
    all: base.length,
    Open: base.filter(t => (t.status || '').toLowerCase() === 'open').length,
    'In Progress': base.filter(t => (t.status || '').toLowerCase() === 'in progress').length,
    Resolved: base.filter(t => (t.status || '').toLowerCase() === 'resolved').length,
    Closed: base.filter(t => (t.status || '').toLowerCase() === 'closed').length,
    Queue: base.filter(t => (t.status || '').toLowerCase() === 'queue').length,
    Duplicate: base.filter(t => (t.status || '').toLowerCase() === 'duplicate').length,
    Ignored: base.filter(t => (t.status || '').toLowerCase() === 'ignored').length,
    Waiting: base.filter(t => (t.status || '').toLowerCase() === 'waiting').length,
  };
}

// --- page.tsx: sortedAndFilteredTickets ---
export function sortTicketsForList<T extends Record<string, any>>(base: T[], statusFilter: string): T[] {
  // Copy so the in-place sort below never reorders the shared base array.
  let result = [...base];
  if (statusFilter) {
    const filterStatus = statusFilter.toLowerCase();
    result = result.filter(t => (t.status || '').toLowerCase() === filterStatus);
  }
  return result.sort((a, b) => (viewToDate(b.updatedAt)?.getTime() || 0) - (viewToDate(a.updatedAt)?.getTime() || 0));
}

// --- page.tsx (main): assignedToOptions — assignees present in the role-filtered set ---
export function ticketsAssigneeOptions<T extends Record<string, any>>(roleFilteredTickets: T[]): Array<{ id: string; name: string }> {
  const employees = new Map<string, { id: string; name: string }>();

  roleFilteredTickets.forEach(ticket => {
    const assignee = ticket.assignedTo;

    if (assignee?.userId && assignee?.name) {
      employees.set(assignee.userId, {
        id: assignee.userId,
        name: assignee.name,
      });
    }
  });

  return Array.from(employees.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

// --- page.tsx: duplicate ticket-number scan (auto-heal trigger) ---
export function hasDuplicateTicketNumber<T extends Record<string, any>>(rawTickets: T[] | null | undefined): boolean {
  if (!rawTickets || rawTickets.length === 0) return false;
  const seen = new Set<number>();
  for (const t of rawTickets) {
    if (t.ticketNumber && seen.has(t.ticketNumber)) {
      return true;
    }
    if (t.ticketNumber) seen.add(t.ticketNumber);
  }
  return false;
}

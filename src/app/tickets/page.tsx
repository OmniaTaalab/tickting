'use client';
import { useState, useMemo, useEffect, useTransition, useCallback, memo, Suspense, useRef } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { TicketList } from '@/components/tickets/ticket-list';
import { TicketFilters } from '@/components/tickets/ticket-filters';
import type { TicketStatus, Department, Ticket, TicketChannel, SLASettings } from '@/lib/types';
import { DEFAULT_SLA_SETTINGS } from '@/lib/types';
import { useUser, useDoc, useFirebase, useMemoFirebase, useCollection } from '@/firebase';
import type { UserProfile } from '@/lib/types';
import { doc, query, collection, Timestamp } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import type { ColumnId, SLAFilterValue } from '@/components/tickets/ticket-filters';
import { startOfDay, endOfDay } from 'date-fns';
import { DateRange } from "react-day-picker";
import { cn } from '@/lib/utils';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Zap, Loader2 } from 'lucide-react';
import { useLanguage } from '@/hooks/use-language';
import { calculateWorkingHoursElapsed } from '@/lib/working-hours-utils';
import { useToast } from '@/hooks/use-toast';
import { autoAssignQueuedTickets } from '@/actions/ticket_assignment';
import { fixDuplicateTicketNumbersAction } from '@/actions/ticket_deduplicate';
import { useTicketsList, useTicketFlags } from '@/hooks/use-tickets-list';
import { useTicketsView } from '@/hooks/use-tickets-view';
import { listScope } from '@/lib/ticket-scope';
import {
  applyTicketsFilters,
  hasDuplicateTicketNumber,
  roleFilterTickets,
  sortTicketsForList,
  ticketsStatusCounts,
  EMPTY_STATUS_COUNTS,
  type TicketsViewFilters,
} from '@/lib/tickets-view';



const toDate = (ts: any): Date | null => {
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

// Keep excluded tickets in the normal All Tickets list, but not in SLA-filtered results.
const isSLAExcludedStatus = (status: TicketStatus): boolean =>
  status === 'Duplicate' || String(status) === 'Ignored';

const TICKETS_FILTER_STORAGE_KEY = 'nis_tickets_filter_state_v2';
const TICKETS_COLUMNS_STORAGE_KEY = 'nis_tickets_visible_columns_v2';

const defaultFilters = {
  search: '',
  departmentId: '',
  campusId: '',
  schoolId: '',
  divisionId: '',
  assignedToIds: [] as string[],
  gradeId: '',
  status: '' as TicketStatus | '',
  channel: '' as TicketChannel | '',
  sla: 'all' as SLAFilterValue,
  dateRange: undefined as DateRange | undefined,
};
type TicketsFiltersState = typeof defaultFilters;
function readStoredFilters(slaParam: SLAFilterValue | null
): TicketsFiltersState {
  if (typeof window === 'undefined') {
    return { ...defaultFilters, sla: slaParam || 'all' };
  }

  try {
    // 1. Check URL query parameters first (e.g. if shared or returned via URL)
    const urlParams = new URLSearchParams(window.location.search);
    const qSearch = urlParams.get('search');
    const qDept = urlParams.get('category') || urlParams.get('departmentId');
    const qCampus = urlParams.get('campus');
    const qSchool = urlParams.get('school');
    const qDivision = urlParams.get('division');
    const qGrade = urlParams.get('grade');
    const qStatus = urlParams.get('status');
    const qChannel = urlParams.get('channel');
    const qSla = urlParams.get('sla');
    const qFrom = urlParams.get('from');
    const qTo = urlParams.get('to');

    // 2. Check localStorage, then fallback to sessionStorage
    const saved = localStorage.getItem(TICKETS_FILTER_STORAGE_KEY) || sessionStorage.getItem(TICKETS_FILTER_STORAGE_KEY);
    let parsed: any = null;
    if (saved) {
      try {
        parsed = JSON.parse(saved);
      } catch (e) { }
    }

    const searchVal = qSearch !== null ? qSearch : (typeof parsed?.search === 'string' ? parsed.search : '');
    const deptVal = qDept !== null ? qDept : (typeof parsed?.departmentId === 'string' ? parsed.departmentId : '');
    const campusVal = qCampus !== null ? qCampus : (typeof parsed?.campusId === 'string' ? parsed.campusId : '');
    const schoolVal = qSchool !== null ? qSchool : (typeof parsed?.schoolId === 'string' ? parsed.schoolId : '');
    const divisionVal = qDivision !== null ? qDivision : (typeof parsed?.divisionId === 'string' ? parsed.divisionId : '');
    const gradeVal = qGrade !== null ? qGrade : (typeof parsed?.gradeId === 'string' ? parsed.gradeId : '');
    const statusVal = qStatus !== null ? qStatus : (typeof parsed?.status === 'string' ? parsed.status : '');
    const channelVal = qChannel !== null ? qChannel : (typeof parsed?.channel === 'string' ? parsed.channel : '');
    const slaVal = (qSla as SLAFilterValue) || slaParam || (parsed?.sla as SLAFilterValue) || 'all';

    let dateRange: DateRange | undefined = undefined;
    if (qFrom) {
      const fromDate = new Date(qFrom);
      const toDate = qTo ? new Date(qTo) : undefined;
      if (!isNaN(fromDate.getTime())) {
        dateRange = {
          from: fromDate,
          to: toDate && !isNaN(toDate.getTime()) ? toDate : undefined,
        };
      }
    } else if (parsed?.dateRange?.from) {
      const fromDate = new Date(parsed.dateRange.from);
      const toDate = parsed.dateRange.to ? new Date(parsed.dateRange.to) : undefined;
      if (!isNaN(fromDate.getTime())) {
        dateRange = {
          from: fromDate,
          to: toDate && !isNaN(toDate.getTime()) ? toDate : undefined,
        };
      }
    }

    return {

      search: searchVal,
      assignedToIds: Array.isArray(parsed?.assignedToIds)
        ? parsed.assignedToIds.filter(
          (id: unknown): id is string => typeof id === 'string'
        )
        : [],
      departmentId: deptVal,
      campusId: campusVal,
      schoolId: schoolVal,
      divisionId: divisionVal,
      gradeId: gradeVal,
      status: (statusVal || '') as TicketStatus | '',
      channel: (channelVal || '') as TicketChannel | '',
      sla: slaVal,
      dateRange,
    };
  } catch (e) {
    console.error('Error reading stored ticket filters:', e);
  }

  return { ...defaultFilters, sla: slaParam || 'all' };
}

function readStoredPage(): number {
  if (typeof window === 'undefined') return 1;
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const qPage = urlParams.get('page');
    if (qPage && !isNaN(Number(qPage))) {
      return Math.max(1, Number(qPage));
    }
    const saved = localStorage.getItem(TICKETS_FILTER_STORAGE_KEY) || sessionStorage.getItem(TICKETS_FILTER_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (typeof parsed.currentPage === 'number' && parsed.currentPage > 0) {
        return parsed.currentPage;
      }
    }
  } catch (e) { }
  return 1;
}

const defaultVisibleColumns: Record<ColumnId, boolean> = {
  id: true,
  details: true,
  date: true,
  assignedTo: true,
  assignedAt: true,
  priority: true,
  status: true,
  channel: true,
  division: true,
  campus: true,
  schoolSystem: true,
  slaStatus: true,
  tags: true,
  lastUpdated: true,
  resolvedAt: false,
  closedAt: false,
  firstResponse: true,
};

function readStoredColumns(): Record<ColumnId, boolean> {
  if (typeof window === 'undefined') return defaultVisibleColumns;
  try {
    const saved = localStorage.getItem(TICKETS_COLUMNS_STORAGE_KEY);
    if (saved) {
      return { ...defaultVisibleColumns, ...JSON.parse(saved) };
    }
  } catch (e) { }
  return defaultVisibleColumns;
}

const MemoizedTicketList = memo(TicketList);
const MemoizedTicketFilters = memo(TicketFilters);

function TicketsContent() {
  const searchParams = useSearchParams();
  const slaParam = searchParams.get('sla') as SLAFilterValue | null;
  const { t } = useLanguage();

  const [isPending, startTransition] = useTransition();
  const [filters, setFilters] = useState<TicketsFiltersState>(
    () => readStoredFilters(slaParam)
  );
  const [currentPage, setCurrentPage] = useState(() => readStoredPage());
  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnId, boolean>>(() => readStoredColumns());
  const ITEMS_PER_PAGE = 50;

  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Persist filter state and page to both localStorage and sessionStorage + sync URL
  useEffect(() => {
    try {
      const fromIso = filters.dateRange?.from
        ? (filters.dateRange.from instanceof Date ? filters.dateRange.from.toISOString() : new Date(filters.dateRange.from).toISOString())
        : null;
      const toIso = filters.dateRange?.to
        ? (filters.dateRange.to instanceof Date ? filters.dateRange.to.toISOString() : new Date(filters.dateRange.to).toISOString())
        : null;

      const dataToSave = JSON.stringify({
        search: filters.search,
        departmentId: filters.departmentId,
        campusId: filters.campusId,
        schoolId: filters.schoolId,
        divisionId: filters.divisionId,
        gradeId: filters.gradeId,
        status: filters.status,
        channel: filters.channel,
        sla: filters.sla,
        dateRange: fromIso ? { from: fromIso, to: toIso } : null,
        currentPage,
      });

      sessionStorage.setItem(TICKETS_FILTER_STORAGE_KEY, dataToSave);
      localStorage.setItem(TICKETS_FILTER_STORAGE_KEY, dataToSave);

      if (typeof window !== 'undefined') {
        const params = new URLSearchParams();
        if (filters.search) params.set('search', filters.search);
        if (filters.departmentId) params.set('category', filters.departmentId);
        if (filters.campusId) params.set('campus', filters.campusId);
        if (filters.schoolId) params.set('school', filters.schoolId);
        if (filters.divisionId) params.set('division', filters.divisionId);
        if (filters.gradeId) params.set('grade', filters.gradeId);
        if (filters.status) params.set('status', filters.status);
        if (filters.channel) params.set('channel', filters.channel);
        if (filters.sla && filters.sla !== 'all') params.set('sla', filters.sla);
        if (fromIso) params.set('from', fromIso);
        if (toIso) params.set('to', toIso);
        if (currentPage > 1) params.set('page', String(currentPage));

        const queryStr = params.toString();
        const newUrl = queryStr ? `${window.location.pathname}?${queryStr}` : window.location.pathname;
        window.history.replaceState(null, '', newUrl);
      }
    } catch (e) {
      console.error('Failed to save ticket filter state:', e);
    }
  }, [filters, currentPage]);

  useEffect(() => {
    if (slaParam && slaParam !== filters.sla) {
      setFilters(prev => ({ ...prev, sla: slaParam }));
      setCurrentPage(1);
    }
  }, [slaParam]);

  const handleVisibleColumnsChange = (updater: React.SetStateAction<Record<ColumnId, boolean>>) => {
    setVisibleColumns(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try {
        localStorage.setItem(TICKETS_COLUMNS_STORAGE_KEY, JSON.stringify(next));
      } catch (e) { }
      return next;
    });
  };

  const { user, isUserLoading } = useUser();
  const { firestore } = useFirebase();
  const { toast } = useToast();
  const [isAutoAssigning, startAutoAssignTransition] = useTransition();

  const userProfileRef = useMemoFirebase(() =>
    user && firestore ? doc(firestore, 'users', user.uid) : null,
    [user, firestore]
  );
  const { data: userProfile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef);

  const handleAutoAssignQueue = useCallback(() => {
    startAutoAssignTransition(async () => {
      toast({
        title: t('assigningQueue'),
        description: t('autoAssignQueueDesc'),
      });
      try {
        const deptId = userProfile?.role === 'Manager' ? userProfile?.departmentId : undefined;
        const res = await autoAssignQueuedTickets({ departmentId: deptId });
        if (res.success && res.assignedCount > 0) {
          const names = res.assignments.map(a => `#${a.ticketNumber || a.ticketId.slice(0, 4)} → ${a.assigneeName}`).join(', ');
          toast({
            title: '⚡ ' + t('queueAssignedSuccess').replace('{{count}}', String(res.assignedCount)),
            description: names,
          });
        } else if (res.success && res.assignedCount === 0) {
          toast({
            title: t('noQueuedTickets'),
            description: res.message || t('noAgentsAvailable'),
          });
        } else {
          toast({
            variant: 'destructive',
            title: 'Error',
            description: res.message,
          });
        }
      } catch (err: any) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: err?.message || 'Assignment failed',
        });
      }
    });
  }, [userProfile, toast, t]);


  const slaRef = useMemoFirebase(() => (firestore ? doc(firestore, 'settings', 'sla') : null), [firestore]);
  const { data: savedSLA } = useDoc<SLASettings>(slaRef);
  const slaSettings = savedSLA || DEFAULT_SLA_SETTINGS;

  const departmentsQuery = useMemoFirebase(
    () => (firestore ? query(collection(firestore, 'departments')) : null),
    [firestore]
  );
  const { data: allDepartments, isLoading: areDepartmentsLoading } = useCollection<Department>(departmentsQuery);

  // Read catalog documents to match both ID-based and legacy name-based tickets.
  const campusesQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'campuses')) : null, [firestore]);
  const schoolsQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'schools')) : null, [firestore]);
  const divisionsQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'divisions')) : null, [firestore]);
  const gradesQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'grades')) : null, [firestore]);
  type ScopeOption = { id: string; name: string };
  const { data: campuses } = useCollection<ScopeOption>(campusesQuery);
  const { data: schools } = useCollection<ScopeOption>(schoolsQuery);
  const { data: divisions } = useCollection<ScopeOption>(divisionsQuery);
  const { data: grades } = useCollection<ScopeOption>(gradesQuery);

  // PERF: depend on profile *existence* only (the factory reads no profile fields),
  // so profile snapshots (e.g. status toggles) don't tear down the full-tickets listener.
  // PERF: subscribe to lightweight ticket_summaries scoped to a superset of what
  // roleFilteredTickets keeps (see src/lib/ticket-scope.ts). Same gate as before.
  const ticketScope = (firestore && !isProfileLoading && user && userProfile)
    ? listScope(userProfile.role, user.uid, userProfile.departmentId)
    : null;

  // Date bounds exactly as applyFilters computed them (browser-local day boundaries).
  const dateBounds = useMemo(() => {
    if (!filters.dateRange?.from) return null;
    const validFrom = new Date(filters.dateRange.from);
    if (isNaN(validFrom.getTime())) return null;
    const start = startOfDay(validFrom);
    const validTo = filters.dateRange.to ? new Date(filters.dateRange.to) : null;
    const end = (validTo && !isNaN(validTo.getTime())) ? endOfDay(validTo) : endOfDay(validFrom);
    return { startMs: start.getTime(), endMs: end.getTime() };
  }, [filters.dateRange]);

  const viewFilters = useMemo<TicketsViewFilters>(() => ({
    search: filters.search,
    departmentId: filters.departmentId,
    campusId: filters.campusId,
    schoolId: filters.schoolId,
    divisionId: filters.divisionId,
    gradeId: filters.gradeId,
    channel: filters.channel,
    dateStartMs: dateBounds?.startMs ?? null,
    dateEndMs: dateBounds?.endMs ?? null,
  }), [filters.search, filters.departmentId, filters.campusId, filters.schoolId, filters.divisionId, filters.gradeId, filters.channel, dateBounds]);

  // PAGED MODE (settings/ticketSummaries.pagedTickets / pagedTicketsUids): the server computes
  // this view with the same code (src/lib/tickets-view.ts) and returns only the current page.
  // Not used while the SLA filter is active (it depends on the browser's time zone), and any
  // failure falls back to the full-load path below for the rest of this page's lifetime.
  const flags = useTicketFlags();
  const pagedAllowed = !!(flags?.enabled && user && (flags.pagedTickets || flags.pagedTicketsUids.includes(user.uid)));
  const view = useTicketsView<Ticket>({
    enabled: pagedAllowed && filters.sla === 'all' && ticketScope !== null,
    filters: viewFilters,
    status: filters.status,
    page: currentPage,
    pageSize: ITEMS_PER_PAGE,
    profileKey: userProfile ? `${userProfile.role}|${userProfile.departmentId}|${(userProfile.campusIds || []).join(',')}` : null,
  });
  const pagedMode = pagedAllowed && filters.sla === 'all' && !view.failed;

  const { data: rawTickets, isLoading: areTicketsLoading } = useTicketsList<Ticket>(pagedMode ? null : ticketScope, { keepAlive: true });

  // Auto-heal duplicate ticket numbers if any exist
  const hasTriggeredDeduplicate = useRef(false);
  const duplicateDetected = pagedMode ? (view.rows !== null && view.hasDuplicateTicketNumber) : hasDuplicateTicketNumber(rawTickets);
  useEffect(() => {
    if (hasTriggeredDeduplicate.current) return;
    const hasDuplicate = duplicateDetected;

    if (hasDuplicate) {
      hasTriggeredDeduplicate.current = true;
      fixDuplicateTicketNumbersAction().then(res => {
        if (res.success && res.fixedCount > 0) {
          console.log(`[Deduplicate] Automatically repaired ${res.fixedCount} duplicate tickets.`);
        }
      }).catch(err => {
        console.error('[Deduplicate] Auto-repair failed:', err);
      });
    }
  }, [duplicateDetected]);

  const roleFilteredTickets = useMemo(
    () => roleFilterTickets(rawTickets, userProfile, user?.uid),
    [rawTickets, userProfile, user]
  );

  // main: assignee options for the Assigned-To filter. In paged mode the server computes the
  // same list (ticketsAssigneeOptions in src/lib/tickets-view.ts) from the role-filtered set.
  const assignedToOptions = useMemo(() => {
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
  }, [roleFilteredTickets]);
  const assigneeOptionsForFilter = pagedMode ? (view.assigneeOptions || []) : assignedToOptions;

  // Role filter, search/department/scope/channel/date filters, status counts and sort now
  // live in src/lib/tickets-view.ts (shared with the server). Only the SLA filter stays here.
  const applyFilters = (tickets: Ticket[]) => {
    if (!allDepartments) return tickets;
    let result = applyTicketsFilters(tickets, viewFilters, { campuses, schools, divisions, grades }, !!allDepartments);
    if (filters.sla !== 'all') {
      result = result.filter(t => {
        // Excluded statuses must never appear in breached or at-risk SLA filters.
        if (isSLAExcludedStatus(t.status)) return false;

        // MATCH BADGE LOGIC: Start from assignedAt
        const start = toDate(t.assignedAt || t.createdAt);
        // Only assigned tickets contribute to SLA stats in the list
        if (!start || !t.assignedTo) return false;

        const responded = toDate(t.firstRespondedAt);
        const isFinished = ['Resolved', 'Closed'].includes(t.status);
        const finishedAt = isFinished ? toDate(t.resolvedAt || t.closedAt) : null;

        const dept = allDepartments.find(d => d.id === t.departmentId);

        // Correct channel normalization for SLA key lookup
        const rawChan = t.channel || 'Email';
        let channelKey: TicketChannel = 'Email';
        const lower = rawChan.toLowerCase();
        if (lower.includes('social')) channelKey = 'Social Media';
        else if (lower.includes('walk')) channelKey = 'Walk-in';
        else if (lower === 'website' || lower === 'api') channelKey = 'Web';
        else if (lower === 'whatsapp') channelKey = 'WhatsApp';
        else if (lower === 'form') channelKey = 'Form';
        else if (lower === 'phone') channelKey = 'Phone';
        else channelKey = (rawChan.charAt(0).toUpperCase() + rawChan.slice(1).toLowerCase()) as TicketChannel;

        const priority = t.priority || 'Normal';
        const policy = slaSettings[channelKey] || slaSettings['Email'];
        const limitHours = policy?.[priority] || 24;

        const compareTime = finishedAt || responded || now;
        const workingHoursElapsed = calculateWorkingHoursElapsed(start, compareTime, dept?.workingHours);

        if (filters.sla === 'breached') {
          return workingHoursElapsed >= limitHours;
        }
        if (filters.sla === 'at-risk') {
          if (finishedAt || responded) return false;
          const hoursRemaining = limitHours - workingHoursElapsed;
          return hoursRemaining > 0 && hoursRemaining <= 2;
        }
        return true;
      });
    }
    return result;
  };

  // PERF: applyFilters (search, scope, date and the expensive SLA working-hours filter)
  // used to run twice per recompute — once for statusCounts and once for the list —
  // with identical inputs (it never reads filters.status). Compute it once and share.
  // Deps are exactly the deps both consumers had before.
  const filteredBase = useMemo(() => {
    if (pagedMode) return null;
    if (!roleFilteredTickets) return null;
    return applyFilters(roleFilteredTickets);
  }, [pagedMode, roleFilteredTickets, filters, slaSettings, now, allDepartments]);

  const statusCounts = useMemo(() => {
    if (pagedMode) return view.statusCounts || EMPTY_STATUS_COUNTS;
    if (!roleFilteredTickets || !filteredBase) return EMPTY_STATUS_COUNTS;
    return ticketsStatusCounts(filteredBase);
  }, [pagedMode, view.statusCounts, roleFilteredTickets, filteredBase]);

  // Background auto-assignment: when an available agent is active and queued tickets exist, auto-assign periodically
  const lastAutoAssignRef = useRef<number>(0);
  useEffect(() => {
    const queuedCount = statusCounts?.Queue || 0;
    if (queuedCount > 0 && userProfile?.status === 'Available' && !isAutoAssigning) {
      const nowMs = Date.now();
      if (nowMs - lastAutoAssignRef.current > 30000) {
        lastAutoAssignRef.current = nowMs;
        const deptId = userProfile?.role === 'Manager' ? userProfile?.departmentId : undefined;
        autoAssignQueuedTickets({ departmentId: deptId })
          .then(res => {
            if (res.success && res.assignedCount > 0) {
              const names = res.assignments.map(a => `#${a.ticketNumber || a.ticketId.slice(0, 4)} → ${a.assigneeName}`).join(', ');
              toast({
                title: '⚡ ' + t('queueAssignedSuccess').replace('{{count}}', String(res.assignedCount)),
                description: names,
              });
            }
          })
          .catch(e => console.warn('Background auto-assign note:', e));
      }
    }
  }, [statusCounts?.Queue, userProfile?.status, userProfile?.departmentId, userProfile?.role, isAutoAssigning, toast, t]);

  const sortedAndFilteredTickets = useMemo(() => {
    if (pagedMode) return null;
    if (!roleFilteredTickets || !filteredBase) return null;
    return sortTicketsForList(filteredBase, filters.status);
  }, [pagedMode, roleFilteredTickets, filteredBase, filters.status]);

  const totalItems = pagedMode ? view.totalItems : (sortedAndFilteredTickets?.length || 0);
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

  const paginatedTickets = useMemo(() => {
    if (pagedMode) return view.rows;
    if (!sortedAndFilteredTickets) return null;
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return sortedAndFilteredTickets.slice(start, start + ITEMS_PER_PAGE);
  }, [pagedMode, view.rows, sortedAndFilteredTickets, currentPage]);

  const fetchAllRows = view.fetchAllRows;
  const exportRows = useCallback(() => fetchAllRows(), [fetchAllRows]);

  // Paged mode: the ordered [id, assigneeUserId] list for the current filters, used by the
  // click-capture below to store next/prev navigation order (main). Refreshed after each view
  // response; keyed by the request so a stale list is never used for different filters.
  const orderedIdsRef = useRef<{ key: string; ids: Array<[string, string | null]> } | null>(null);
  const { fetchOrderedIds, requestKey: viewRequestKey, rows: viewRows } = view;
  useEffect(() => {
    if (!pagedMode || !viewRequestKey || viewRows === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchOrderedIds()
        .then(ids => { if (!cancelled) orderedIdsRef.current = { key: viewRequestKey, ids }; })
        .catch(() => { /* click falls back to the visible page */ });
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pagedMode, viewRequestKey, viewRows, fetchOrderedIds]);

  const handleFilterChange = useCallback((newFilters: any) => {
    startTransition(() => {
      setFilters(prev => ({ ...prev, ...newFilters }));
      setCurrentPage(1);
    });
  }, []);

  const isLoading = isUserLoading || isProfileLoading || areDepartmentsLoading || (pagedMode ? view.isLoading : areTicketsLoading);

  const departmentsForFilter = useMemo(() => {
    if (!allDepartments) return [];
    if (userProfile?.role === 'Manager' && userProfile?.departmentId) {
      const myDept = allDepartments.filter(d => d.id === userProfile.departmentId);
      return myDept.length > 0 ? myDept : allDepartments;
    }
    return allDepartments;
  }, [allDepartments, userProfile]);

  return (
    <Card className="border-none shadow-sm overflow-hidden bg-white">
      <CardHeader className="bg-slate-50/30 border-b">
        <CardTitle>{t('ticketsPageTitle')}</CardTitle>
        <CardDescription>
          {userProfile?.role === 'Employee' ? t('personalQueue').replace('{{count}}', String(userProfile?.campusIds?.length || 0)) : t('ticketsPageSub')}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {statusCounts?.Queue !== undefined && statusCounts.Queue > 0 && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-300/40 rounded-xl">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-amber-500/15 text-amber-700">
                <Zap className="h-4 w-4 fill-amber-500 text-amber-600 animate-pulse" />
              </div>
              <div>
                <p className="text-xs font-black text-amber-900 tracking-tight flex items-center gap-2">
                  <span>{statusCounts.Queue} {t('queue')}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 uppercase tracking-widest">
                    Round-Robin
                  </span>
                </p>
                <p className="text-[11px] font-medium text-amber-700/90">
                  {t('autoAssignQueueDesc')}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={handleAutoAssignQueue}
              disabled={isAutoAssigning}
              className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs h-8 px-3.5 rounded-lg shadow-sm gap-1.5 transition-all shrink-0"
            >
              {isAutoAssigning ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{t('assigningQueue')}</span>
                </>
              ) : (
                <>
                  <Zap className="h-3.5 w-3.5 fill-current" />
                  <span>{t('autoAssignQueue')}</span>
                </>
              )}
            </Button>
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <MemoizedTicketFilters
            departments={departmentsForFilter.length > 0 ? departmentsForFilter : (allDepartments || [])}
            campuses={campuses || []}
            assigneeOptions={assigneeOptionsForFilter}
            schools={schools || []}
            divisions={divisions || []}
            grades={grades || []}
            showDepartmentFilter={true}
            values={filters}
            onFilterChange={handleFilterChange}
            visibleColumns={visibleColumns}
            onVisibleColumnsChange={handleVisibleColumnsChange}
            data={sortedAndFilteredTickets || []}
            onExportRows={pagedMode ? exportRows : undefined}
            exportDisabled={pagedMode ? totalItems === 0 : undefined}
            statusCounts={statusCounts}
          />
        )}

        <div
          className={cn("transition-opacity duration-200", (isPending || (pagedMode && view.isFetching && !view.isLoading)) ? "opacity-50 pointer-events-none" : "opacity-100")}
          onClickCapture={(event) => {
            if (!user || !paginatedTickets || (!pagedMode && !sortedAndFilteredTickets)) return;
            const target = event.target as HTMLElement;
            // The checkbox is for selection, not for opening a ticket.
            if (target.closest('[role="checkbox"], button, a')) return;
            const cell = target.closest('td');
            const row = cell?.closest('tr');
            const body = row?.parentElement;
            if (!cell || !row || !body || body.tagName.toLowerCase() !== 'tbody') return;
            const rowIndex = Array.from(body.children).indexOf(row);
            const openedTicket = paginatedTickets[rowIndex];
            if (!openedTicket) return;

            if (userProfile?.role === 'Employee' &&
              openedTicket.assignedTo?.userId !== user.uid) return;
            try {
              sessionStorage.setItem('nis_my_ticket_navigation_v1', JSON.stringify({
                userId: user.uid,
                targetTicketId: openedTicket.id,
                orderedTicketIds: (pagedMode
                  // paged mode: full ordered [id, assigneeUserId] list fetched from the server for the
                  // current filters (falls back to the visible page if it has not arrived yet)
                  ? (orderedIdsRef.current && orderedIdsRef.current.key === view.requestKey
                      ? orderedIdsRef.current.ids
                      : paginatedTickets.map(item => [item.id, item.assignedTo?.userId ?? null] as [string, string | null]))
                  : sortedAndFilteredTickets!.map(item => [item.id, item.assignedTo?.userId ?? null] as [string, string | null]))
                  .filter(([, assigneeUid]) =>
                    userProfile?.role === 'Employee'
                      ? assigneeUid === user.uid
                      : true
                  )
                  .map(([id]) => id),
                capturedAt: Date.now(),
              }));
            } catch (error) {
              console.warn('Unable to save ticket navigation order:', error);
            }
          }}
        >
          <MemoizedTicketList
            data={paginatedTickets}
            isLoading={isLoading}
            visibleColumns={visibleColumns}
            departments={allDepartments || []}
            slaSettings={slaSettings}
          />
        </div>

        {!isLoading && totalPages > 1 && (
          <div className="flex items-center justify-between px-2 py-4 border-t border-slate-100 bg-slate-50/30 rounded-b-xl">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-tight">
              {t('showing')} <span className="text-slate-900">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span> {t('to')} <span className="text-slate-900">{Math.min(currentPage * ITEMS_PER_PAGE, totalItems)}</span> {t('of')} <span className="text-slate-900">{totalItems}</span>
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}><ChevronsLeft className="h-4 w-4" /></Button>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1}><ChevronLeft className="h-4 w-4" /></Button>
              <div className="flex items-center gap-1.5 px-4 h-8 bg-white border border-slate-200 rounded-lg shadow-sm">
                <span className="text-xs font-black text-slate-900">{currentPage}</span>
                <span className="text-[10px] font-bold text-slate-400 uppercase">{t('of')}</span>
                <span className="text-xs font-black text-slate-900">{totalPages}</span>
              </div>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages}><ChevronRight className="h-4 w-4" /></Button>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}><ChevronsRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function TicketsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center"><Skeleton className="h-10 w-full" /></div>}>
      <TicketsContent />
    </Suspense>
  );
}
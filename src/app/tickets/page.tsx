
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
import { assignQueuedTicketsAction } from '@/actions/ticket_assignment';


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

const TICKETS_FILTER_STORAGE_KEY = 'nis_tickets_filter_state_v2';
const TICKETS_COLUMNS_STORAGE_KEY = 'nis_tickets_visible_columns_v2';

const defaultFilters = {
  search: '',
  departmentId: '',
  status: '' as TicketStatus | '',
  channel: '' as TicketChannel | '',
  sla: 'all' as SLAFilterValue,
  dateRange: undefined as DateRange | undefined,
};

function readStoredFilters(slaParam: SLAFilterValue | null) {
  if (typeof window === 'undefined') {
    return { ...defaultFilters, sla: slaParam || 'all' };
  }

  try {
    // 1. Check URL query parameters first (e.g. if shared or returned via URL)
    const urlParams = new URLSearchParams(window.location.search);
    const qSearch = urlParams.get('search');
    const qDept = urlParams.get('category') || urlParams.get('departmentId');
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
      } catch (e) {}
    }

    const searchVal = qSearch !== null ? qSearch : (typeof parsed?.search === 'string' ? parsed.search : '');
    const deptVal = qDept !== null ? qDept : (typeof parsed?.departmentId === 'string' ? parsed.departmentId : '');
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
      departmentId: deptVal,
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
  } catch (e) {}
  return 1;
}

const defaultVisibleColumns: Record<ColumnId, boolean> = {
  id: true,
  details: true,
  date: true,
  assignedTo: true,
  priority: true,
  status: true,
  channel: true,
  division: true,
  campus: true,
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
  } catch (e) {}
  return defaultVisibleColumns;
}

const MemoizedTicketList = memo(TicketList);
const MemoizedTicketFilters = memo(TicketFilters);

function TicketsContent() {
  const searchParams = useSearchParams();
  const slaParam = searchParams.get('sla') as SLAFilterValue | null;
  const { t } = useLanguage();

  const [isPending, startTransition] = useTransition();
  const [filters, setFilters] = useState(() => readStoredFilters(slaParam));
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
      } catch (e) {}
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
        const res = await assignQueuedTicketsAction(deptId);
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

  const ticketsQuery = useMemoFirebase(() => {
    if (!firestore || isProfileLoading || !user || !userProfile) return null;
    return query(collection(firestore, 'tickets'));
  }, [firestore, user, userProfile, isProfileLoading]);

  const { data: rawTickets, isLoading: areTicketsLoading } = useCollection<Ticket>(ticketsQuery);

  const roleFilteredTickets = useMemo(() => {
    if (!rawTickets || !userProfile || !user) return [];
    
    if (userProfile.role === 'Admin') return rawTickets;

    const myUserId = user.uid;
    const myDeptId = userProfile.departmentId;
    const myCampuses = userProfile.campusIds || [];
    
    return rawTickets.filter(t => {
        const isAssignedToMe = t.assignedTo?.userId === myUserId;
        const isSameDept = t.departmentId === myDeptId;
        const isAllowedCampus = myCampuses.length === 0 || (t.campusId && myCampuses.includes(t.campusId));
        
        if (userProfile.role === 'Manager') {
            // STRICT: Must be department AND within assigned campuses
            return isSameDept && isAllowedCampus;
        }

        if (userProfile.role === 'Employee') {
            // Own tasks OR (Dept match if viewing department pool)
            return isAssignedToMe || (isSameDept && isAllowedCampus);
        }
        
        return isSameDept && isAllowedCampus;
    });
  }, [rawTickets, userProfile, user]);

  const applyFilters = (tickets: Ticket[]) => {
    if (!allDepartments) return tickets;
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
    if (filters.channel) {
      const filterChannel = filters.channel.toLowerCase();
      result = result.filter(t => {
        const chan = (t.channel || '').toLowerCase();
        const source = ((t as any).source || '').toLowerCase();
        if (filterChannel === 'web') return chan === 'web' || chan === 'website' || chan === 'api' || source === 'api' || source === 'website';
        return chan === filterChannel || source === filterChannel;
      });
    }
    if (filters.dateRange?.from) {
      const validFrom = new Date(filters.dateRange.from);
      if (!isNaN(validFrom.getTime())) {
        const start = startOfDay(validFrom);
        const validTo = filters.dateRange.to ? new Date(filters.dateRange.to) : null;
        const end = (validTo && !isNaN(validTo.getTime())) ? endOfDay(validTo) : endOfDay(validFrom);
        result = result.filter(t => {
          const created = toDate(t.createdAt);
          return created && created >= start && created <= end;
        });
      }
    }
    if (filters.sla !== 'all') {
      result = result.filter(t => {
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

  const statusCounts = useMemo(() => {
    if (!roleFilteredTickets) return { all: 0, Open: 0, 'In Progress': 0, Resolved: 0, Closed: 0, Queue: 0, Duplicate: 0, Waiting: 0 };
    const base = applyFilters(roleFilteredTickets);
    return {
      all: base.length,
      Open: base.filter(t => (t.status || '').toLowerCase() === 'open').length,
      'In Progress': base.filter(t => (t.status || '').toLowerCase() === 'in progress').length,
      Resolved: base.filter(t => (t.status || '').toLowerCase() === 'resolved').length,
      Closed: base.filter(t => (t.status || '').toLowerCase() === 'closed').length,
      Queue: base.filter(t => (t.status || '').toLowerCase() === 'queue').length,
      Duplicate: base.filter(t => (t.status || '').toLowerCase() === 'duplicate').length,
      Waiting: base.filter(t => (t.status || '').toLowerCase() === 'waiting').length,
    };
  }, [roleFilteredTickets, filters, slaSettings, now, allDepartments]);

  // Background auto-assignment: when an available agent is active and queued tickets exist, auto-assign periodically
  const lastAutoAssignRef = useRef<number>(0);
  useEffect(() => {
    const queuedCount = statusCounts?.Queue || 0;
    if (queuedCount > 0 && userProfile?.status === 'Available' && !isAutoAssigning) {
      const nowMs = Date.now();
      if (nowMs - lastAutoAssignRef.current > 30000) {
        lastAutoAssignRef.current = nowMs;
        const deptId = userProfile?.role === 'Manager' ? userProfile?.departmentId : undefined;
        assignQueuedTicketsAction(deptId)
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
    if (!roleFilteredTickets) return null;
    const base = applyFilters(roleFilteredTickets);
    let result = base;
    if (filters.status) {
      const filterStatus = filters.status.toLowerCase();
      result = result.filter(t => (t.status || '').toLowerCase() === filterStatus);
    }
    return result.sort((a, b) => (toDate(b.updatedAt)?.getTime() || 0) - (toDate(a.updatedAt)?.getTime() || 0));
  }, [roleFilteredTickets, filters, slaSettings, now, allDepartments]);

  const totalItems = sortedAndFilteredTickets?.length || 0;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

  const paginatedTickets = useMemo(() => {
    if (!sortedAndFilteredTickets) return null;
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return sortedAndFilteredTickets.slice(start, start + ITEMS_PER_PAGE);
  }, [sortedAndFilteredTickets, currentPage]);

  const handleFilterChange = useCallback((newFilters: any) => {
    startTransition(() => {
      setFilters(prev => ({ ...prev, ...newFilters }));
      setCurrentPage(1);
    });
  }, []);

  const isLoading = isUserLoading || isProfileLoading || areDepartmentsLoading || areTicketsLoading;

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
            showDepartmentFilter={true}
            values={filters}
            onFilterChange={handleFilterChange}
            visibleColumns={visibleColumns}
            onVisibleColumnsChange={handleVisibleColumnsChange}
            data={sortedAndFilteredTickets || []}
            statusCounts={statusCounts}
          />
        )}

        <div className={cn("transition-opacity duration-200", isPending ? "opacity-50 pointer-events-none" : "opacity-100")}>
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

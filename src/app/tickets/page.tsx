
'use client';
import { useState, useMemo, useEffect, useTransition, memo, Suspense } from 'react';
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
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useLanguage } from '@/hooks/use-language';
import { calculateWorkingHoursElapsed } from '@/lib/working-hours-utils';

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

const MemoizedTicketList = memo(TicketList);
const MemoizedTicketFilters = memo(TicketFilters);

function TicketsContent() {
  const searchParams = useSearchParams();
  const slaParam = searchParams.get('sla') as SLAFilterValue | null;
  const { t } = useLanguage();

  const [isPending, startTransition] = useTransition();
  const [filters, setFilters] = useState({
    search: '',
    departmentId: '',
    status: '' as TicketStatus | '',
    channel: '' as TicketChannel | '',
    sla: (slaParam || 'all') as SLAFilterValue,
    dateRange: undefined as DateRange | undefined,
  });

  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 50;

  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (slaParam && slaParam !== filters.sla) {
        setFilters(prev => ({ ...prev, sla: slaParam }));
    }
  }, [slaParam]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnId, boolean>>({
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
  });

  const { user, isUserLoading } = useUser();
  const { firestore } = useFirebase();

  const userProfileRef = useMemoFirebase(() =>
    user && firestore ? doc(firestore, 'users', user.uid) : null,
    [user, firestore]
  );
  const { data: userProfile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef);

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
      const start = startOfDay(filters.dateRange.from!);
      const end = filters.dateRange.to ? endOfDay(filters.dateRange.to) : endOfDay(filters.dateRange.from!);
      result = result.filter(t => {
        const created = toDate(t.createdAt);
        return created && created >= start && created <= end;
      });
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

  const handleFilterChange = (newFilters: any) => {
    startTransition(() => {
      setFilters(prev => ({ ...prev, ...newFilters }));
    });
  };

  const isLoading = isUserLoading || isProfileLoading || areDepartmentsLoading || areTicketsLoading;

  const departmentsForFilter = useMemo(() => {
    if (!allDepartments || !userProfile) return [];
    if (userProfile.role === 'Manager') return allDepartments.filter(d => d.id === userProfile.departmentId);
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
        {isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <MemoizedTicketFilters
            departments={departmentsForFilter}
            showDepartmentFilter={userProfile?.role === 'Admin'}
            values={filters}
            onFilterChange={handleFilterChange}
            visibleColumns={visibleColumns}
            onVisibleColumnsChange={setVisibleColumns}
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

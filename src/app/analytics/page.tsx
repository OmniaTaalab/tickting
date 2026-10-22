'use client';

import { useMemo, useState } from 'react';
import { useCollection, useFirebase, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, query, doc, orderBy } from 'firebase/firestore';
import type { Ticket, TicketStatus, UserProfile, Department, Campus } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { InboundVolumeChart } from '@/components/analytics/inbound-volume-chart';
import { ResolutionTimeByDivisionChart } from '@/components/analytics/resolution-time-chart';
import { TopIssueCategoriesChart } from '@/components/analytics/top-issues-chart';
import { BarChart3, RotateCcw, Building2 } from 'lucide-react';
import { useLanguage } from '@/hooks/use-language';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { subDays } from 'date-fns';

type DateFilter = 'all' | '7days' | '30days' | '90days';
type StatusFilter = TicketStatus | 'all';

const STATUS_OPTIONS: TicketStatus[] = [
  'Open',
  'In Progress',
  'Waiting',
  'Queue',
  'Resolved',
  'Closed',
  'Duplicate',
  'Ignored',
];

export default function AnalyticsPage() {
  const { firestore } = useFirebase();
  const { user } = useUser();
  const { t } = useLanguage();

  const [selectedDept, setSelectedDept] = useState<string>('all');
  const [selectedCampus, setSelectedCampus] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>('all');
  const [dateRange, setDateRange] = useState<DateFilter>('30days');

  const userProfileRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, 'users', user.uid) : null),
    [user, firestore]
  );
  const { data: userProfile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef);

  const deptsQuery = useMemoFirebase(
    () => (firestore ? query(collection(firestore, 'departments'), orderBy('name', 'asc')) : null),
    [firestore]
  );
  const { data: departments } = useCollection<Department>(deptsQuery);

  const campusesQuery = useMemoFirebase(
    () => (firestore ? query(collection(firestore, 'campuses'), orderBy('name', 'asc')) : null),
    [firestore]
  );
  const { data: campuses } = useCollection<Campus>(campusesQuery);

  const ticketsQuery = useMemoFirebase(() => {
    if (!firestore || !user || !userProfile) return null;
    return query(collection(firestore, 'tickets'));
  }, [firestore, user, userProfile]);

  const { data: rawTickets, isLoading: isTicketsLoading } = useCollection<Ticket>(ticketsQuery);

  // Preserve the existing role-based visibility rules.
  const roleFilteredTickets = useMemo(() => {
    if (!rawTickets || !userProfile) return [];
    if (userProfile.role === 'Admin') return rawTickets;

    const myCampuses = userProfile.campusIds || [];
    if (userProfile.role === 'Manager' || userProfile.role === 'Employee') {
      return rawTickets.filter(ticket =>
        ticket.departmentId === userProfile.departmentId &&
        myCampuses.includes(ticket.campusId || '')
      );
    }
    return [];
  }, [rawTickets, userProfile]);

  // Apply department, campus and date filters before the optional status filter.
  // Ignored tickets remain in general analytics (volume, issue categories, totals).
  const scopedTickets = useMemo(() => {
    let result = [...roleFilteredTickets];

    if (selectedDept !== 'all') {
      result = result.filter(ticket => ticket.departmentId === selectedDept);
    }
    if (selectedCampus !== 'all') {
      result = result.filter(ticket => ticket.campusId === selectedCampus);
    }
    if (dateRange !== 'all') {
      const days = dateRange === '7days' ? 7 : dateRange === '30days' ? 30 : 90;
      const cutoff = subDays(new Date(), days);
      result = result.filter(ticket => {
        if (!ticket.createdAt) return false;
        const createdAt = typeof (ticket.createdAt as any).toDate === 'function'
          ? (ticket.createdAt as any).toDate()
          : new Date(ticket.createdAt as any);
        return createdAt instanceof Date && !isNaN(createdAt.getTime()) && createdAt >= cutoff;
      });
    }
    return result;
  }, [roleFilteredTickets, selectedDept, selectedCampus, dateRange]);

  const filteredTickets = useMemo(
    () => selectedStatus === 'all'
      ? scopedTickets
      : scopedTickets.filter(ticket => ticket.status === selectedStatus),
    [scopedTickets, selectedStatus]
  );

  const ignoredCount = scopedTickets.filter(ticket => ticket.status === 'Ignored').length;

  const statusLabels: Record<TicketStatus, string> = {
    Open: t('open'),
    'In Progress': t('inProgress'),
    Waiting: t('waiting'),
    Queue: t('queue'),
    Resolved: t('resolved'),
    Closed: t('closed'),
    Duplicate: t('duplicate'),
    Ignored: 'Ignored',
  };

  const handleResetFilters = () => {
    setSelectedDept('all');
    setSelectedCampus('all');
    setSelectedStatus('all');
    setDateRange('30days');
  };

  const hasActiveFilters = selectedDept !== 'all' || selectedCampus !== 'all' || selectedStatus !== 'all' || dateRange !== '30days';

  if (isProfileLoading || isTicketsLoading) {
    return <div className="p-8 space-y-6"><Skeleton className="h-10 w-48" /><Skeleton className="h-96 w-full" /></div>;
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 font-headline">{t('analytics')}</h1>
          <p className="text-slate-500">{t('analyticsSub')}</p>
        </div>
      </div>

      {/* FILTERS TOOLBAR */}
      <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {userProfile?.role === 'Admin' ? (
            <div>
              <Select value={selectedDept} onValueChange={setSelectedDept}>
                <SelectTrigger className="h-10 bg-slate-50 border-slate-200 rounded-xl text-xs font-semibold">
                  <SelectValue placeholder={t('filterByDepartment')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allCategories')}</SelectItem>
                  {departments?.map(dept => (
                    <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="flex items-center gap-2 h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600">
              <Building2 className="h-3.5 w-3.5 text-slate-400" />
              <span>{departments?.find(d => d.id === userProfile?.departmentId)?.name || 'My Department'}</span>
            </div>
          )}

          <div>
            <Select value={selectedCampus} onValueChange={setSelectedCampus}>
              <SelectTrigger className="h-10 bg-slate-50 border-slate-200 rounded-xl text-xs font-semibold">
                <SelectValue placeholder={t('filterByCampus')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allCampuses')}</SelectItem>
                {campuses?.map(campus => (
                  <SelectItem key={campus.id} value={campus.id}>{campus.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Select value={dateRange} onValueChange={value => setDateRange(value as DateFilter)}>
              <SelectTrigger className="h-10 bg-slate-50 border-slate-200 rounded-xl text-xs font-semibold">
                <SelectValue placeholder={t('allTime')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7days">{t('filterLast7Days')}</SelectItem>
                <SelectItem value="30days">{t('filterLast30Days')}</SelectItem>
                <SelectItem value="90days">Last 90 Days</SelectItem>
                <SelectItem value="all">{t('allTime')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Select value={selectedStatus} onValueChange={value => setSelectedStatus(value as StatusFilter)}>
              <SelectTrigger className="h-10 bg-slate-50 border-slate-200 rounded-xl text-xs font-semibold">
                <SelectValue placeholder={t('statusCol')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('statusCol')} — {t('total')}</SelectItem>
                {STATUS_OPTIONS.map(status => (
                  <SelectItem key={status} value={status}>{statusLabels[status]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Status summary: visible regardless of the optional status filter */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 border-t border-slate-100 pt-3">
          <span className="font-semibold">{scopedTickets.length} {t('ticketsPageTitle')}</span>
          <span className="font-semibold px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700">
            Ignored: {ignoredCount}
          </span>
          <span className="text-slate-400">Ignored / Duplicate: SLA Excluded</span>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetFilters}
              className="ms-auto h-7 text-xs font-bold text-slate-500 hover:text-red-600 gap-1.5"
            >
              <RotateCcw className="h-3 w-3" />
              {t('resetFilters')}
            </Button>
          )}
        </div>
      </div>

      {filteredTickets.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-center p-10 bg-slate-50/50 rounded-2xl border-2 border-dashed border-slate-200">
          <BarChart3 className="h-16 w-16 text-muted-foreground mb-4 opacity-20" />
          <h2 className="text-xl font-bold text-slate-900">{t('noAnalyticsData')}</h2>
          <p className="text-slate-500 max-w-md mx-auto mt-2 text-sm">{t('noAnalyticsDataSub')}</p>
          {hasActiveFilters && (
            <Button variant="outline" size="sm" onClick={handleResetFilters} className="mt-4 gap-2">
              <RotateCcw className="h-3.5 w-3.5" />
              {t('resetFilters')}
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-6">
          <InboundVolumeChart tickets={filteredTickets} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ResolutionTimeByDivisionChart tickets={filteredTickets} />
            <TopIssueCategoriesChart tickets={filteredTickets} />
          </div>
        </div>
      )}
    </div>
  );
}

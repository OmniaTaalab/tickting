'use client';

import { useMemo, useState } from 'react';
import { useCollection, useFirebase, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, query, doc, orderBy } from 'firebase/firestore';
import type { Ticket, UserProfile, Department, Campus } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { InboundVolumeChart } from '@/components/analytics/inbound-volume-chart';
import { ResolutionTimeByDivisionChart } from '@/components/analytics/resolution-time-chart';
import { TopIssueCategoriesChart } from '@/components/analytics/top-issues-chart';
import { BarChart3, Filter, RotateCcw, Building2, School, Calendar as CalendarIcon } from 'lucide-react';
import { useLanguage } from '@/hooks/use-language';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { subDays } from 'date-fns';

export default function AnalyticsPage() {
  const { firestore } = useFirebase();
  const { user } = useUser();
  const { t } = useLanguage();

  const [selectedDept, setSelectedDept] = useState<string>('all');
  const [selectedCampus, setSelectedCampus] = useState<string>('all');
  const [dateRange, setDateRange] = useState<'all' | '7days' | '30days' | '90days'>('30days');

  const userProfileRef = useMemoFirebase(() =>
    user && firestore ? doc(firestore, 'users', user.uid) : null,
    [user, firestore]
  );
  const { data: userProfile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef);

  const deptsQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'departments'), orderBy('name', 'asc')) : null, [firestore]);
  const { data: departments } = useCollection<Department>(deptsQuery);

  const campusesQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'campuses'), orderBy('name', 'asc')) : null, [firestore]);
  const { data: campuses } = useCollection<Campus>(campusesQuery);

  const ticketsQuery = useMemoFirebase(() => {
    if (!firestore || !user || !userProfile) return null;
    return query(collection(firestore, 'tickets'));
  }, [firestore, user, userProfile]);

  const { data: rawTickets, isLoading: isTicketsLoading } = useCollection<Ticket>(ticketsQuery);

  // STRICT PRIVACY: Managers/Staff only see data for their Category AND Campuses
  const roleFilteredTickets = useMemo(() => {
    if (!rawTickets || !userProfile) return [];
    
    if (userProfile.role === 'Admin') return rawTickets;

    const myCampuses = userProfile.campusIds || [];
    if (userProfile.role === 'Manager' || userProfile.role === 'Employee') {
        return rawTickets.filter(t => 
            t.departmentId === userProfile.departmentId && 
            myCampuses.includes(t.campusId || '')
        );
    }
    
    return [];
  }, [rawTickets, userProfile]);

  // Interactive user filters on top of role permissions
  const filteredTickets = useMemo(() => {
    let result = [...roleFilteredTickets];

    // Department filter
    if (selectedDept !== 'all') {
      result = result.filter(t => t.departmentId === selectedDept);
    }

    // Campus filter
    if (selectedCampus !== 'all') {
      result = result.filter(t => t.campusId === selectedCampus);
    }

    // Date range filter
    if (dateRange !== 'all') {
      const days = dateRange === '7days' ? 7 : dateRange === '30days' ? 30 : 90;
      const cutoff = subDays(new Date(), days);
      result = result.filter(t => {
        const d = t.createdAt ? (typeof (t.createdAt as any).toDate === 'function' ? (t.createdAt as any).toDate() : new Date(t.createdAt as any)) : null;
        return d && d >= cutoff;
      });
    }

    return result;
  }, [roleFilteredTickets, selectedDept, selectedCampus, dateRange]);

  const handleResetFilters = () => {
    setSelectedDept('all');
    setSelectedCampus('all');
    setDateRange('30days');
  };

  const hasActiveFilters = selectedDept !== 'all' || selectedCampus !== 'all' || dateRange !== '30days';

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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Department Filter (Admin only or disabled for restricted managers) */}
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

          {/* Campus Filter */}
          <div>
            <Select value={selectedCampus} onValueChange={setSelectedCampus}>
              <SelectTrigger className="h-10 bg-slate-50 border-slate-200 rounded-xl text-xs font-semibold">
                <SelectValue placeholder={t('filterByCampus')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allCampuses')}</SelectItem>
                {campuses?.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date Range Filter */}
          <div>
            <Select value={dateRange} onValueChange={(val: any) => setDateRange(val)}>
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
        </div>

        {/* Reset & Summary */}
        {hasActiveFilters && (
          <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
            <span className="text-slate-500 font-medium">
              {filteredTickets.length} {t('ticketsPageTitle')}
            </span>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleResetFilters} 
              className="h-7 text-xs font-bold text-slate-500 hover:text-red-600 gap-1.5"
            >
              <RotateCcw className="h-3 w-3" />
              {t('resetFilters')}
            </Button>
          </div>
        )}
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

'use client';

import { useMemo } from 'react';
import { useCollection, useFirebase, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, query, doc } from 'firebase/firestore';
import type { Ticket, UserProfile } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { InboundVolumeChart } from '@/components/analytics/inbound-volume-chart';
import { ResolutionTimeByDivisionChart } from '@/components/analytics/resolution-time-chart';
import { TopIssueCategoriesChart } from '@/components/analytics/top-issues-chart';
import { BarChart3 } from 'lucide-react';
import { useLanguage } from '@/hooks/use-language';

export default function AnalyticsPage() {
  const { firestore } = useFirebase();
  const { user } = useUser();
  const { t } = useLanguage();

  const userProfileRef = useMemoFirebase(() =>
    user && firestore ? doc(firestore, 'users', user.uid) : null,
    [user, firestore]
  );
  const { data: userProfile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef);

  const ticketsQuery = useMemoFirebase(() => {
    if (!firestore || !user || !userProfile) return null;
    return query(collection(firestore, 'tickets'));
  }, [firestore, user, userProfile]);

  const { data: rawTickets, isLoading: isTicketsLoading } = useCollection<Ticket>(ticketsQuery);

  // STRICT PRIVACY: Managers/Staff only see data for their Category AND Campuses
  const filteredTickets = useMemo(() => {
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

  if (isProfileLoading || isTicketsLoading) {
    return <div className="p-8 space-y-6"><Skeleton className="h-10 w-48" /><Skeleton className="h-96 w-full" /></div>;
  }

  if (filteredTickets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-10">
        <BarChart3 className="h-16 w-16 text-muted-foreground mb-4 opacity-20" />
        <h2 className="text-2xl font-bold text-slate-900">{t('noAnalyticsData')}</h2>
        <p className="text-slate-500 max-w-md mx-auto mt-2">{t('noAnalyticsDataSub')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-10">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 font-headline">{t('analytics')}</h1>
        <p className="text-slate-500">{t('analyticsSub')}</p>
      </div>

      <div className="grid gap-6">
        <InboundVolumeChart tickets={filteredTickets} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ResolutionTimeByDivisionChart tickets={filteredTickets} />
          <TopIssueCategoriesChart tickets={filteredTickets} />
        </div>
      </div>
    </div>
  );
}

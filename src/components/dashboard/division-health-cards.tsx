'use client';

import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import type { Ticket, Division, SLASettings, Department } from '@/lib/types';
import { DEFAULT_SLA_SETTINGS } from '@/lib/types';
import { useCollection, useFirebase, useMemoFirebase, useDoc } from '@/firebase';
import { collection, query, doc, Timestamp } from 'firebase/firestore';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/hooks/use-language';
import { calculateWorkingHoursElapsed } from '@/lib/working-hours-utils';

interface DivisionHealthCardsProps {
  tickets: Ticket[];
  performanceTickets: Ticket[];
}

const toDate = (timestamp: Timestamp | string | undefined): Date | null => {
  if (!timestamp) return null;
  if (timestamp instanceof Timestamp) return timestamp.toDate();
  try {
    const d = new Date(timestamp);
    return isNaN(d.getTime()) ? null : d;
  } catch (e) {
    return null;
  }
};

export function DivisionHealthCards({ tickets, performanceTickets }: DivisionHealthCardsProps) {
  const { firestore } = useFirebase();
  const { t } = useLanguage();
  const now = new Date();

  const divisionsQuery = useMemoFirebase(() => 
    firestore ? query(collection(firestore, 'divisions')) : null, 
    [firestore]
  );
  const { data: divisions, isLoading: isDivisionsLoading } = useCollection<Division>(divisionsQuery);

  const deptsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'departments')) : null), [firestore]);
  const { data: departments } = useCollection<Department>(deptsQuery);

  const slaRef = useMemoFirebase(() => (firestore ? doc(firestore, 'settings', 'sla') : null), [firestore]);
  const { data: savedSLA } = useDoc<SLASettings>(slaRef);
  const slaSettings = savedSLA || DEFAULT_SLA_SETTINGS;

  const divisionStats = useMemo(() => {
    if (!divisions || !tickets || !departments) return [];

    const stats = divisions.map(division => {
      const divisionTickets = tickets.filter(t => t.divisionId === division.id);
      const divisionPerfTickets = performanceTickets.filter(t => t.divisionId === division.id);
      
      const openCount = divisionTickets.filter(t => t.status === 'Open').length;
      const resolvedCount = divisionPerfTickets.filter(t => t.status === 'Resolved').length;
      
      const breachedCount = divisionTickets.filter(t => {
        // SLA requirements: stop at resolution, closure, or response
        const isFinished = ['Resolved', 'Closed'].includes(t.status);
        const finishedAt = isFinished ? toDate(t.resolvedAt || t.closedAt) : null;
        const responded = toDate(t.firstRespondedAt);
        
        // Start from assignedAt
        const start = toDate(t.assignedAt || t.createdAt);
        if (!start || !t.assignedTo) return false;

        const dept = departments.find(d => d.id === t.departmentId);
        const channel = t.channel || 'Email';
        const priority = t.priority || 'Normal';
        const limitHours = slaSettings[channel]?.[priority] || 4;

        const compareTime = finishedAt || responded || now;
        const workingHoursElapsed = calculateWorkingHoursElapsed(start, compareTime, dept?.workingHours);
        return workingHoursElapsed >= limitHours;
      }).length;

      return {
        id: division.id,
        name: division.name,
        color: division.color || '#3b82f6',
        open: openCount,
        breached: breachedCount,
        resolved: resolvedCount
      };
    });

    const knownDivisionIds = new Set(divisions.map(d => d.id));
    const uncategorizedTickets = tickets.filter(t => !t.divisionId || !knownDivisionIds.has(t.divisionId));
    const uncategorizedPerfTickets = performanceTickets.filter(t => !t.divisionId || !knownDivisionIds.has(t.divisionId));

    if (uncategorizedTickets.length > 0) {
      const openCount = uncategorizedTickets.filter(t => t.status === 'Open').length;
      const resolvedCount = uncategorizedPerfTickets.filter(t => t.status === 'Resolved').length;
      
      const breachedCount = uncategorizedTickets.filter(t => {
        const isFinished = ['Resolved', 'Closed'].includes(t.status);
        const finishedAt = isFinished ? toDate(t.resolvedAt || t.closedAt) : null;
        const responded = toDate(t.firstRespondedAt);

        const start = toDate(t.assignedAt || t.createdAt);
        if (!start || !t.assignedTo) return false;

        const dept = departments.find(d => d.id === t.departmentId);
        const channel = t.channel || 'Email';
        const priority = t.priority || 'Normal';
        const limitHours = slaSettings[channel]?.[priority] || 4;

        const compareTime = finishedAt || responded || now;
        const workingHoursElapsed = calculateWorkingHoursElapsed(start, compareTime, dept?.workingHours);
        return workingHoursElapsed >= limitHours;
      }).length;

      stats.push({
        id: 'uncategorized',
        name: t('General / Global'),
        color: '#94a3b8',
        open: openCount,
        breached: breachedCount,
        resolved: resolvedCount
      });
    }

    return stats;
  }, [divisions, tickets, performanceTickets, slaSettings, now, t, departments]);

  if (isDivisionsLoading) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-slate-800 uppercase tracking-tight px-1 text-start">{t('divisionHealth')}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {divisionStats.map((stat) => (
          <Card key={stat.id} className={cn(
            "border-none shadow-sm bg-white overflow-hidden hover:shadow-md transition-shadow",
            stat.id === 'uncategorized' && "bg-slate-50/50 border border-dashed border-slate-200 shadow-none"
          )}>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4 text-start">
                <div 
                  className="w-2 h-2 rounded-full" 
                  style={{ backgroundColor: stat.color }}
                />
                <span className="text-[13px] font-bold text-slate-700 truncate">{stat.name}</span>
              </div>
              
              <div className="flex items-end justify-between">
                <div className="flex gap-6">
                  <div className="space-y-0.5 text-start">
                    <p className="text-2xl font-black text-slate-900 leading-none">{stat.open}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">{t('open')}</p>
                  </div>
                  <div className="space-y-0.5 text-start">
                    <p className={cn("text-2xl font-black leading-none", stat.breached > 0 ? "text-red-600" : "text-slate-300")}>
                      {stat.breached}
                    </p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">{t('breached')}</p>
                  </div>
                </div>
                
                <div className="text-end space-y-0.5">
                  <p className="text-2xl font-black text-emerald-500 leading-none">{stat.resolved}</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">{t('resolved')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

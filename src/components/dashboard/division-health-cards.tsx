'use client';

import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import type { Ticket, Division, SLASettings, Department, TicketChannel } from '@/lib/types';
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

const toDate = (value: Timestamp | string | Date | undefined): Date | null => {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const timestampLike = value as unknown as { toDate?: () => Date; seconds?: number };
  if (typeof timestampLike.toDate === 'function') return timestampLike.toDate();
  if (typeof timestampLike.seconds === 'number') return new Date(timestampLike.seconds * 1000);
  const parsed = new Date(value as string);
  return isNaN(parsed.getTime()) ? null : parsed;
};

const isExcludedFromSLA = (ticket: Ticket): boolean =>
  ticket.status === 'Duplicate' || ticket.status === 'Ignored';

const getSLAChannel = (channel: string | undefined): TicketChannel => {
  const lower = (channel || 'Email').toLowerCase();
  if (lower.includes('social')) return 'Social Media';
  if (lower.includes('walk')) return 'Walk-in';
  if (lower === 'website' || lower === 'api' || lower === 'web') return 'Web';
  if (lower === 'whatsapp') return 'WhatsApp';
  if (lower === 'form') return 'Form';
  if (lower === 'phone') return 'Phone';
  return 'Email';
};

export function DivisionHealthCards({ tickets, performanceTickets }: DivisionHealthCardsProps) {
  const { firestore } = useFirebase();
  const { t } = useLanguage();
  const now = new Date();

  const divisionsQuery = useMemoFirebase(
    () => (firestore ? query(collection(firestore, 'divisions')) : null),
    [firestore]
  );
  const { data: divisions, isLoading: isDivisionsLoading } = useCollection<Division>(divisionsQuery);

  const deptsQuery = useMemoFirebase(
    () => (firestore ? query(collection(firestore, 'departments')) : null),
    [firestore]
  );
  const { data: departments } = useCollection<Department>(deptsQuery);

  const slaRef = useMemoFirebase(
    () => (firestore ? doc(firestore, 'settings', 'sla') : null),
    [firestore]
  );
  const { data: savedSLA } = useDoc<SLASettings>(slaRef);
  const slaSettings = savedSLA || DEFAULT_SLA_SETTINGS;

  const divisionStats = useMemo(() => {
    if (!divisions || !tickets || !departments) return [];

    const isBreached = (ticket: Ticket): boolean => {
      // Excluded tickets must never count as compliant, at-risk, or breached.
      if (isExcludedFromSLA(ticket)) return false;

      const start = toDate(ticket.assignedAt || ticket.createdAt);
      if (!start || !ticket.assignedTo) return false;

      const isFinished = ticket.status === 'Resolved' || ticket.status === 'Closed';
      const finishedAt = isFinished ? toDate(ticket.resolvedAt || ticket.closedAt) : null;
      const responded = toDate(ticket.firstRespondedAt);
      const compareTime = finishedAt || responded || now;
      const dept = departments.find(d => d.id === ticket.departmentId);
      const channel = getSLAChannel(ticket.channel);
      const priority = ticket.priority || 'Normal';
      const limitHours = (slaSettings[channel] || slaSettings.Email)?.[priority] || 24;
      const workingHoursElapsed = calculateWorkingHoursElapsed(start, compareTime, dept?.workingHours);
      return workingHoursElapsed >= limitHours;
    };

    const summarize = (divisionTickets: Ticket[], divisionPerfTickets: Ticket[]) => ({
      open: divisionTickets.filter(ticket => ticket.status === 'Open').length,
      breached: divisionTickets.filter(isBreached).length,
      resolved: divisionPerfTickets.filter(ticket => ticket.status === 'Resolved' || ticket.status === 'Closed').length,
    });

    const stats = divisions.map(division => {
      const divisionTickets = tickets.filter(ticket => ticket.divisionId === division.id);
      const divisionPerfTickets = performanceTickets.filter(ticket => ticket.divisionId === division.id);
      return {
        id: division.id,
        name: division.name,
        color: division.color || '#3b82f6',
        ...summarize(divisionTickets, divisionPerfTickets),
      };
    });

    const knownDivisionIds = new Set(divisions.map(division => division.id));
    const uncategorizedTickets = tickets.filter(ticket => !ticket.divisionId || !knownDivisionIds.has(ticket.divisionId));
    const uncategorizedPerfTickets = performanceTickets.filter(ticket => !ticket.divisionId || !knownDivisionIds.has(ticket.divisionId));

    if (uncategorizedTickets.length > 0) {
      stats.push({
        id: 'uncategorized',
        name: t('General / Global'),
        color: '#94a3b8',
        ...summarize(uncategorizedTickets, uncategorizedPerfTickets),
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
        {divisionStats.map(stat => (
          <Card
            key={stat.id}
            className={cn(
              'border-none shadow-sm bg-white overflow-hidden hover:shadow-md transition-shadow',
              stat.id === 'uncategorized' && 'bg-slate-50/50 border border-dashed border-slate-200 shadow-none'
            )}
          >
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4 text-start">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: stat.color }} />
                <span className="text-[13px] font-bold text-slate-700 truncate">{stat.name}</span>
              </div>
              <div className="flex items-end justify-between">
                <div className="flex gap-6">
                  <div className="space-y-0.5 text-start">
                    <p className="text-2xl font-black text-slate-900 leading-none">{stat.open}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">{t('open')}</p>
                  </div>
                  <div className="space-y-0.5 text-start">
                    <p className={cn('text-2xl font-black leading-none', stat.breached > 0 ? 'text-red-600' : 'text-slate-300')}>
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

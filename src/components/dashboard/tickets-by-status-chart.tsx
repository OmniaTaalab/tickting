'use client';

import { useMemo } from 'react';
import { Pie, PieChart, Cell } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import type { Ticket, TicketStatus } from '@/lib/types';
import { useLanguage } from '@/hooks/use-language';

interface ChartProps {
  tickets: Ticket[];
}

// Order of statuses for display consistency in legend and chart
const STATUS_ORDER: TicketStatus[] = ['Open', 'Queue', 'Waiting', 'In Progress', 'Resolved', 'Closed', 'Duplicate'];

export function TicketsByStatusChart({ tickets }: ChartProps) {
  const { t } = useLanguage();
  const statusCounts = useMemo(
    () =>
      tickets.reduce((acc, ticket) => {
        const status = ticket.status;
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    [tickets]
  );

  const totalTickets = useMemo(() => tickets.length, [tickets]);

  const chartData = useMemo(
    () =>
      STATUS_ORDER.map(status => ({
        name: status,
        total: statusCounts[status] || 0,
      })).filter(item => item.total > 0),
    [statusCounts]
  );

  const chartConfig = {
      open: { label: t('open'), color: '#3B82F6' },
      queue: { label: t('queue'), color: '#8b5cf6' },
      waiting: { label: t('waiting'), color: '#6366f1' },
      inprogress: { label: t('inProgress'), color: '#f59e0b' },
      resolved: { label: t('resolved'), color: '#10b981' },
      closed: { label: t('closed'), color: '#ef4444' },
      duplicate: { label: t('duplicate'), color: '#94a3b8' },
    };
    

  return (
    <div className="grid h-full grid-cols-2 items-center gap-4">
      <div className="relative flex h-full items-center justify-center">
        <ChartContainer
          config={chartConfig as any}
          className="mx-auto aspect-square h-full w-full"
        >
          <PieChart>
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel nameKey="name" />}
            />
            <Pie
              data={chartData}
              dataKey="total"
              nameKey="name"
              innerRadius={50}
              strokeWidth={2}
            >
              {chartData.map(entry => {
                const key = entry.name.toLowerCase().replace(/ /g, '') as keyof typeof chartConfig;
                return (
                    <Cell
                        key={entry.name}
                        fill={chartConfig[key]?.color || '#cbd5e1'}
                    />
                )
              })}
            </Pie>
          </PieChart>
        </ChartContainer>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transform text-center">
          <p className="text-[10px] text-muted-foreground uppercase font-bold">{t('total')}</p>
          <p className="text-xl font-black text-slate-900">{totalTickets}</p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 text-[11px] text-start">
        {chartData.map(item => {
           const key = item.name.toLowerCase().replace(/ /g, '') as keyof typeof chartConfig;
           return (
            <div key={item.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: chartConfig[key]?.color || '#cbd5e1' }}
                />
                <span className="text-slate-600 font-medium">{t(item.name)}</span>
                </div>
                <span className="font-bold text-slate-900">{item.total}</span>
            </div>
           )
        })}
      </div>
    </div>
  );
}

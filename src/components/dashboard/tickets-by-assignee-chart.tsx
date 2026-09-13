'use client';

import { Pie, PieChart, Cell } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import type { Ticket } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLanguage } from '@/hooks/use-language';
import { useMemo } from 'react';

interface ChartProps {
  tickets: Ticket[];
}

const COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--muted))',
];

export function TicketsByAssigneeChart({ tickets }: ChartProps) {
  const { t } = useLanguage();

  const chartData = useMemo(() => {
    const assigneeCounts = tickets.reduce((acc, ticket) => {
      const assigneeName = ticket.assignedTo?.name || t('unassigned');
      acc[assigneeName] = (acc[assigneeName] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(assigneeCounts)
      .map(([name, total]) => ({
        name,
        total,
      }))
      .sort((a, b) => b.total - a.total);
  }, [tickets, t]);

  const chartConfig = useMemo(() => {
    return chartData.reduce((acc, item, index) => {
      acc[item.name.toLowerCase().replace(/\s+/g, '')] = {
        label: item.name,
        color: COLORS[index % COLORS.length],
      };
      return acc;
    }, {} as any);
  }, [chartData]);


  return (
    <Card className="border-none shadow-sm overflow-hidden bg-white">
      <CardHeader className="p-4 pb-0 text-start">
        <CardTitle className="text-sm font-bold text-slate-800">{t('ticketsByAssignee')}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        <div className="flex flex-col gap-2">
          <ChartContainer config={chartConfig} className="h-[120px] w-full aspect-square">
            <PieChart>
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
              <Pie
                data={chartData}
                dataKey="total"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={45}
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
          <div className="flex flex-col space-y-1">
            {chartData.slice(0, 3).map((item, index) => (
              <div key={item.name} className="flex items-center justify-between text-[10px] text-start">
                <div className="flex items-center gap-1.5 truncate">
                  <div
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  ></div>
                  <span className="text-slate-500 font-medium truncate">{item.name}</span>
                </div>
                <span className="font-black text-slate-900">{item.total}</span>
              </div>
            ))}
             {chartData.length > 3 && (
                <p className="text-[9px] text-slate-400 text-center italic mt-1">+{chartData.length - 3} {t('of')} {t('total')}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

'use client';

import { Bar, BarChart, XAxis, YAxis, CartesianGrid } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import type { Ticket } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useMemo } from 'react';
import { useLanguage } from '@/hooks/use-language';

interface ChartProps {
  tickets: Ticket[];
}

export function TicketsByDivisionChart({ tickets }: ChartProps) {
  const { t } = useLanguage();

  const chartConfig = {
    open: { label: t('open'), color: '#1e3a8a' },
    resolved: { label: t('resolved'), color: '#10b981' },
  };

  const chartData = useMemo(() => {
    const divMap: Record<string, any> = {};

    tickets.forEach((ticket) => {
      const div = ticket.divisionName || t('General / Global');
      const status = ticket.status;

      if (!divMap[div]) {
        divMap[div] = {
          division: div,
          Open: 0,
          Resolved: 0,
        };
      }
      
      // Grouping statuses for the chart
      if (status === 'Open' || status === 'In Progress' || status === 'Queue' || status === 'Waiting') {
          divMap[div].Open = (divMap[div].Open || 0) + 1;
      } else if (status === 'Resolved' || status === 'Closed') {
          divMap[div].Resolved = (divMap[div].Resolved || 0) + 1;
      }
    });

    return Object.values(divMap).sort((a: any, b: any) => {
        const totalA = (a.Open || 0) + (a.Resolved || 0);
        const totalB = (b.Open || 0) + (b.Resolved || 0);
        return totalB - totalA;
    });
  }, [tickets, t]);

  if (chartData.length === 0) return null;

  return (
    <Card className="col-span-full border-none shadow-sm bg-card">
      <CardHeader className="pb-2">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
                <CardTitle className="text-lg font-bold">{t('divisionStatus')}</CardTitle>
                <CardDescription className="text-[11px]">{t('divisionStatusSub')}</CardDescription>
            </div>
            <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-wider">
                <div className="flex items-center gap-1.5">
                    <div className="h-2.5 w-2.5 rounded-sm bg-[#1e3a8a]" />
                    <span className="text-muted-foreground">{t('open')}</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="h-2.5 w-2.5 rounded-sm bg-[#10b981]" />
                    <span className="text-muted-foreground">{t('resolved')}</span>
                </div>
            </div>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <ChartContainer config={chartConfig as any} className="h-[300px] w-full">
          <BarChart
            data={chartData}
            margin={{ top: 5, right: 30, left: -20, bottom: 60 }}
            barGap={8}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.1} />
            <XAxis
              dataKey="division"
              axisLine={false}
              tickLine={false}
              tickMargin={10}
              fontSize={10}
              fontWeight={500}
              interval={0}
              angle={-35}
              textAnchor="end"
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              fontSize={10} 
              allowDecimals={false}
              tickMargin={8}
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
            />
            <ChartTooltip cursor={{ fill: 'rgba(0,0,0,0.03)' }} content={<ChartTooltipContent />} />
            <Bar 
                dataKey="Open" 
                fill={chartConfig.open.color} 
                radius={[2, 2, 0, 0]} 
                barSize={20}
                animationDuration={1500}
            />
            <Bar 
                dataKey="Resolved" 
                fill={chartConfig.resolved.color} 
                radius={[2, 2, 0, 0]} 
                barSize={20}
                animationDuration={1500}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

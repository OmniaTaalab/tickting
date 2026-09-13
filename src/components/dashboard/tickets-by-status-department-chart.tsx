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

export function TicketsByStatusDepartmentChart({ tickets }: ChartProps) {
  const { t } = useLanguage();

  const chartConfig = {
    active: { label: t('activeWorkload'), color: '#1e3a8a' }, // Work in progress
    resolved: { label: t('resolved'), color: '#10b981' }, // Resolved
    closed: { label: t('closed'), color: '#ef4444' }, // Closed
  };

  const chartData = useMemo(() => {
    const deptMap: Record<string, any> = {};

    tickets.forEach((ticket) => {
      const dept = ticket.departmentName || t('Other');
      const status = ticket.status;

      if (!deptMap[dept]) {
        deptMap[dept] = {
          department: dept,
          Active: 0,
          Resolved: 0,
          Closed: 0,
        };
      }
      
      const isActive = ['Open', 'In Progress', 'Queue', 'Waiting'].includes(status);

      if (isActive) {
          deptMap[dept].Active = (deptMap[dept].Active || 0) + 1;
      } else if (status === 'Resolved') {
          deptMap[dept].Resolved = (deptMap[dept].Resolved || 0) + 1;
      } else if (status === 'Closed') {
          deptMap[dept].Closed = (deptMap[dept].Closed || 0) + 1;
      }
    });

    return Object.values(deptMap).sort((a: any, b: any) => {
        const totalA = (a.Active || 0) + (a.Resolved || 0) + (a.Closed || 0);
        const totalB = (b.Active || 0) + (b.Resolved || 0) + (b.Closed || 0);
        return totalB - totalA;
    });
  }, [tickets, t]);

  if (chartData.length === 0) return null;

  return (
    <Card className="col-span-full border-none shadow-sm bg-card">
      <CardHeader className="pb-2">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="text-start">
                <CardTitle className="text-lg font-bold">{t('categoryStatus')}</CardTitle>
                <CardDescription className="text-[11px]">{t('categoryStatusSub')}</CardDescription>
            </div>
            <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-wider">
                <div className="flex items-center gap-1.5">
                    <div className="h-2.5 w-2.5 rounded-sm bg-[#1e3a8a]" />
                    <span className="text-muted-foreground">{t('activeWorkload')}</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="h-2.5 w-2.5 rounded-sm bg-[#10b981]" />
                    <span className="text-muted-foreground">{t('resolved')}</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="h-2.5 w-2.5 rounded-sm bg-[#ef4444]" />
                    <span className="text-muted-foreground">{t('closed')}</span>
                </div>
            </div>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <ChartContainer config={chartConfig as any} className="h-[300px] w-full">
          <BarChart
            data={chartData}
            margin={{ top: 5, right: 30, left: -20, bottom: 60 }}
            barGap={4}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.1} />
            <XAxis
              dataKey="department"
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
                dataKey="Active" 
                fill={chartConfig.active.color} 
                radius={[2, 2, 0, 0]} 
                barSize={18}
                animationDuration={1500}
            />
            <Bar 
                dataKey="Resolved" 
                fill={chartConfig.resolved.color} 
                radius={[2, 2, 0, 0]} 
                barSize={18}
                animationDuration={1500}
            />
            <Bar 
                dataKey="Closed" 
                fill={chartConfig.closed.color} 
                radius={[2, 2, 0, 0]} 
                barSize={18}
                animationDuration={1500}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

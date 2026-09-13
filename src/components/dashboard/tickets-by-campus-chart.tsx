'use client';

import { Bar, BarChart, XAxis, YAxis, CartesianGrid } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import type { Ticket, Campus } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useMemo } from 'react';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy } from 'firebase/firestore';
import { useLanguage } from '@/hooks/use-language';

interface ChartProps {
  tickets: Ticket[];
}

export function TicketsByCampusChart({ tickets }: ChartProps) {
  const { firestore } = useFirebase();
  const { t } = useLanguage();

  const chartConfig = {
    open: { label: t('open'), color: '#1e3a8a' },
    resolved: { label: t('resolved'), color: '#10b981' },
  };

  const campusesQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'campuses'), orderBy('name', 'asc'));
  }, [firestore]);

  const { data: allCampuses, isLoading } = useCollection<Campus>(campusesQuery);

  const chartData = useMemo(() => {
    if (!allCampuses) return [];

    const campusMap: Record<string, any> = {};

    allCampuses.forEach(c => {
        campusMap[c.id] = {
            campus: c.name,
            Open: 0,
            Resolved: 0,
            total: 0
        };
    });

    const fallbackId = 'unassigned-campus';
    campusMap[fallbackId] = {
        campus: t('General / Global'),
        Open: 0,
        Resolved: 0,
        total: 0
    };

    tickets.forEach((ticket) => {
      const campusId = ticket.campusId || fallbackId;
      const status = ticket.status;

      if (!campusMap[campusId]) {
          campusMap[campusId] = {
              campus: ticket.campusName || 'Unknown',
              Open: 0,
              Resolved: 0,
              total: 0
          };
      }
      
      if (status === 'Open' || status === 'In Progress' || status === 'Queue' || status === 'Waiting') {
          campusMap[campusId].Open += 1;
      } else if (status === 'Resolved' || status === 'Closed') {
          campusMap[campusId].Resolved += 1;
      }
      campusMap[campusId].total += 1;
    });

    const result = Object.values(campusMap);
    if (campusMap[fallbackId].total === 0) {
        return result.filter(item => item.campus !== t('General / Global'));
    }

    return result.sort((a: any, b: any) => b.total - a.total);
  }, [tickets, allCampuses, t]);

  if (isLoading) return <div className="h-[300px] flex items-center justify-center text-slate-400">Loading campus data...</div>;
  if (chartData.length === 0) return null;

  return (
    <Card className="col-span-full border-none shadow-sm bg-card">
      <CardHeader className="pb-2">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
                <CardTitle className="text-lg font-bold">{t('campusVolume')}</CardTitle>
                <CardDescription className="text-[11px]">{t('campusVolumeSub')}</CardDescription>
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
            margin={{ top: 10, right: 30, left: -20, bottom: 80 }}
            barGap={8}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.1} />
            <XAxis
              dataKey="campus"
              axisLine={false}
              tickLine={false}
              tickMargin={15}
              fontSize={10}
              fontWeight={600}
              interval={0}
              angle={-40}
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

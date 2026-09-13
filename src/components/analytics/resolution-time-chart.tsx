
'use client';

import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  LabelList,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import type { Ticket, Department } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Timestamp, collection, query } from 'firebase/firestore';
import { useLanguage } from '@/hooks/use-language';
import { BarChart3, Loader2 } from 'lucide-react';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { calculateWorkingHoursElapsed } from '@/lib/working-hours-utils';

interface ChartProps {
  tickets: Ticket[];
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

export function ResolutionTimeByDivisionChart({ tickets }: ChartProps) {
  const { firestore } = useFirebase();
  const { t, language } = useLanguage();
  const isRTL = language === 'ar';

  const deptsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'departments')) : null), [firestore]);
  const { data: departments, isLoading: areDeptsLoading } = useCollection<Department>(deptsQuery);

  const chartConfig = {
    hours: {
      label: t('avgResponse'),
      color: '#1e3a8a',
    },
  };

  const chartData = useMemo(() => {
    if (!departments) return [];
    const divisionStats: Record<string, { totalHours: number; count: number }> = {};

    tickets.forEach(t => {
      if ((t.status === 'Resolved' || t.status === 'Closed') && t.resolvedAt) {
        const created = toDate(t.createdAt);
        const resolved = toDate(t.resolvedAt);
        const division = t.divisionName || 'General';

        if (created && resolved) {
          const dept = departments.find(d => d.id === t.departmentId);
          // USE WORKING HOURS ELAPSED INSTEAD OF WALL CLOCK
          const hours = calculateWorkingHoursElapsed(created, resolved, dept?.workingHours);
          
          if (!divisionStats[division]) {
            divisionStats[division] = { totalHours: 0, count: 0 };
          }
          divisionStats[division].totalHours += hours;
          divisionStats[division].count += 1;
        }
      }
    });

    return Object.entries(divisionStats)
      .map(([division, stats]) => ({
        division: division,
        hours: Math.round(stats.totalHours / stats.count),
      }))
      .sort((a, b) => b.hours - a.hours);
  }, [tickets, departments]);

  if (areDeptsLoading) {
      return (
          <Card className="border-none shadow-sm bg-white h-full flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
          </Card>
      );
  }

  return (
    <Card className="border-none shadow-sm bg-white overflow-hidden h-full flex flex-col">
      <CardHeader className="p-5 pb-0 text-start">
        <CardTitle className="text-base font-bold text-slate-800">{t('avgResolutionTimeTitle')}</CardTitle>
        <CardDescription className="text-[11px] text-slate-500 italic">{t('byDivisionHours')}</CardDescription>
      </CardHeader>
      <CardContent className="p-5 flex-1 flex flex-col justify-center min-h-[300px]">
        {chartData.length > 0 ? (
            <ChartContainer config={chartConfig} className="h-[300px] w-full">
            <BarChart
                data={chartData}
                layout="vertical"
                margin={{ 
                    top: 5, 
                    right: isRTL ? 40 : 40, 
                    left: isRTL ? 40 : 40, 
                    bottom: 5 
                }}
                barSize={12}
            >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.05} />
                <XAxis type="number" hide />
                <YAxis
                dataKey="division"
                type="category"
                axisLine={false}
                tickLine={false}
                fontSize={10}
                width={80}
                orientation={isRTL ? "right" : "left"}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontWeight: 600 }}
                />
                <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                <Bar dataKey="hours" fill={chartConfig.hours.color} radius={[2, 2, 2, 2]}>
                    <LabelList 
                        dataKey="hours" 
                        position={isRTL ? "left" : "right"} 
                        offset={10}
                        formatter={(val: number) => `${val}h`}
                        className="fill-slate-500 font-bold text-[10px]"
                    />
                </Bar>
            </BarChart>
            </ChartContainer>
        ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
                <BarChart3 className="h-10 w-10 text-slate-200 mb-2" />
                <p className="text-sm font-bold text-slate-400 max-w-[200px]">{t('noResolvedTickets')}</p>
            </div>
        )}
      </CardContent>
    </Card>
  );
}

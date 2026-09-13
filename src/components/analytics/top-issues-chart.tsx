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
import type { Ticket } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useLanguage } from '@/hooks/use-language';
import { BarChart3 } from 'lucide-react';

interface ChartProps {
  tickets: Ticket[];
}

export function TopIssueCategoriesChart({ tickets }: ChartProps) {
  const { t, language } = useLanguage();
  const isRTL = language === 'ar';

  const chartConfig = {
    count: {
      label: t('tickets'),
      color: '#1e3a8a',
    },
  };

  const chartData = useMemo(() => {
    const counts: Record<string, number> = {};
    
    tickets.forEach(t => {
      const cat = t.departmentName || 'General';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    
    return Object.entries(counts)
      .map(([name, count]) => ({
        name,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [tickets]);

  return (
    <Card className="border-none shadow-sm bg-white overflow-hidden h-full flex flex-col">
      <CardHeader className="p-5 pb-0 text-start">
        <CardTitle className="text-base font-bold text-slate-800">{t('topIssueCategoriesTitle')}</CardTitle>
        <CardDescription className="text-[11px] text-slate-500 italic">{t('byVolumeTickets')}</CardDescription>
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
                 dataKey="name"
                 type="category"
                 axisLine={false}
                 tickLine={false}
                 fontSize={10}
                 width={80}
                 orientation={isRTL ? "right" : "left"}
                 tick={{ fill: 'hsl(var(--muted-foreground))', fontWeight: 600 }}
               />
               <ChartTooltip content={<ChartTooltipContent hideLabel />} />
               <Bar dataKey="count" fill={chartConfig.count.color} radius={[2, 2, 2, 2]}>
                   <LabelList 
                       dataKey="count" 
                       position={isRTL ? "left" : "right"} 
                       offset={10}
                       className="fill-slate-800 font-black text-[11px]"
                   />
               </Bar>
             </BarChart>
           </ChartContainer>
        ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
                <BarChart3 className="h-10 w-10 text-slate-200 mb-2" />
                <p className="text-sm font-bold text-slate-400 max-w-[200px]">{t('noIssuesRecorded')}</p>
            </div>
        )}
      </CardContent>
    </Card>
  );
}

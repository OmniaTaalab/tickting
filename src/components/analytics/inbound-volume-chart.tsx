'use client';

import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from '@/components/ui/chart';
import type { Ticket } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { subDays, startOfDay, isSameDay, format } from 'date-fns';
import { Timestamp } from 'firebase/firestore';
import { useLanguage } from '@/hooks/use-language';

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

// Custom tick component to render day code and date underneath
function CustomXAxisTick(props: any) {
  const { x, y, payload, index, data } = props;
  const item = data[index];
  if (!item) return null;

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={14}
        textAnchor="middle"
        fill="hsl(var(--muted-foreground))"
        className="font-bold text-[10px]"
      >
        {payload.value}
      </text>
      <text
        x={0}
        y={0}
        dy={26}
        textAnchor="middle"
        fill="hsl(var(--muted-foreground))"
        className="font-medium text-[9px] opacity-60"
      >
        {item.fullDate}
      </text>
    </g>
  );
}

export function InboundVolumeChart({ tickets }: ChartProps) {
  const { t } = useLanguage();

  const chartConfig = {
    Email: { label: t('Email'), color: '#3b82f6' },
    Phone: { label: t('Phone'), color: '#10b981' },
    'Walk-in': { label: t('Walk-in'), color: '#a855f7' },
    'Social Media': { label: t('Social Media'), color: '#0ea5e9' },
  };

  const chartData = useMemo(() => {
    const data = [];
    const now = new Date();

    for (let i = 13; i >= 0; i--) {
      const day = startOfDay(subDays(now, i));
      const dayTickets = tickets.filter(t => {
        const created = toDate(t.createdAt);
        return created && isSameDay(created, day);
      });

      data.push({
        day: `D${14 - i}`,
        fullDate: format(day, 'MMM d'),
        Email: dayTickets.filter(t => t.channel === 'Email').length,
        Phone: dayTickets.filter(t => t.channel === 'Phone').length,
        'Walk-in': dayTickets.filter(t => t.channel === 'Walk-in').length,
        'Social Media': dayTickets.filter(t => t.channel === 'Social Media').length,
      });
    }
    return data;
  }, [tickets]);

  return (
    <Card className="border-none shadow-sm bg-white overflow-hidden">
      <CardHeader className="pb-0">
        <CardTitle className="text-base font-bold text-slate-800">{t('inboundVolumeTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <ChartContainer config={chartConfig} className="h-[380px] w-full">
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 10, left: -20, bottom: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.1} />
            <XAxis
              dataKey="day"
              axisLine={false}
              tickLine={false}
              height={50}
              interval={0}
              tick={<CustomXAxisTick data={chartData} />}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              fontSize={10}
              tickMargin={10}
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Area
              type="monotone"
              dataKey="Email"
              stackId="1"
              stroke={chartConfig.Email.color}
              fill={chartConfig.Email.color}
              fillOpacity={0.6}
            />
            <Area
              type="monotone"
              dataKey="Phone"
              stackId="1"
              stroke={chartConfig.Phone.color}
              fill={chartConfig.Phone.color}
              fillOpacity={0.6}
            />
             <Area
              type="monotone"
              dataKey="Walk-in"
              stackId="1"
              stroke={chartConfig['Walk-in'].color}
              fill={chartConfig['Walk-in'].color}
              fillOpacity={0.6}
            />
            <Area
              type="monotone"
              dataKey="Social Media"
              stackId="1"
              stroke={chartConfig['Social Media'].color}
              fill={chartConfig['Social Media'].color}
              fillOpacity={0.6}
            />
            <ChartLegend content={<ChartLegendContent />} />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

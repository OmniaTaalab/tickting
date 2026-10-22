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
} from '@/components/ui/chart';
import type { Ticket, SLASettings, Department, TicketChannel } from '@/lib/types';
import { DEFAULT_SLA_SETTINGS } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { subDays, startOfDay, isSameDay, format, endOfDay, eachDayOfInterval } from 'date-fns';
import { Timestamp, doc, collection, query } from 'firebase/firestore';
import { useDoc, useFirebase, useMemoFirebase, useCollection } from '@/firebase';
import type { DateRange } from 'react-day-picker';
import { useLanguage } from '@/hooks/use-language';
import { calculateWorkingHoursElapsed } from '@/lib/working-hours-utils';

interface ChartProps {
  tickets: Ticket[];
  dateRange?: DateRange;
}

const toDate = (timestamp: Timestamp | string | undefined): Date | null => {
  if (!timestamp) return null;
  if (timestamp instanceof Timestamp) return timestamp.toDate();
  try {
    const d = new Date(timestamp);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
};

const isSLAExcluded = (ticket: Ticket): boolean =>
  ticket.status === 'Duplicate' || ticket.status === 'Ignored';

// Use the same channel mapping as the ticket list and dashboard.
const getSLAChannel = (channel: string | undefined): TicketChannel => {
  const value = (channel || 'Email').toLowerCase();
  if (value.includes('social')) return 'Social Media';
  if (value.includes('walk')) return 'Walk-in';
  if (value === 'website' || value === 'api' || value === 'web') return 'Web';
  if (value === 'whatsapp') return 'WhatsApp';
  if (value === 'form') return 'Form';
  if (value === 'phone') return 'Phone';
  return 'Email';
};

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

export function SLAComplianceTrendChart({ tickets, dateRange }: ChartProps) {
  const { firestore } = useFirebase();
  const { t } = useLanguage();

  const slaRef = useMemoFirebase(() => (firestore ? doc(firestore, 'settings', 'sla') : null), [firestore]);
  const { data: savedSLA } = useDoc<SLASettings>(slaRef);
  const slaSettings = savedSLA || DEFAULT_SLA_SETTINGS;

  const deptsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'departments')) : null), [firestore]);
  const { data: departments } = useCollection<Department>(deptsQuery);

  const chartConfig = {
    compliance: {
      label: t('slaCompliance'),
      color: '#1e3a8a',
    },
  };

  const chartData = useMemo(() => {
    if (!departments) return [];

    const data: Array<{ day: string; fullDate: string; compliance: number | null }> = [];
    const now = new Date();

    let startRange: Date;
    let endRange: Date;

    if (dateRange?.from) {
      startRange = startOfDay(dateRange.from);
      endRange = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
    } else {
      startRange = startOfDay(subDays(now, 13));
      endRange = endOfDay(now);
    }

    const intervalDays = eachDayOfInterval({ start: startRange, end: endRange });

    intervalDays.forEach((day) => {
      // Tickets remain present in the other dashboard charts, but not in SLA calculations.
      const eligibleDayTickets = tickets.filter(ticket => {
        const created = toDate(ticket.createdAt);
        return Boolean(
          created &&
          isSameDay(created, day) &&
          ticket.assignedTo &&
          !isSLAExcluded(ticket) &&
          toDate(ticket.assignedAt || ticket.createdAt)
        );
      });

      if (eligibleDayTickets.length === 0) {
        // No eligible tickets is "no data", not 100% compliance.
        data.push({
          day: format(day, 'MMM dd'),
          fullDate: format(day, 'EEE'),
          compliance: null,
        });
        return;
      }

      const compliantCount = eligibleDayTickets.filter(ticket => {
        const startPoint = toDate(ticket.assignedAt || ticket.createdAt);
        if (!startPoint) return false;

        const responded = toDate(ticket.firstRespondedAt);
        const isFinished = ticket.status === 'Resolved' || ticket.status === 'Closed';
        const finishedAt = isFinished ? toDate(ticket.resolvedAt || ticket.closedAt) : null;

        const dept = departments.find(d => d.id === ticket.departmentId);
        const channel = getSLAChannel(ticket.channel);
        const priority = ticket.priority || 'Normal';
        const limitHours = (slaSettings[channel] || slaSettings['Email'])?.[priority] || 24;

        const compareTime = finishedAt || responded || now;
        const workingHoursElapsed = calculateWorkingHoursElapsed(startPoint, compareTime, dept?.workingHours);

        return workingHoursElapsed < limitHours;
      }).length;

      data.push({
        day: format(day, 'MMM dd'),
        fullDate: format(day, 'EEE'),
        compliance: Math.round((compliantCount / eligibleDayTickets.length) * 100),
      });
    });
    return data;
  }, [tickets, slaSettings, dateRange, departments]);

  return (
    <Card className="col-span-full border-none shadow-sm bg-card">
      <CardHeader className="pb-0">
        <CardTitle className="text-lg font-bold">{t('slaTrend')}</CardTitle>
        <CardDescription className="text-[11px]">
          {t('slaTrendSub')}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <ChartContainer config={chartConfig} className="h-[280px] w-full">
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 10, left: -20, bottom: 20 }}
          >
            <defs>
              <linearGradient id="colorCompliance" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#1e3a8a" stopOpacity={0.1} />
                <stop offset="95%" stopColor="#1e3a8a" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.1} />
            <XAxis
              dataKey="day"
              axisLine={false}
              tickLine={false}
              height={50}
              interval="preserveStartEnd"
              tick={<CustomXAxisTick data={chartData} />}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              fontSize={10}
              tickMargin={10}
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
            />
            <ChartTooltip
              cursor={{ stroke: '#1e3a8a', strokeWidth: 1, strokeDasharray: '4 4' }}
              content={<ChartTooltipContent />}
            />
            <Area
              type="monotone"
              dataKey="compliance"
              stroke="#1e3a8a"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorCompliance)"
              animationDuration={1500}
              connectNulls={false}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

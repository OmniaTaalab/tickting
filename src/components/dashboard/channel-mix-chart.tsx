
'use client';

import { useMemo } from 'react';
import { Pie, PieChart, Cell } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import type { Ticket, TicketChannel } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useLanguage } from '@/hooks/use-language';

interface ChartProps {
  tickets: Ticket[];
}

const DEFAULT_CHANNELS: TicketChannel[] = ['Email', 'Phone', 'Walk-in', 'Social Media', 'Web', 'Form'];

export function ChannelMixChart({ tickets }: ChartProps) {
  const { t } = useLanguage();

  const chartConfig: Record<string, { label: string; color: string }> = useMemo(() => ({
    Email: { label: t('Email'), color: '#3b82f6' },
    Phone: { label: t('Phone'), color: '#10b981' },
    'Walk-in': { label: t('Walk-in'), color: '#a855f7' },
    'Social Media': { label: t('Social Media'), color: '#0ea5e9' },
    Web: { label: t('Web'), color: '#f59e0b' },
    Form: { label: t('Form'), color: '#4f46e5' },
    Other: { label: t('Other'), color: '#94a3b8' },
  }), [t]);

  const channelCounts = useMemo(() => {
    // Normalize mapping for aggregation
    const normalizeMap: Record<string, string> = {
        'email': 'Email',
        'phone': 'Phone',
        'walk-in': 'Walk-in',
        'social media': 'Social Media',
        'web': 'Web',
        'form': 'Form'
    };

    const counts = tickets.reduce((acc, ticket) => {
      const rawChannel = ticket.channel || (ticket as any).source || 'Email';
      const channel = normalizeMap[rawChannel.toLowerCase()] || 'Other';
      acc[channel] = (acc[channel] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Dynamic: Include all channels from data + the default ones to ensure they are always visible
    const allFoundChannels = Array.from(new Set([...DEFAULT_CHANNELS, ...Object.keys(counts)]));

    return allFoundChannels.map(name => ({
      name,
      total: counts[name] || 0,
    })).sort((a, b) => b.total - a.total);
  }, [tickets]);

  const totalTickets = useMemo(() => 
    channelCounts.reduce((acc, curr) => acc + curr.total, 0), 
  [channelCounts]);

  return (
    <Card className="border-none shadow-sm overflow-hidden">
      <CardHeader className="p-5 pb-0">
        <CardTitle className="text-base font-bold text-slate-800">{t('channelMix')}</CardTitle>
        <CardDescription className="text-[11px] text-slate-500">{t('channelMixSub')}</CardDescription>
      </CardHeader>
      <CardContent className="p-5 pt-2">
        <div className="flex flex-col items-center">
          <div className="relative w-full aspect-square max-h-[160px]">
            <ChartContainer config={chartConfig as any} className="mx-auto aspect-square h-full w-full">
              <PieChart>
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent hideLabel nameKey="name" />}
                />
                <Pie
                  data={channelCounts}
                  dataKey="total"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={75}
                  strokeWidth={2}
                >
                  {channelCounts.map(entry => (
                    <Cell
                      key={entry.name}
                      fill={chartConfig[entry.name]?.color || chartConfig['Other'].color}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transform text-center">
              <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-tight">{t('total')}</p>
              <p className="text-2xl font-black text-slate-900 leading-none">{totalTickets}</p>
            </div>
          </div>

          <div className="w-full mt-6 space-y-2">
            {channelCounts.filter(c => c.total > 0).map(channel => (
              <div key={channel.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: chartConfig[channel.name]?.color || chartConfig['Other'].color }}
                  />
                  <span className="font-semibold text-slate-600 text-start">{t(channel.name)}</span>
                </div>
                <span className="font-bold text-slate-900">{channel.total}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

'use client';

import React from 'react';
import { useOfficialHolidays } from '@/hooks/use-official-holidays';
import { getCairoDateString } from '@/lib/working-hours-utils';
import { useLanguage } from '@/hooks/use-language';
import { CalendarOff, Clock, Sparkles, AlertCircle, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';

interface HolidayBannerProps {
  isAdmin?: boolean;
}

export function HolidayBanner({ isAdmin = false }: HolidayBannerProps) {
  const { activeHolidays, isLoading } = useOfficialHolidays();
  const { t } = useLanguage();

  const cairoTodayStr = getCairoDateString(new Date());
  const todayHoliday = activeHolidays.find((h) => h.date === cairoTodayStr);

  if (isLoading || !todayHoliday) {
    return null;
  }

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-rose-900 via-rose-800 to-amber-900 p-5 text-white shadow-md border border-rose-700/50 animate-in fade-in-50 duration-500">
      <div className="absolute -right-8 -top-8 h-36 w-36 rounded-full bg-white/5 blur-2xl pointer-events-none" />
      <div className="absolute right-12 bottom-0 opacity-10 text-white pointer-events-none">
        <CalendarOff className="h-28 w-28" />
      </div>

      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 relative z-10">
        <div className="flex items-start gap-3.5">
          <div className="p-2.5 rounded-xl bg-white/10 backdrop-blur-md text-amber-300 shrink-0 border border-white/10 shadow-xs">
            <CalendarOff className="h-6 w-6" />
          </div>
          <div className="space-y-1 text-start">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-amber-400 text-slate-900 font-black text-[11px] uppercase tracking-wider hover:bg-amber-400">
                <Sparkles className="h-3 w-3 me-1 fill-slate-900" />
                {t('officialHolidayToday') || 'Official Holiday Today'}
              </Badge>
              <h3 className="text-lg font-bold text-white tracking-tight">
                {todayHoliday.name}
              </h3>
              <span className="text-xs text-rose-200 font-mono">({todayHoliday.date})</span>
            </div>
            <p className="text-xs text-rose-100 max-w-3xl leading-relaxed">
              {t('holidayActiveNotice')
                ? t('holidayActiveNotice').replace('{{name}}', todayHoliday.name)
                : `Support offices are closed today for ${todayHoliday.name}. SLA countdown timers are paused and new incoming tickets are placed in Queue until the next regular working day.`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/20 text-rose-200 text-xs font-semibold whitespace-nowrap">
            <Clock className="h-3.5 w-3.5 text-amber-300" />
            <span>SLA Paused</span>
          </div>

          {isAdmin && (
            <Link
              href="/settings"
              className="flex items-center gap-1 text-xs font-bold text-white bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
            >
              <span>{t('officialHolidays') || 'Holidays Settings'}</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

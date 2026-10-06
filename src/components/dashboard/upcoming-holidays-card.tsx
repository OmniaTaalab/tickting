'use client';

import React from 'react';
import { useOfficialHolidays } from '@/hooks/use-official-holidays';
import { getCairoDateString } from '@/lib/working-hours-utils';
import { useLanguage } from '@/hooks/use-language';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { CalendarOff, Calendar, ChevronRight, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { format, parseISO, isValid } from 'date-fns';
import Link from 'next/link';

interface UpcomingHolidaysCardProps {
  isAdmin?: boolean;
}

export function UpcomingHolidaysCard({ isAdmin = false }: UpcomingHolidaysCardProps) {
  const { activeHolidays, isLoading } = useOfficialHolidays();
  const { t } = useLanguage();

  const cairoTodayStr = getCairoDateString(new Date());

  // Filter for today or future active holidays, sorted soonest first
  const upcomingHolidays = [...activeHolidays]
    .filter((h) => h.date >= cairoTodayStr)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 4);

  if (isLoading) {
    return null;
  }

  return (
    <Card className="border-none shadow-sm overflow-hidden bg-white">
      <CardHeader className="bg-slate-50/60 border-b px-5 py-4 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <CalendarOff className="h-4 w-4 text-rose-600" />
          {t('upcomingHolidays') || 'Official Holidays'}
        </CardTitle>
        {isAdmin && (
          <Link
            href="/settings"
            className="text-[11px] font-bold text-[#1e3a8a] hover:underline flex items-center gap-0.5"
          >
            <span>{t('manage') || 'Manage'}</span>
            <ChevronRight className="h-3 w-3" />
          </Link>
        )}
      </CardHeader>

      <CardContent className="p-4">
        {upcomingHolidays.length === 0 ? (
          <div className="text-center py-6 px-3 text-slate-400 text-xs">
            <Calendar className="h-6 w-6 mx-auto mb-1.5 opacity-40 text-slate-400" />
            <p>{t('noUpcomingHolidays') || 'No upcoming holidays scheduled.'}</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {upcomingHolidays.map((holiday) => {
              const isToday = holiday.date === cairoTodayStr;
              let formattedDate = holiday.date;
              try {
                const parsed = parseISO(holiday.date);
                if (isValid(parsed)) {
                  formattedDate = format(parsed, 'EEE, MMM d');
                }
              } catch {
                formattedDate = holiday.date;
              }

              return (
                <div
                  key={holiday.id || holiday.date}
                  className={`flex items-center justify-between p-2.5 rounded-xl border text-start transition-all ${
                    isToday
                      ? 'bg-rose-50/60 border-rose-200 text-rose-950'
                      : 'bg-slate-50/50 border-slate-100 hover:bg-slate-50 text-slate-800'
                  }`}
                >
                  <div className="space-y-0.5 min-w-0 flex-1 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                          isToday ? 'bg-rose-600 animate-pulse' : 'bg-slate-400'
                        }`}
                      />
                      <span className="text-xs font-bold truncate">{holiday.name}</span>
                      {isToday && (
                        <Badge className="bg-rose-600 text-white text-[9px] px-1.5 py-0 h-4 uppercase font-black">
                          {t('today') || 'TODAY'}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 font-medium pl-3">
                      {formattedDate}
                    </p>
                  </div>

                  <span className="text-[10px] font-mono text-slate-400 shrink-0">
                    {holiday.date}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

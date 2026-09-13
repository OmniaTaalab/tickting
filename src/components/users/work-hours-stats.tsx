
'use client';

import { useMemo, useState, useEffect } from 'react';
import { useCollection, useFirebase, useMemoFirebase, useDoc } from '@/firebase';
import { collection, query, where, Timestamp, doc } from 'firebase/firestore';
import type { WorkSession, UserProfile, Department, WorkingHours } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
    format, 
    startOfToday, 
    startOfWeek, 
    startOfMonth, 
    isWithinInterval, 
    differenceInMinutes, 
    parse, 
    isAfter, 
    isBefore, 
    subDays,
    eachDayOfInterval,
    eachHourOfInterval,
    startOfDay,
    endOfDay
} from 'date-fns';
import { 
    Clock, 
    Calendar, 
    BarChart3, 
    Activity, 
    UserCheck, 
    History, 
    Info,
    CalendarDays
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface WorkHoursStatsProps {
  userId: string;
  userProfile: UserProfile;
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

const formatMins = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = Math.floor(mins % 60);
    return `${h}h ${m}m`;
};

export function WorkHoursStats({ userId, userProfile }: WorkHoursStatsProps) {
  const { firestore, user } = useFirebase();
  const [now, setNow] = useState(new Date());
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const deptRef = useMemoFirebase(() => 
    userProfile.departmentId && firestore ? doc(firestore, 'departments', userProfile.departmentId) : null,
    [userProfile.departmentId, firestore]
  );
  const { data: department } = useDoc<Department>(deptRef);

  const sessionsQuery = useMemoFirebase(() => {
    if (!firestore || !userId || !user) return null;
    return query(collection(firestore, 'work-sessions'), where('userId', '==', userId));
  }, [firestore, userId, user]);
  const { data: sessions, isLoading } = useCollection<WorkSession>(sessionsQuery);

  // Helper to calculate stats for a specific date
  const calculateDayStats = (date: Date, sessionsList: WorkSession[], deptConfig?: Department) => {
    const dateKey = format(date, 'yyyy-MM-dd');
    const dayName = format(date, 'EEEE');
    const daySessions = sessionsList.filter(s => s.dateKey === dateKey);
    
    let totalBusyMins = 0;
    let busyInsideWorkdayMins = 0;
    let workdayDurationMins = 0;

    const config = deptConfig?.workingHours?.[dayName];
    const isWorkday = config?.isOpen ?? false;

    if (isWorkday && config) {
        const workStart = parse(config.start, 'HH:mm', date);
        const workEnd = parse(config.end, 'HH:mm', date);
        workdayDurationMins = Math.max(0, differenceInMinutes(workEnd, workStart));

        daySessions.forEach(s => {
            const start = toDate(s.startedAt);
            const end = toDate(s.endedAt) || (dateKey === format(now, 'yyyy-MM-dd') ? now : start); // Use now if it's today and session ongoing
            if (!start || !end) return;

            const duration = s.durationInMinutes || differenceInMinutes(end, start);
            totalBusyMins += duration;

            // Calculate overlap with workday
            const overlapStart = isAfter(start, workStart) ? start : workStart;
            const overlapEnd = isBefore(end, workEnd) ? end : workEnd;
            
            if (isBefore(overlapStart, overlapEnd)) {
                busyInsideWorkdayMins += Math.max(0, differenceInMinutes(overlapEnd, overlapStart));
            }
        });

        // Special handling for currently active session today
        if (dateKey === format(now, 'yyyy-MM-dd') && userProfile.status === 'Busy' && userProfile.currentSessionStartedAt) {
            const start = toDate(userProfile.currentSessionStartedAt);
            if (start && format(start, 'yyyy-MM-dd') === dateKey) {
                const end = now;
                const duration = differenceInMinutes(end, start);
                totalBusyMins += duration;
                
                const overlapStart = isAfter(start, workStart) ? start : workStart;
                const overlapEnd = isBefore(end, workEnd) ? end : workEnd;
                if (isBefore(overlapStart, overlapEnd)) {
                    busyInsideWorkdayMins += Math.max(0, differenceInMinutes(overlapEnd, overlapStart));
                }
            }
        }
    } else {
        // Closed day - everything is overtime busy
        daySessions.forEach(s => totalBusyMins += (s.durationInMinutes || 0));
        if (dateKey === format(now, 'yyyy-MM-dd') && userProfile.status === 'Busy' && userProfile.currentSessionStartedAt) {
             const start = toDate(userProfile.currentSessionStartedAt);
             if (start) totalBusyMins += differenceInMinutes(now, start);
        }
    }

    const availableMins = isWorkday ? Math.max(0, workdayDurationMins - busyInsideWorkdayMins) : 0;

    return {
        isWorkday,
        workdayDurationMins,
        totalBusyMins,
        busyInsideWorkdayMins,
        availableMins,
        dateKey
    };
  };

  const stats = useMemo(() => {
    if (!sessions) return null;

    const todayStats = calculateDayStats(now, sessions, department || undefined);
    
    // Aggregates for week and month
    const weekStart = startOfWeek(now);
    const monthStart = startOfMonth(now);
    
    let weekBusy = 0;
    let monthBusy = 0;

    sessions.forEach(s => {
        const start = toDate(s.startedAt);
        if (!start) return;
        const dur = s.durationInMinutes || 0;
        if (isWithinInterval(start, { start: weekStart, end: now })) weekBusy += dur;
        if (isWithinInterval(start, { start: monthStart, end: now })) monthBusy += dur;
    });

    if (userProfile.status === 'Busy' && userProfile.currentSessionStartedAt) {
        const start = toDate(userProfile.currentSessionStartedAt);
        if (start) {
            const dur = differenceInMinutes(now, start);
            weekBusy += dur;
            monthBusy += dur;
        }
    }

    return {
        today: todayStats,
        weekBusy: (weekBusy / 60).toFixed(1) + 'h',
        monthBusy: (monthBusy / 60).toFixed(1) + 'h',
    };
  }, [sessions, department, now, userProfile.status, userProfile.currentSessionStartedAt]);

  const historyData = useMemo(() => {
    if (!sessions) return [];
    const interval = eachDayOfInterval({
        start: subDays(now, 13),
        end: now
    }).reverse();

    return interval.map(date => calculateDayStats(date, sessions, department || undefined));
  }, [sessions, department, now]);

  if (isLoading) return <Skeleton className="h-48 w-full rounded-2xl" />;

  const isBusy = userProfile.status === 'Busy';

  return (
    <Card className="border-none shadow-sm overflow-hidden bg-white">
      <CardHeader className="bg-slate-50/50 border-b p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-xl font-bold flex items-center gap-2">
                <Clock className="h-5 w-5 text-[#1e3a8a]" />
                Work Hours & Tracking
            </CardTitle>
            <CardDescription>
                Performance tracking based on status activity and department hours.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
             <div className="text-right hidden sm:block">
                <p className="text-[10px] font-bold uppercase text-slate-400">CURRENT STATUS</p>
                <div className="flex items-center gap-2 justify-end">
                    <div className={cn("h-2 w-2 rounded-full", isBusy ? 'bg-red-500 animate-pulse' : 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]')} />
                    <span className="font-bold text-sm text-slate-700">{userProfile.status || 'Available'}</span>
                </div>
             </div>
             <Button 
                variant="outline" 
                size="sm" 
                className="gap-2 font-bold h-9 rounded-xl border-slate-200"
                onClick={() => setIsHistoryOpen(true)}
             >
                <History className="h-4 w-4" />
                View History
             </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="p-6 space-y-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="flex flex-col items-center p-5 border border-red-100 rounded-2xl bg-red-50/20 group hover:bg-red-50/40 transition-colors">
            <Clock className="h-5 w-5 text-red-500 mb-2" />
            <span className="text-[10px] text-red-800 uppercase font-black tracking-widest opacity-60">Today Busy</span>
            <span className="text-2xl font-black text-red-600 mt-1">{formatMins(stats?.today.totalBusyMins || 0)}</span>
          </div>
          
          <div className="flex flex-col items-center p-5 border border-emerald-100 rounded-2xl bg-emerald-50/20 group hover:bg-emerald-50/40 transition-colors">
            <UserCheck className="h-5 w-5 text-emerald-500 mb-2" />
            <span className="text-[10px] text-emerald-800 uppercase font-black tracking-widest opacity-60">Today Available</span>
            <span className="text-2xl font-black text-emerald-600 mt-1">{formatMins(stats?.today.availableMins || 0)}</span>
          </div>

          <div className="flex flex-col items-center p-5 border border-blue-100 rounded-2xl bg-blue-50/20 group hover:bg-blue-50/40 transition-colors">
            <Calendar className="h-5 w-5 text-blue-500 mb-2" />
            <span className="text-[10px] text-blue-800 uppercase font-black tracking-widest opacity-60">This Week (Busy)</span>
            <span className="text-2xl font-black text-blue-600 mt-1">{stats?.weekBusy || '0.0h'}</span>
          </div>

          <div className="flex flex-col items-center p-5 border border-purple-100 rounded-2xl bg-purple-50/20 group hover:bg-purple-50/40 transition-colors">
            <BarChart3 className="h-5 w-5 text-purple-500 mb-2" />
            <span className="text-[10px] text-purple-800 uppercase font-black tracking-widest opacity-60">This Month (Busy)</span>
            <span className="text-2xl font-black text-purple-600 mt-1">{stats?.monthBusy || '0.0h'}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 p-4 bg-slate-50 rounded-xl border border-slate-100">
            <Info className="h-4 w-4 text-slate-400" />
            <p className="text-[11px] text-slate-500 font-medium italic">
                "Today Available" is calculated by subtracting busy time within department working hours from the total workday length.
            </p>
        </div>
      </CardContent>

      <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                    <History className="h-5 w-5 text-[#1e3a8a]" />
                    Daily Work History
                </DialogTitle>
                <DialogDescription>
                    Tracking available vs busy time for the last 14 days.
                </DialogDescription>
            </DialogHeader>
            
            <div className="py-4">
                <Table>
                    <TableHeader className="bg-slate-50">
                        <TableRow>
                            <TableHead className="font-bold">Date</TableHead>
                            <TableHead className="font-bold">Status</TableHead>
                            <TableHead className="font-bold text-center">Workday</TableHead>
                            <TableHead className="font-bold text-center">Busy (In-office)</TableHead>
                            <TableHead className="font-bold text-center">Available</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {historyData.map((day) => (
                            <TableRow key={day.dateKey} className={day.dateKey === format(now, 'yyyy-MM-dd') ? "bg-blue-50/30" : ""}>
                                <TableCell className="font-bold">
                                    {format(parse(day.dateKey, 'yyyy-MM-dd', new Date()), 'EEE, MMM d')}
                                </TableCell>
                                <TableCell>
                                    {day.isWorkday ? (
                                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-100 font-bold uppercase text-[9px]">Open</Badge>
                                    ) : (
                                        <Badge variant="outline" className="bg-slate-100 text-slate-500 border-slate-200 font-bold uppercase text-[9px]">Closed</Badge>
                                    )}
                                </TableCell>
                                <TableCell className="text-center font-medium text-slate-500">
                                    {day.isWorkday ? `${(day.workdayDurationMins/60).toFixed(1)}h` : '—'}
                                </TableCell>
                                <TableCell className="text-center font-bold text-red-600">
                                    {formatMins(day.busyInsideWorkdayMins)}
                                </TableCell>
                                <TableCell className="text-center font-bold text-emerald-600">
                                    {day.isWorkday ? formatMins(day.availableMins) : '—'}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}


'use client';
import { useMemo, useState, useEffect } from 'react';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { TicketsByAssigneeChart } from '@/components/dashboard/tickets-by-assignee-chart';
import { TicketsByDepartmentChart } from '@/components/dashboard/tickets-by-department-chart';
import { TicketsByStatusDepartmentChart } from '@/components/dashboard/tickets-by-status-department-chart';
import { TicketsByDivisionChart } from '@/components/dashboard/tickets-by-division-chart';
import { TicketsByStatusChart } from '@/components/dashboard/tickets-by-status-chart';
import { TicketsByCampusChart } from '@/components/dashboard/tickets-by-campus-chart';
import { SLAComplianceTrendChart } from '@/components/dashboard/sla-compliance-trend-chart';
import { ChannelMixChart } from '@/components/dashboard/channel-mix-chart';
import { DivisionHealthCards } from '@/components/dashboard/division-health-cards';
import { useCollection, useDoc, useFirebase, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, doc, Timestamp } from 'firebase/firestore';
import type { Ticket as TicketType, UserProfile, SLASettings, Department, TicketChannel } from '@/lib/types';
import { DEFAULT_SLA_SETTINGS } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { Inbox, AlertTriangle, CheckCircle2, Clock, Star, Calendar as CalendarIcon, RefreshCcw, LayoutList, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/use-language';
import { calculateWorkingHoursElapsed } from '@/lib/working-hours-utils';

const toDate = (ts: any): Date | null => {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
  if (ts instanceof Date) return isNaN(ts.getTime()) ? null : ts;
  try {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
};

interface SummaryCardProps {
  title: string;
  value: string | number;
  footer: string;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
}

function SummaryCard({ title, value, footer, icon, iconBg, iconColor }: SummaryCardProps) {
  return (
    <Card className="overflow-hidden border-none shadow-sm bg-card">
      <CardContent className="p-6">
        <div className="flex justify-between items-start">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            <h3 className="text-3xl font-bold tracking-tight">{value}</h3>
          </div>
          <div className={cn("p-2 rounded-lg", iconBg, iconColor)}>
            {icon}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-4 font-medium">{footer}</p>
      </CardContent>
    </Card>
  );
}

function DashboardPage() {
  const { firestore } = useFirebase();
  const { user } = useUser();
  const { t } = useLanguage();
  const [now, setNow] = useState(new Date());

  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 7),
    to: new Date(),
  });

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const userProfileRef = useMemoFirebase(() =>
    firestore && user ? doc(firestore, 'users', user.uid) : null,
    [firestore, user]
  );
  const { data: userProfile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef);

  const slaRef = useMemoFirebase(() => (firestore ? doc(firestore, 'settings', 'sla') : null), [firestore]);
  const { data: savedSLA } = useDoc<SLASettings>(slaRef);
  const slaSettings = savedSLA || DEFAULT_SLA_SETTINGS;

  const departmentsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'departments')) : null), [firestore]);
  const { data: departments } = useCollection<Department>(departmentsQuery);

  const ticketsQuery = useMemoFirebase(() => {
    if (!firestore || isProfileLoading || !user) return null;
    return query(collection(firestore, 'tickets'));
  }, [firestore, user, isProfileLoading]);

  const { data: rawTickets, isLoading: areTicketsLoading } = useCollection<TicketType>(ticketsQuery);

  const roleFilteredTickets = useMemo(() => {
    if (!rawTickets || !userProfile || !user) return null;

    let result = [...rawTickets];

    if (userProfile.role === 'Admin') return result;

    const myUserId = user.uid;
    const myDeptId = userProfile.departmentId;
    const myCampuses = userProfile.campusIds || [];
    
    result = result.filter(t => {
        const isAssignedToMe = t.assignedTo?.userId === myUserId;
        const isSameDept = t.departmentId === myDeptId;
        const isAllowedCampus = myCampuses.length === 0 || (t.campusId && myCampuses.includes(t.campusId)) || !t.campusId;
        
        if (userProfile.role === 'Manager') {
            // Manager: Must be same department AND match allowed campuses
            return isSameDept && isAllowedCampus;
        }
        
        if (userProfile.role === 'Employee') {
            // Employee: Own tasks OR (Department context if permitted)
            return isAssignedToMe || (isSameDept && isAllowedCampus);
        }
        
        return isSameDept && isAllowedCampus;
    });

    return result;
  }, [rawTickets, userProfile, user]);

  const performanceFilteredTickets = useMemo(() => {
    if (!roleFilteredTickets) return null;
    let result = [...roleFilteredTickets];

    if (dateRange?.from) {
      const start = startOfDay(dateRange.from);
      const end = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
      
      result = result.filter(t => {
        const created = toDate(t.createdAt);
        return created && created >= start && created <= end;
      });
    }

    return result;
  }, [roleFilteredTickets, dateRange]);

  const stats = useMemo(() => {
    if (!performanceFilteredTickets || !departments) return null;

    const openCount = performanceFilteredTickets.filter(t => (t.status || 'Open') === 'Open').length;
    const pendingCount = performanceFilteredTickets.filter(t => {
        const s = t.status;
        return s === 'Queue' || s === 'Waiting' || s === 'In Progress';
    }).length;

    const isTicketSLACompliant = (t: TicketType) => {
        // MATCH BADGE LOGIC
        const start = toDate(t.assignedAt || t.createdAt);
        const responded = toDate(t.firstRespondedAt);
        const isFinished = ['Resolved', 'Closed'].includes(t.status);
        const finishedAt = isFinished ? toDate(t.resolvedAt || t.closedAt) : null;

        if (!start || !t.assignedTo) return true;

        const dept = departments.find(d => d.id === t.departmentId);
        
        // Correct normalization for SLA key lookup
        const rawChan = t.channel || 'Email';
        let channelKey: TicketChannel = 'Email';
        const lower = rawChan.toLowerCase();
        if (lower.includes('social')) channelKey = 'Social Media';
        else if (lower.includes('walk')) channelKey = 'Walk-in';
        else if (lower === 'website' || lower === 'api') channelKey = 'Web';
        else if (lower === 'whatsapp') channelKey = 'WhatsApp';
        else if (lower === 'form') channelKey = 'Form';
        else if (lower === 'phone') channelKey = 'Phone';
        else channelKey = (rawChan.charAt(0).toUpperCase() + rawChan.slice(1).toLowerCase()) as TicketChannel;

        const priority = t.priority || 'Normal';
        const policy = slaSettings[channelKey] || slaSettings['Email'];
        const limitHours = policy?.[priority] || 24;

        const compareTime = finishedAt || responded || now;
        const workingHoursElapsed = calculateWorkingHoursElapsed(start, compareTime, dept?.workingHours);
        
        return workingHoursElapsed < limitHours;
    }

    const assignedTickets = performanceFilteredTickets.filter(t => !!t.assignedTo);
    const compliantCount = assignedTickets.filter(t => isTicketSLACompliant(t)).length;
    const complianceRate = assignedTickets.length > 0 
      ? Math.round((compliantCount / assignedTickets.length) * 100) 
      : 100;

    const resolvedCount = performanceFilteredTickets.filter(t => t.status === 'Resolved').length;
    const reopenedCount = performanceFilteredTickets.filter(t => (t.reopenedCount || 0) > 0).length;

    return { openCount, pendingCount, complianceRate, resolvedCount, reopenedCount };
  }, [performanceFilteredTickets, now, slaSettings, departments]);

  const isLoading = isProfileLoading || areTicketsLoading;
  const isEmployee = userProfile?.role === 'Employee';

  if (isLoading) {
    return (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-5">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
            </div>
            <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div className="space-y-1 text-start">
                <h2 className="text-3xl font-bold tracking-tight">{t('dashboard')}</h2>
                <p className="text-sm text-muted-foreground">
                    {isEmployee 
                        ? t('personalQueue').replace('{{count}}', String(userProfile?.campusIds?.length || 0))
                        : t('liveView')
                    } — {format(now, 'EEEE, d MMMM yyyy')}
                </p>
            </div>

            <div className="flex items-center gap-2">
                <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="outline" className="justify-start text-left font-bold h-10 bg-white border-slate-200 shadow-sm">
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {dateRange?.from ? format(dateRange.from, "LLL dd, y") : t('anyDate')}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                        <Calendar mode="range" selected={dateRange} onSelect={setDateRange} numberOfMonths={2} />
                    </PopoverContent>
                </Popover>
            </div>
        </div>

        <div className={cn("grid gap-4 md:grid-cols-3", isEmployee ? "lg:grid-cols-3" : "lg:grid-cols-5")}>
          <SummaryCard title={t('openTickets')} value={stats?.openCount || 0} footer={t('inCampuses')} icon={<Inbox />} iconBg="bg-blue-50" iconColor="text-blue-600" />
          <SummaryCard title={t('pendingTickets')} value={stats?.pendingCount || 0} footer={t('waiting')} icon={<LayoutList />} iconBg="bg-purple-50" iconColor="text-purple-600" />
          
          {!isEmployee && <SummaryCard title={t('slaCompliance')} value={`${stats?.complianceRate || 100}%`} footer={t('standard')} icon={<CheckCircle2 />} iconBg="bg-green-50" iconColor="text-green-600" />}
          <SummaryCard title={t('resolved')} value={stats?.resolvedCount || 0} footer={t('selectedPeriod')} icon={<CheckCircle />} iconBg="bg-emerald-50" iconColor="text-emerald-600" />
          <SummaryCard title={t('reopened')} value={stats?.reopenedCount || 0} footer={t('selectedPeriod')} icon={<RefreshCcw />} iconBg="bg-orange-50" iconColor="text-orange-600" />
        </div>

        <DivisionHealthCards tickets={roleFilteredTickets || []} performanceTickets={performanceFilteredTickets || []} />

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3 space-y-6">
            <SLAComplianceTrendChart tickets={performanceFilteredTickets || []} dateRange={dateRange} />
            <TicketsByCampusChart tickets={performanceFilteredTickets || []} />
            {(userProfile?.role === 'Admin' || userProfile?.role === 'Manager') && (
              <>
                <TicketsByStatusDepartmentChart tickets={performanceFilteredTickets || []} />
                <TicketsByDivisionChart tickets={performanceFilteredTickets || []} />
              </>
            )}
          </div>
          <div className="lg:col-span-1 space-y-4">
             <ChannelMixChart tickets={performanceFilteredTickets || []} />
             {!isEmployee && <TicketsByAssigneeChart tickets={performanceFilteredTickets || []} />}
          </div>
        </div>
    </div>
  );
}

export default DashboardPage;

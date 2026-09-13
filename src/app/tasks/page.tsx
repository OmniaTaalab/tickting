
'use client';

import { useMemo, useState, useEffect } from 'react';
import { useUser, useFirebase, useMemoFirebase, useDoc, useCollection } from '@/firebase';
import { doc, collection, query, Timestamp } from 'firebase/firestore';
import { addHours, isAfter, startOfDay, endOfDay, format } from 'date-fns';
import type { UserProfile, Ticket, SLASettings, TicketStatus, Department, TicketChannel } from '@/lib/types';
import { DEFAULT_SLA_SETTINGS } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, CheckCircle2, Inbox, Filter, Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { 
    Select, 
    SelectContent, 
    SelectItem, 
    SelectTrigger, 
    SelectValue 
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/use-language';
import { TicketStatusBadge } from '@/components/tickets/ticket-status-badge';
import { calculateWorkingHoursElapsed } from '@/lib/working-hours-utils';

const toDate = (timestamp: any): Date | null => {
  if (!timestamp) return null;
  if (timestamp instanceof Timestamp) return timestamp.toDate();
  try {
    const d = new Date(timestamp);
    return isNaN(d.getTime()) ? null : d;
  } catch (e) {
    return null;
  }
};

const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
};

function TaskRow({ ticket, slaSettings, now, departments }: { ticket: Ticket; slaSettings: SLASettings; now: Date; departments: Department[] }) {
    const router = useRouter();
    const { t } = useLanguage();
    
    // MATCH BADGE LOGIC
    const start = toDate(ticket.assignedAt || ticket.createdAt);
    const responded = toDate(ticket.firstRespondedAt);
    const isFinished = ['Resolved', 'Closed'].includes(ticket.status);
    const finishedAt = isFinished ? toDate(ticket.resolvedAt || ticket.closedAt) : null;
    
    const dept = departments.find(d => d.id === ticket.departmentId);
    
    // Correct channel normalization for SLA key lookup
    const rawChan = ticket.channel || 'Email';
    let channelKey: TicketChannel = 'Email';
    const lower = rawChan.toLowerCase();
    if (lower.includes('social')) channelKey = 'Social Media';
    else if (lower.includes('walk')) channelKey = 'Walk-in';
    else if (lower === 'website' || lower === 'api') channelKey = 'Web';
    else if (lower === 'whatsapp') channelKey = 'WhatsApp';
    else if (lower === 'form') channelKey = 'Form';
    else if (lower === 'phone') channelKey = 'Phone';
    else channelKey = (rawChan.charAt(0).toUpperCase() + rawChan.slice(1).toLowerCase()) as TicketChannel;

    const priority = ticket.priority || 'Normal';
    const policy = slaSettings[channelKey] || slaSettings['Email'];
    const limitHours = policy?.[priority] || 24;
    
    const isBreached = useMemo(() => {
        if (!start || !ticket.assignedTo) return false;
        const compareTime = finishedAt || responded || now;
        const workingHoursElapsed = calculateWorkingHoursElapsed(start, compareTime, dept?.workingHours);
        return workingHoursElapsed >= limitHours;
    }, [start, responded, finishedAt, now, limitHours, dept, ticket.assignedTo]);

    return (
        <div 
            onClick={() => router.push(`/tickets/${ticket.id}`)}
            className="flex items-center justify-between p-4 hover:bg-slate-50 cursor-pointer transition-colors border-b last:border-0 group"
        >
            <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className={cn(
                    "mt-1.5 h-2.5 w-2.5 rounded-full shrink-0",
                    ticket.status === 'Resolved' || ticket.status === 'Closed' ? "bg-emerald-500" : "bg-orange-500"
                )} />
                <div className="space-y-0.5 min-w-0 flex-1">
                    <h4 className="font-bold text-[15px] text-slate-900 group-hover:text-[#1e3a8a] truncate">
                        {ticket.subject}
                    </h4>
                    <div className="flex items-center gap-2 text-[11px] font-medium text-slate-400">
                        <span className="font-bold text-slate-500">#{ticket.ticketNumber || ticket.id.substring(0, 4)}</span>
                        <span>·</span>
                        <span className="truncate">{ticket.parentName || ticket.createdBy?.name || 'Parent'}</span>
                        <span>·</span>
                        <Badge variant="secondary" className="h-4 px-1.5 py-0 text-[9px] uppercase">
                            {ticket.campusName}
                        </Badge>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-6 shrink-0 ml-4">
                {isBreached && (
                    <span className="text-[10px] font-black text-red-600 uppercase tracking-widest bg-red-50 px-2 py-0.5 rounded border border-red-100">
                        {t('breached')}
                    </span>
                )}
                <div className="min-w-[100px] flex justify-center">
                    <TicketStatusBadge status={ticket.status} />
                </div>
            </div>
        </div>
    );
}

export default function TasksPage() {
    const { user } = useUser();
    const { firestore } = useFirebase();
    const { t, isRTL } = useLanguage();
    const [now, setNow] = useState(new Date());

    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
    const [slaBreachedOnly, setSlaBreachedOnly] = useState<boolean>(false);

    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 60000);
        return () => clearInterval(timer);
    }, []);

    const userProfileRef = useMemoFirebase(() => 
        user && firestore ? doc(firestore, 'users', user.uid) : null,
        [user, firestore]
    );
    const { data: userProfile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef);

    const slaRef = useMemoFirebase(() => (firestore ? doc(firestore, 'settings', 'sla') : null), [firestore]);
    const { data: savedSLA } = useDoc<SLASettings>(slaRef);
    const slaSettings = savedSLA || DEFAULT_SLA_SETTINGS;

    const deptsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'departments')) : null), [firestore]);
    const { data: departments } = useCollection<Department>(deptsQuery);

    const ticketsQuery = useMemoFirebase(() => {
        if (!firestore || !user || !userProfile) return null;
        return query(collection(firestore, 'tickets'));
    }, [firestore, user, userProfile]);

    const { data: rawTickets, isLoading: areTicketsLoading } = useCollection<Ticket>(ticketsQuery);

    const personalTickets = useMemo(() => {
        if (!rawTickets || !user) return [];
        const activeStatuses = ['Open', 'In Progress', 'Waiting'];
        return rawTickets.filter(t => t.assignedTo?.userId === user.uid && activeStatuses.includes(t.status));
    }, [rawTickets, user]);

    const activeTickets = useMemo(() => {
        if (!departments) return [];
        let result = [...personalTickets];
        if (statusFilter !== 'all') result = result.filter(t => t.status === statusFilter);
        if (dateRange?.from) {
            const start = startOfDay(dateRange.from!);
            const end = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from!);
            result = result.filter(t => {
                const d = toDate(t.createdAt);
                return d && d >= start && d <= end;
            });
        }
        if (slaBreachedOnly) {
            result = result.filter(t => {
                const start = toDate(t.assignedAt || t.createdAt);
                if (!start || !t.assignedTo) return false;
                
                const isFinished = ['Resolved', 'Closed'].includes(t.status);
                const finishedAt = isFinished ? toDate(t.resolvedAt || t.closedAt) : null;
                const responded = toDate(t.firstRespondedAt);

                const dept = departments.find(d => d.id === t.departmentId);
                
                // Normalization
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
                
                return workingHoursElapsed >= limitHours;
            });
        }
        return result.sort((a, b) => (toDate(b.updatedAt)?.getTime() || 0) - (toDate(a.updatedAt)?.getTime() || 0));
    }, [personalTickets, statusFilter, dateRange, slaBreachedOnly, slaSettings, now, departments]);

    if (isProfileLoading || areTicketsLoading) {
        return <div className="p-8 space-y-6"><Skeleton className="h-32 w-full rounded-2xl" /><Skeleton className="h-96 w-full" /></div>;
    }

    return (
        <div className="space-y-8 max-7xl mx-auto pb-20">
            <div className="bg-[#1e3a8a] rounded-2xl p-10 text-white flex flex-col md:flex-row md:items-center justify-between shadow-lg">
                <div className="flex items-center gap-6">
                    <Avatar className="h-16 w-16 bg-red-600 border-2 border-white/20">
                        <AvatarFallback className="text-white text-xl font-bold">{getInitials(userProfile?.name || 'U')}</AvatarFallback>
                    </Avatar>
                    <div className="space-y-0.5 text-start">
                        <h1 className="text-3xl font-bold">{userProfile?.name}</h1>
                        <p className="text-xs text-blue-100/70">
                            {userProfile?.role} • {t('campusesCountLabel').replace('{{count}}', String(userProfile?.campusIds?.length || 0))}
                        </p>
                    </div>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 bg-white p-4 rounded-xl border shadow-sm">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[160px] h-9 text-xs font-bold bg-slate-50/50 rounded-lg">
                        <SelectValue placeholder={t('status')} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">{t('allStatus')}</SelectItem>
                        <SelectItem value="Open">{t('open')}</SelectItem>
                        <SelectItem value="In Progress">{t('inProgress')}</SelectItem>
                        <SelectItem value="Waiting">{t('waiting')}</SelectItem>
                    </SelectContent>
                </Select>
                <div className={cn("flex items-center gap-3 px-2", isRTL ? "mr-auto" : "ml-auto")}>
                    <Label htmlFor="sla-breached" className="text-[10px] font-black text-slate-500 uppercase tracking-widest cursor-pointer">
                        {t('slaBreachedOnly')}
                    </Label>
                    <Switch id="sla-breached" checked={slaBreachedOnly} onCheckedChange={setSlaBreachedOnly} className="scale-75 data-[state=checked]:bg-red-500" />
                </div>
            </div>

            <Card className="border border-slate-100 shadow-sm overflow-hidden rounded-xl bg-white">
                <div className="divide-y divide-slate-100">
                    {activeTickets.length > 0 ? (
                        activeTickets.map(t => <TaskRow key={t.id} ticket={t} slaSettings={slaSettings} now={now} departments={departments || []} />)
                    ) : (
                        <div className="p-20 text-center flex flex-col items-center">
                            <div className="p-4 rounded-full bg-slate-50 mb-4">
                                <Inbox className="h-8 w-8 text-slate-200" />
                            </div>
                            <p className="text-slate-500 font-bold text-sm">{t('noTasks')}</p>
                        </div>
                    )}
                </div>
            </Card>
        </div>
    );
}


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
import { AlertTriangle, CheckCircle2, Inbox, Filter, Calendar as CalendarIcon, Search, RotateCcw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
                        <span>·</span>
                        <span className="text-slate-500 font-semibold">
                            {t('assignedTime')}: {toDate(ticket.assignedAt || ticket.createdAt) ? format(toDate(ticket.assignedAt || ticket.createdAt)!, 'MMM d, h:mm a') : t('na')}
                        </span>
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

    // Filters
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [priorityFilter, setPriorityFilter] = useState<string>('all');
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

        // Search query
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            result = result.filter(t => 
                (t.subject && t.subject.toLowerCase().includes(q)) ||
                (t.ticketNumber && String(t.ticketNumber).includes(q)) ||
                (t.id && t.id.toLowerCase().includes(q)) ||
                (t.parentName && t.parentName.toLowerCase().includes(q)) ||
                (t.campusName && t.campusName.toLowerCase().includes(q))
            );
        }

        // Status
        if (statusFilter !== 'all') {
            result = result.filter(t => t.status === statusFilter);
        }

        // Priority
        if (priorityFilter !== 'all') {
            result = result.filter(t => (t.priority || 'Normal') === priorityFilter);
        }

        // Date range
        if (dateRange?.from) {
            const start = startOfDay(dateRange.from!);
            const end = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from!);
            result = result.filter(t => {
                const d = toDate(t.createdAt);
                return d && d >= start && d <= end;
            });
        }

        // SLA breached only
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
    }, [personalTickets, searchQuery, statusFilter, priorityFilter, dateRange, slaBreachedOnly, slaSettings, now, departments]);

    const handleResetFilters = () => {
        setSearchQuery('');
        setStatusFilter('all');
        setPriorityFilter('all');
        setDateRange(undefined);
        setSlaBreachedOnly(false);
    };

    const hasActiveFilters = searchQuery.trim() !== '' || statusFilter !== 'all' || priorityFilter !== 'all' || dateRange !== undefined || slaBreachedOnly;

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

            {/* FILTER TOOLBAR */}
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-center">
                    {/* Search */}
                    <div className="relative sm:col-span-2 lg:col-span-2">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                            placeholder={t('searchTasksPlaceholder')}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 h-10 bg-slate-50 border-slate-200 rounded-xl text-xs focus:bg-white transition-colors"
                        />
                        {searchQuery && (
                            <button 
                                onClick={() => setSearchQuery('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>

                    {/* Status */}
                    <div>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="h-10 text-xs font-semibold bg-slate-50 border-slate-200 rounded-xl">
                                <SelectValue placeholder={t('filterByStatus')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('allStatus')}</SelectItem>
                                <SelectItem value="Open">{t('open')}</SelectItem>
                                <SelectItem value="In Progress">{t('inProgress')}</SelectItem>
                                <SelectItem value="Waiting">{t('waiting')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Priority */}
                    <div>
                        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                            <SelectTrigger className="h-10 text-xs font-semibold bg-slate-50 border-slate-200 rounded-xl">
                                <SelectValue placeholder={t('filterByPriority')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('allPriorities')}</SelectItem>
                                <SelectItem value="Urgent">{t('urgent')}</SelectItem>
                                <SelectItem value="High">{t('high')}</SelectItem>
                                <SelectItem value="Normal">{t('normal')}</SelectItem>
                                <SelectItem value="Low">{t('low')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* SLA Breached Toggle */}
                    <div className="flex items-center justify-between sm:justify-end gap-3 px-2 bg-slate-50 h-10 rounded-xl border border-slate-200/70">
                        <Label htmlFor="sla-breached" className="text-[11px] font-bold text-slate-600 cursor-pointer">
                            {t('slaBreachedOnly')}
                        </Label>
                        <Switch id="sla-breached" checked={slaBreachedOnly} onCheckedChange={setSlaBreachedOnly} className="scale-75 data-[state=checked]:bg-red-500" />
                    </div>
                </div>

                {/* Filter Summary & Reset */}
                {hasActiveFilters && (
                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                        <span className="text-slate-500 font-medium">
                            {activeTickets.length} / {personalTickets.length} {t('tasks')}
                        </span>
                        <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={handleResetFilters} 
                            className="h-7 text-xs font-bold text-slate-500 hover:text-red-600 gap-1.5"
                        >
                            <RotateCcw className="h-3 w-3" />
                            {t('resetFilters')}
                        </Button>
                    </div>
                )}
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
                            <p className="text-slate-500 font-bold text-sm">{t('noTasksFound')}</p>
                            {hasActiveFilters && (
                                <Button variant="outline" size="sm" onClick={handleResetFilters} className="mt-4 gap-2">
                                    <RotateCcw className="h-3.5 w-3.5" />
                                    {t('resetFilters')}
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            </Card>
        </div>
    );
}


'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { useCollection, useFirebase, useMemoFirebase, useUser, setDocumentNonBlocking } from '@/firebase';
import { collection, query, where, doc, orderBy, Timestamp } from 'firebase/firestore';
import type { TicketEvent } from '@/lib/types';
import { formatDistanceToNow, isToday, subDays } from 'date-fns';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { Bell, Mail, RefreshCcw, ArrowRightLeft, CheckCircle2, Inbox, Search, RotateCcw, CheckCheck, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/hooks/use-language';

const getIcon = (type: string) => {
    switch (type) {
        case 'TICKET_CREATED': return <Inbox className="h-4 w-4 text-blue-600" />;
        case 'TICKET_REPLY': return <Mail className="h-4 w-4 text-emerald-600" />;
        case 'TICKET_STATUS_CHANGED': return <RefreshCcw className="h-4 w-4 text-amber-600" />;
        case 'TICKET_TRANSFER_REQUESTED': return <ArrowRightLeft className="h-4 w-4 text-purple-600" />;
        default: return <Bell className="h-4 w-4 text-slate-400" />;
    }
};

const getBg = (type: string) => {
    switch (type) {
        case 'TICKET_CREATED': return 'bg-blue-50';
        case 'TICKET_REPLY': return 'bg-emerald-50';
        case 'TICKET_STATUS_CHANGED': return 'bg-amber-50';
        case 'TICKET_TRANSFER_REQUESTED': return 'bg-purple-50';
        default: return 'bg-slate-50';
    }
};

export default function NotificationsPage() {
    const { firestore } = useFirebase();
    const { user } = useUser();
    const { t } = useLanguage();
    const router = useRouter();

    // Filters
    const [searchQuery, setSearchQuery] = useState('');
    const [readFilter, setReadFilter] = useState<'all' | 'unread' | 'read'>('all');
    const [typeFilter, setTypeFilter] = useState<string>('all');
    const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7days' | '30days'>('all');

    const notificationsQuery = useMemoFirebase(() => {
        if (!firestore || !user) return null;
        return query(
            collection(firestore, 'ticket-events'),
            where('recipient', '==', user.uid)
        );
    }, [firestore, user]);

    const { data: notifications, isLoading } = useCollection<TicketEvent>(notificationsQuery);

    const isWithinDateFilter = (timestamp: any, filter: string) => {
        if (filter === 'all' || !timestamp) return true;
        const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        if (isNaN(d.getTime())) return true;
        if (filter === 'today') return isToday(d);
        if (filter === '7days') return d >= subDays(new Date(), 7);
        if (filter === '30days') return d >= subDays(new Date(), 30);
        return true;
    };

    const filteredNotifications = useMemo(() => {
        if (!notifications) return [];
        
        const sorted = [...notifications].sort((a, b) => {
            const timeA = a.timestamp?.toDate()?.getTime() || 0;
            const timeB = b.timestamp?.toDate()?.getTime() || 0;
            return timeB - timeA;
        });

        return sorted.filter((notif) => {
            // Read filter
            if (readFilter === 'unread' && notif.read) return false;
            if (readFilter === 'read' && !notif.read) return false;

            // Type filter
            if (typeFilter !== 'all' && notif.eventType !== typeFilter) return false;

            // Date filter
            if (!isWithinDateFilter(notif.timestamp, dateFilter)) return false;

            // Search query
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase().trim();
                const title = (notif.title || '').toLowerCase();
                const msg = (notif.message || '').toLowerCase();
                const ticketId = (notif.ticketId || '').toLowerCase();
                if (!title.includes(q) && !msg.includes(q) && !ticketId.includes(q)) {
                    return false;
                }
            }

            return true;
        });
    }, [notifications, readFilter, typeFilter, dateFilter, searchQuery]);

    const handleResetFilters = () => {
        setSearchQuery('');
        setReadFilter('all');
        setTypeFilter('all');
        setDateFilter('all');
    };

    const hasActiveFilters = searchQuery.trim() !== '' || readFilter !== 'all' || typeFilter !== 'all' || dateFilter !== 'all';

    const handleNotificationClick = (notification: TicketEvent) => {
        if (!firestore) return;
        if (!notification.read) {
            const notifRef = doc(firestore, 'ticket-events', notification.id);
            setDocumentNonBlocking(notifRef, { read: true }, { merge: true });
        }
        router.push(`/tickets/${notification.ticketId}`);
    };

    const handleMarkAllAsRead = () => {
        if (!firestore || !notifications) return;
        notifications.filter(n => !n.read).forEach(notif => {
            const notifRef = doc(firestore, 'ticket-events', notif.id);
            setDocumentNonBlocking(notifRef, { read: true }, { merge: true });
        });
    };

    const unreadCount = notifications ? notifications.filter(n => !n.read).length : 0;

    if (isLoading) {
        return (
            <div className="max-w-5xl mx-auto space-y-6">
                <Skeleton className="h-10 w-48" />
                <div className="space-y-4">
                    {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto space-y-8 pb-10">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 font-headline">{t('notifications')}</h1>
                    <p className="text-slate-500 font-medium">{t('allNotifications')}</p>
                </div>
                <div className="flex items-center gap-2">
                    {unreadCount > 0 && (
                        <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={handleMarkAllAsRead}
                            className="gap-2 text-xs font-bold text-blue-900 hover:bg-blue-50 border-blue-200"
                        >
                            <CheckCheck className="h-4 w-4 text-blue-600" />
                            {t('markAllAsRead')}
                        </Button>
                    )}
                    {unreadCount > 0 && (
                        <Badge variant="secondary" className="h-7 font-bold px-3 bg-blue-100 text-blue-800">
                            {unreadCount} {t('unreadOnly')}
                        </Badge>
                    )}
                </div>
            </div>

            {/* FILTER TOOLBAR */}
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                            placeholder={t('searchNotificationsPlaceholder')}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 bg-slate-50 border-slate-200 text-xs h-10 rounded-xl focus:bg-white transition-colors"
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

                    {/* Read / Unread */}
                    <div>
                        <Select value={readFilter} onValueChange={(val: any) => setReadFilter(val)}>
                            <SelectTrigger className="h-10 bg-slate-50 border-slate-200 rounded-xl text-xs font-semibold">
                                <SelectValue placeholder={t('allNotifications')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('allNotifications')}</SelectItem>
                                <SelectItem value="unread">{t('unreadOnly')}</SelectItem>
                                <SelectItem value="read">{t('readOnly')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Type Filter */}
                    <div>
                        <Select value={typeFilter} onValueChange={setTypeFilter}>
                            <SelectTrigger className="h-10 bg-slate-50 border-slate-200 rounded-xl text-xs font-semibold">
                                <SelectValue placeholder={t('allNotificationTypes')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('allNotificationTypes')}</SelectItem>
                                <SelectItem value="TICKET_CREATED">{t('notifTypeCreated')}</SelectItem>
                                <SelectItem value="TICKET_REPLY">{t('notifTypeReply')}</SelectItem>
                                <SelectItem value="TICKET_STATUS_CHANGED">{t('notifTypeStatus')}</SelectItem>
                                <SelectItem value="TICKET_TRANSFER_REQUESTED">{t('notifTypeTransfer')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Date Filter */}
                    <div>
                        <Select value={dateFilter} onValueChange={(val: any) => setDateFilter(val)}>
                            <SelectTrigger className="h-10 bg-slate-50 border-slate-200 rounded-xl text-xs font-semibold">
                                <SelectValue placeholder={t('allTime')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('allTime')}</SelectItem>
                                <SelectItem value="today">{t('filterToday')}</SelectItem>
                                <SelectItem value="7days">{t('filterLast7Days')}</SelectItem>
                                <SelectItem value="30days">{t('filterLast30Days')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Filter Summary & Reset */}
                {hasActiveFilters && (
                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                        <span className="text-slate-500 font-medium">
                            {filteredNotifications.length} / {notifications?.length || 0} {t('notifications')}
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

            <Card className="border-none shadow-sm overflow-hidden bg-white">
                <CardContent className="p-0">
                    {filteredNotifications.length > 0 ? (
                        <div className="divide-y divide-slate-100">
                            {filteredNotifications.map((notif) => (
                                <div
                                    key={notif.id}
                                    onClick={() => handleNotificationClick(notif)}
                                    className={cn(
                                        "p-6 flex items-start gap-4 cursor-pointer transition-all hover:bg-slate-50/50",
                                        !notif.read ? "bg-blue-50/30 border-l-4 border-l-[#1e3a8a]" : "border-l-4 border-l-transparent"
                                    )}
                                >
                                    <div className={cn("p-2.5 rounded-xl shrink-0", getBg(notif.eventType))}>
                                        {getIcon(notif.eventType)}
                                    </div>
                                    <div className="flex-1 min-w-0 space-y-1">
                                        <div className="flex items-center justify-between gap-2">
                                            <h3 className={cn("text-sm font-bold text-slate-900 leading-tight truncate", !notif.read && "text-[#1e3a8a]")}>
                                                {notif.title}
                                            </h3>
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight whitespace-nowrap">
                                                {notif.timestamp ? formatDistanceToNow(notif.timestamp.toDate(), { addSuffix: true }) : 'Just now'}
                                            </span>
                                        </div>
                                        <p className="text-sm text-slate-600 leading-relaxed line-clamp-2">
                                            {notif.message}
                                        </p>
                                        <div className="flex items-center gap-2 pt-1">
                                             <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                                Ticket #{notif.ticketId.substring(0, 8)}
                                            </span>
                                            {!notif.read && <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="py-20 text-center flex flex-col items-center">
                            <div className="p-4 rounded-full bg-slate-50 mb-4">
                                <Bell className="h-8 w-8 text-slate-300" />
                            </div>
                            <h3 className="text-lg font-bold text-slate-800">{t('noNotificationsFound')}</h3>
                            <p className="text-slate-500 text-sm max-w-xs mx-auto mt-1">
                                {hasActiveFilters ? 'Try adjusting or clearing your filters.' : "You don't have any notifications right now."}
                            </p>
                            {hasActiveFilters && (
                                <Button variant="outline" size="sm" onClick={handleResetFilters} className="mt-4 gap-2">
                                    <RotateCcw className="h-3.5 w-3.5" />
                                    {t('resetFilters')}
                                </Button>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

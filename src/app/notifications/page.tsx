
'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCollection, useFirebase, useMemoFirebase, useUser, setDocumentNonBlocking } from '@/firebase';
import { collection, query, where, doc, orderBy, Timestamp } from 'firebase/firestore';
import type { TicketEvent } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { Bell, Mail, RefreshCcw, ArrowRightLeft, CheckCircle2, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

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
    const router = useRouter();

    const notificationsQuery = useMemoFirebase(() => {
        if (!firestore || !user) return null;
        return query(
            collection(firestore, 'ticket-events'),
            where('recipient', '==', user.uid)
        );
    }, [firestore, user]);

    const { data: notifications, isLoading } = useCollection<TicketEvent>(notificationsQuery);

    const sortedNotifications = useMemo(() => {
        if (!notifications) return null;
        return [...notifications].sort((a, b) => {
            const timeA = a.timestamp?.toDate()?.getTime() || 0;
            const timeB = b.timestamp?.toDate()?.getTime() || 0;
            return timeB - timeA;
        });
    }, [notifications]);

    const handleNotificationClick = (notification: TicketEvent) => {
        if (!firestore) return;
        if (!notification.read) {
            const notifRef = doc(firestore, 'ticket-events', notification.id);
            setDocumentNonBlocking(notifRef, { read: true }, { merge: true });
        }
        router.push(`/tickets/${notification.ticketId}`);
    };

    if (isLoading) {
        return (
            <div className="max-w-4xl mx-auto space-y-6">
                <Skeleton className="h-10 w-48" />
                <div className="space-y-4">
                    {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8 pb-10">
            <div className="flex items-center justify-between">
                <div className="space-y-1">
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 font-headline">Notifications</h1>
                    <p className="text-slate-500 font-medium">Keep track of all activities on your tickets</p>
                </div>
                {notifications && notifications.filter(n => !n.read).length > 0 && (
                     <Badge variant="secondary" className="h-6 font-bold px-3">
                        {notifications.filter(n => !n.read).length} Unread
                    </Badge>
                )}
            </div>

            <Card className="border-none shadow-sm overflow-hidden bg-white">
                <CardContent className="p-0">
                    {sortedNotifications && sortedNotifications.length > 0 ? (
                        <div className="divide-y divide-slate-100">
                            {sortedNotifications.map((notif) => (
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
                            <h3 className="text-lg font-bold text-slate-800">All caught up!</h3>
                            <p className="text-slate-500 text-sm max-w-xs mx-auto mt-1">
                                You don't have any notifications right now. We'll let you know when something happens.
                            </p>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

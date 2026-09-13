'use client';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useFirebase, useUser, useCollection, useMemoFirebase, setDocumentNonBlocking } from '@/firebase';
import { collection, query, where, doc, limit } from 'firebase/firestore';
import type { TicketEvent } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';
import { arSA } from 'date-fns/locale';
import { useRouter } from 'next/navigation';
import { Skeleton } from './ui/skeleton';
import { useMemo } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/hooks/use-language';

function NotificationList({ notifications, isLoading }: { notifications: TicketEvent[] | null, isLoading: boolean }) {
  const { firestore } = useFirebase();
  const { t, language } = useLanguage();
  const router = useRouter();

  // Handle sorting on the client side to avoid requiring a composite index
  const sortedNotifications = useMemo(() => {
      if (!notifications) return null;
      return [...notifications]
          .sort((a, b) => {
              const timeA = a.timestamp?.toDate()?.getTime() || 0;
              const timeB = b.timestamp?.toDate()?.getTime() || 0;
              return timeB - timeA;
          })
          .slice(0, 10);
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
        <div className="p-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full mb-2" />)}
        </div>
    );
  }

  if (!sortedNotifications || sortedNotifications.length === 0) {
    return (
        <div className="py-8 px-4 text-center">
            <p className="text-sm font-bold text-slate-800">{t('allCaughtUp')}</p>
            <p className="text-xs text-slate-400 mt-1">{t('noNotifications')}</p>
        </div>
    );
  }

  return (
    <div className="max-h-[400px] overflow-y-auto">
      {sortedNotifications.map((notif) => (
        <DropdownMenuItem
          key={notif.id}
          className={`cursor-pointer border-b last:border-0 p-4 focus:bg-slate-50 transition-colors ${!notif.read ? 'bg-blue-50/30' : ''}`}
          onClick={() => handleNotificationClick(notif)}
        >
          <div className="flex flex-col gap-1 w-full text-start">
            <div className="flex items-center justify-between gap-2">
                <p className={`text-sm leading-tight ${!notif.read ? 'font-black text-[#1e3a8a]' : 'font-bold text-slate-700'}`}>{notif.title}</p>
                {!notif.read && <span className="h-2 w-2 rounded-full bg-blue-600 shrink-0 shadow-[0_0_5px_rgba(37,99,235,0.5)]" />}
            </div>
            <p className="text-xs text-slate-500 line-clamp-2 font-medium leading-relaxed">{notif.message}</p>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tight mt-1">
              {notif.timestamp ? formatDistanceToNow(notif.timestamp.toDate(), { addSuffix: true, locale: language === 'ar' ? arSA : undefined }) : t('justNow')}
            </p>
          </div>
        </DropdownMenuItem>
      ))}
    </div>
  );
}


export function NotificationBell() {
    const { firestore } = useFirebase();
    const { user } = useUser();
    const { t } = useLanguage();

    // Fetch recent notifications for the user.
    const notificationsQuery = useMemoFirebase(() => {
        if (!firestore || !user) return null;
        return query(
          collection(firestore, 'ticket-events'),
          where('recipient', '==', user.uid),
          limit(50)
        );
      }, [firestore, user]);

    const { data: notifications, isLoading } = useCollection<TicketEvent>(notificationsQuery);
    
    // Calculate the unread count
    const unreadCount = useMemo(() => {
        if (!notifications) return 0;
        return notifications.filter(n => !n.read).length;
    }, [notifications]);


  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full relative hover:bg-slate-100 transition-colors">
          <Bell className="h-5 w-5 text-slate-600" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-black text-white shadow-sm animate-in zoom-in border-2 border-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0 overflow-hidden shadow-2xl border-slate-100 rounded-2xl">
        <div className="p-4 border-b bg-slate-50/50 text-start">
            <DropdownMenuLabel className="p-0 text-sm font-black uppercase tracking-widest text-slate-400">{t('notifications')}</DropdownMenuLabel>
        </div>
        <NotificationList notifications={notifications} isLoading={isLoading} />
        {notifications && notifications.length > 0 && (
            <>
                <DropdownMenuSeparator className="m-0" />
                <div className="p-3 text-center bg-slate-50/30">
                    <Button asChild variant="link" size="sm" className="text-xs h-auto py-0 font-bold text-[#1e3a8a] cursor-pointer">
                        <Link href="/notifications">{t('viewAll')}</Link>
                    </Button>
                </div>
            </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

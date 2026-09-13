
'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarContent,
  useSidebar,
  SidebarGroup,
  SidebarGroupLabel,
} from '@/components/ui/sidebar';
import {
  LayoutGrid,
  Inbox,
  CheckSquare,
  BarChart3,
  Users2,
  Settings,
  LogOut,
  AlertTriangle,
  PlusCircle,
  ArrowRightLeft,
} from 'lucide-react';
import { Logo } from '@/components/icons';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useUser, useFirebase, useMemoFirebase, useDoc, useCollection } from '@/firebase';
import type { UserProfile, Ticket, SLASettings, TicketEvent, Department, TicketChannel } from '@/lib/types';
import { DEFAULT_SLA_SETTINGS } from '@/lib/types';
import { doc, collection, query, Timestamp, where } from 'firebase/firestore';
import { useMemo, useEffect, useState } from 'react';
import { signOut } from 'firebase/auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '../ui/button';
import { useLanguage } from '@/hooks/use-language';
import { calculateWorkingHoursElapsed } from '@/lib/working-hours-utils';
import { toggleUserStatusAction } from '@/actions/status_actions';

const toDate = (ts: any): Date | null => {
  if (!ts) return null;
  if (ts instanceof Timestamp) return ts.toDate();
  try {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  } catch (e) {
    return null;
  }
};

export function SidebarNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { state } = useSidebar();
  const { user, isUserLoading } = useUser();
  const { firestore, auth } = useFirebase();
  const { toast } = useToast();
  const { t, isRTL, language } = useLanguage();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const userProfileRef = useMemoFirebase(() =>
    user && firestore ? doc(firestore, 'users', user.uid) : null,
    [user, firestore]
  );
  const { data: userProfile } = useDoc<UserProfile>(userProfileRef);

  const slaRef = useMemoFirebase(() => (firestore ? doc(firestore, 'settings', 'sla') : null), [firestore]);
  const { data: savedSLA } = useDoc<SLASettings>(slaRef);
  const slaSettings = savedSLA || DEFAULT_SLA_SETTINGS;

  const ticketsQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'tickets')) : null, [firestore]);
  const { data: allTickets } = useCollection<Ticket>(ticketsQuery);

  const deptsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'departments')) : null), [firestore]);
  const { data: departments } = useCollection<Department>(deptsQuery);

  const requestsQuery = useMemoFirebase(() => {
    if (!firestore || !user || (userProfile?.role !== 'Admin' && userProfile?.role !== 'Manager')) return null;
    return query(
        collection(firestore, 'ticket-events'),
        where('recipient', '==', user.uid),
        where('eventType', 'in', ['TICKET_TRANSFER_REQUESTED', 'TICKET_REASSIGN_REQUESTED']),
        where('read', '==', false)
    );
  }, [firestore, user, userProfile]);
  const { data: unreadRequests } = useCollection<TicketEvent>(requestsQuery);

  // LOGIC: Filter active tickets based on ROLE, DEPARTMENT, and CAMPUS
  const relevantActiveTickets = useMemo(() => {
    if (!allTickets || !user || !userProfile) return [];
    
    const activeStatuses = ['Open', 'In Progress', 'Waiting'];
    const activeTickets = allTickets.filter(t => activeStatuses.includes(t.status));

    if (userProfile.role === 'Admin') {
        return activeTickets; // Admins see all active tickets
    }

    const myDeptId = userProfile.departmentId;
    const myCampuses = userProfile.campusIds || [];

    if (userProfile.role === 'Manager') {
        // Managers see active tickets in their department AND their campuses
        return activeTickets.filter(t => 
            t.departmentId === myDeptId && 
            (myCampuses.length === 0 || (t.campusId && myCampuses.includes(t.campusId)))
        );
    }

    // Employees see only their assigned active tickets
    return activeTickets.filter(t => t.assignedTo?.userId === user.uid);
  }, [allTickets, user, userProfile]);

  const stats = useMemo(() => {
    if (!relevantActiveTickets || !userProfile || !departments || !user || !slaSettings) return { badgeCount: 0, slaBreaches: 0 };
    
    // SLA breaches: iterate over relevant tickets (Personal for staff, Dept+Campus for manager, All for admin)
    const slaBreaches = relevantActiveTickets.filter(t => {
      const start = toDate(t.assignedAt || t.createdAt);
      if (!start) return false;
      
      const responded = toDate(t.firstRespondedAt);
      const isFinished = ['Resolved', 'Closed'].includes(t.status);
      const finishedAt = isFinished ? toDate(t.resolvedAt || t.closedAt) : null;
      
      // Normalize Channel Key for SLA Settings lookup
      const rawChan = t.channel || 'Email';
      let channelKey: TicketChannel = 'Email';
      const lower = rawChan.toLowerCase().trim();
      
      if (lower === 'email') channelKey = 'Email';
      else if (lower === 'phone') channelKey = 'Phone';
      else if (lower.includes('walk')) channelKey = 'Walk-in';
      else if (lower.includes('social')) channelKey = 'Social Media';
      else if (lower === 'web' || lower === 'website' || lower === 'api') channelKey = 'Web';
      else if (lower === 'form') channelKey = 'Form';

      const priority = t.priority || 'Normal';
      const policy = slaSettings[channelKey] || slaSettings['Email'];
      const limitHours = policy?.[priority] || 24;
      
      const compareTime = finishedAt || responded || now;
      const dept = departments.find(d => d.id === t.departmentId);
      
      // USE WORKING HOURS LOGIC
      const workingHoursElapsed = calculateWorkingHoursElapsed(start, compareTime, dept?.workingHours);
      
      return workingHoursElapsed >= limitHours;
    }).length;

    return { badgeCount: relevantActiveTickets.length, slaBreaches };
  }, [relevantActiveTickets, userProfile, slaSettings, departments, now, user]);

  const handleSignOut = async () => {
    if (!auth) return;
    try {
      if (user) {
        await toggleUserStatusAction(user.uid, 'Busy');
      }
      await signOut(auth);
      toast({ title: t('signOut') });
      router.replace('/login');
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error' });
    }
  };

  useEffect(() => {
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
    if (isRTL) {
      document.body.style.fontFamily = "'Cairo', 'Inter', sans-serif";
    } else {
      document.body.style.fontFamily = "'Inter', sans-serif";
    }
  }, [isRTL, language]);

  if (isUserLoading || !user) return null;

  return (
    <>
      <SidebarHeader className="border-b h-16 flex flex-row items-center px-4">
        <Logo showText={state !== 'collapsed'} />
      </SidebarHeader>

      <SidebarContent className="p-2 space-y-4">
        {state !== 'collapsed' && (
          <div className="px-2 pt-2">
            <Button asChild className="w-full bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white font-bold h-10 gap-2">
              <Link href="/tickets/new" className="flex items-center justify-center gap-2">
                <PlusCircle className="h-4 w-4" /> 
                {t('newTicket')}
              </Link>
            </Button>
          </div>
        )}

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2 mb-2 text-start w-full">
            {t('workspace')}
          </SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === '/dashboard'} tooltip={t('dashboard')}>
                <Link href="/dashboard" className="gap-3">
                  <LayoutGrid className="h-4 w-4" />
                  <span className="font-semibold text-slate-700">{t('dashboard')}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === '/tickets'} tooltip={t('tickets')}>
                <Link href="/tickets" className="gap-3 flex items-center">
                  <Inbox className="h-4 w-4" />
                  <span className="font-semibold text-slate-700">{t('tickets')}</span>
                  {stats.badgeCount > 0 && (
                    <span className="bg-red-50 text-red-600 text-[11px] font-bold px-2 py-0.5 rounded-full ms-auto">
                      {stats.badgeCount}
                    </span>
                  )}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {(userProfile?.role === 'Admin' || userProfile?.role === 'Manager') && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === '/requests'} tooltip={t('requests')}>
                    <Link href="/requests" className="gap-3 flex items-center">
                      <ArrowRightLeft className="h-4 w-4" />
                      <span className="font-semibold text-slate-700">{t('requests')}</span>
                      {unreadRequests && unreadRequests.length > 0 && (
                        <span className="bg-blue-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full ms-auto">
                          {unreadRequests.length}
                        </span>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
            )}

            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === '/tasks'} tooltip={t('tasks')}>
                <Link href="/tasks" className="gap-3">
                  <CheckSquare className="h-4 w-4" />
                  <span className="font-semibold text-slate-700">{t('tasks')}</span>
                  {userProfile?.role === 'Employee' && stats.badgeCount > 0 && (
                    <span className="bg-blue-50 text-blue-600 text-[11px] font-bold px-2 py-0.5 rounded-full ms-auto">
                      {stats.badgeCount}
                    </span>
                  )}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {(userProfile?.role === 'Admin' || userProfile?.role === 'Manager') && (
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === '/analytics'} tooltip={t('analytics')}>
                  <Link href="/analytics" className="gap-3">
                    <BarChart3 className="h-4 w-4" />
                    <span className="font-semibold text-slate-700">{t('analytics')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarGroup>

        {(userProfile?.role === 'Admin' || userProfile?.role === 'Manager') && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] font-bold text-slate-400 uppercase px-2 mb-2 text-start w-full">
              {t('organization')}
            </SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === '/settings'} tooltip={t('settings')}>
                  <Link href="/settings" className="gap-3">
                    <Settings className="h-4 w-4" />
                    <span className="font-semibold text-slate-700">{t('settings')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        )}

        {state !== 'collapsed' && stats.slaBreaches > 0 && (
          <div className="mx-2 p-5 rounded-2xl bg-red-50/50 border border-red-100 mt-auto">
            <div className="flex items-center gap-2 text-red-800 font-bold text-[10px] uppercase text-start">
              <AlertTriangle className="h-3 w-3" /> {t('slaBreach')}
            </div>
            <div className="text-4xl font-black text-red-600 tracking-tighter text-start">{stats.slaBreaches}</div>
            <Link href="/tickets?sla=breached" className="text-red-500 text-[10px] font-bold underline mt-3 block text-start">
              {t('reviewNow')}
            </Link>
          </div>
        )}
      </SidebarContent>

      <SidebarFooter className="p-4 border-t">
        <div className="flex items-center gap-3 w-full">
          <Avatar className="h-10 w-10 bg-red-600 border-2 border-white shadow-sm shrink-0">
            <AvatarFallback className="text-white font-bold text-xs">{userProfile?.name?.charAt(0) || 'U'}</AvatarFallback>
          </Avatar>
          {state !== 'collapsed' && (
            <div className="flex-1 min-w-0 text-start">
              <p className="text-sm font-bold text-slate-900 truncate">{userProfile?.name || 'User'}</p>
              <p className="text-[10px] text-slate-500 font-bold uppercase truncate">{userProfile?.role}</p>
            </div>
          )}
          <button 
            onClick={handleSignOut} 
            className="text-slate-400 hover:text-slate-600 transition-colors shrink-0"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </SidebarFooter>
    </>
  );
}


'use client';

import { useParams, useRouter } from 'next/navigation';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useDoc, useCollection, useFirebase, useMemoFirebase, useUser } from '@/firebase';
import { doc, collection, query, where, Timestamp } from 'firebase/firestore';
import type { UserProfile, Ticket as TicketType, Department, WorkSession } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/dashboard/stat-card';
import { CheckCheck, XCircle, Ticket, UserCheck, ShieldAlert, CheckCircle, Circle, Download } from 'lucide-react';
import { useMemo } from 'react';
import { TicketStatusBadge } from '@/components/tickets/ticket-status-badge';
import { format, startOfToday, startOfWeek, startOfMonth, isWithinInterval, differenceInMinutes } from 'date-fns';
import { DepartmentEmployeesCard } from '../_components/department-employees-card';
import { cn } from '@/lib/utils';
import { WorkHoursStats } from '@/components/users/work-hours-stats';
import { Button } from '@/components/ui/button';
import * as XLSX from 'xlsx';

const toDate = (timestamp: Timestamp | string | undefined): Date | null => {
  if (!timestamp) return null;
  if (timestamp instanceof Timestamp) {
    return timestamp.toDate();
  }
  try {
    const d = new Date(timestamp);
    return isNaN(d.getTime()) ? null : d;
  } catch (e) {
    return null;
  }
};

function UserDetailsPage() {
    const params = useParams();
    const router = useRouter();
    const userId = params.id as string;
    const { firestore } = useFirebase();
    const { user: currentUser } = useUser();

    const userProfileRef = useMemoFirebase(() =>
        userId && firestore ? doc(firestore, 'users', userId) : null,
        [userId, firestore]
    );
    const { data: userProfile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef);

    const loggedInUserProfileRef = useMemoFirebase(() =>
        currentUser && firestore ? doc(firestore, 'users', currentUser.uid) : null,
        [currentUser, firestore]
    );
    const { data: loggedInUserProfile } = useDoc<UserProfile>(loggedInUserProfileRef);
    
    const deptsQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'departments')) : null, [firestore]);
    const { data: departments, isLoading: areDeptsLoading } = useCollection<Department>(deptsQuery);
    const departmentsMap = useMemo(() => new Map(departments?.map(d => [d.id, d.name])), [departments]);

    const assignedTicketsQuery = useMemoFirebase(() =>
        userId && firestore ? query(collection(firestore, 'tickets'), where('assignedTo.userId', '==', userId)) : null,
        [userId, firestore]
    );
    const { data: assignedTickets, isLoading: areAssignedLoading } = useCollection<TicketType>(assignedTicketsQuery);
    
    const createdTicketsQuery = useMemoFirebase(() =>
        userId && firestore ? query(collection(firestore, 'tickets'), where('createdBy.userId', '==', userId)) : null,
        [userId, firestore]
    );
    const { data: createdTickets, isLoading: areCreatedLoading } = useCollection<TicketType>(createdTicketsQuery);

    const sessionsQuery = useMemoFirebase(() => {
        if (!firestore || !userId || !currentUser) return null;
        return query(collection(firestore, 'work-sessions'), where('userId', '==', userId));
    }, [firestore, userId, currentUser]);
    const { data: sessions, isLoading: areSessionsLoading } = useCollection<WorkSession>(sessionsQuery);


    const resolvedTicketsCount = assignedTickets?.filter(t => t.status === 'Resolved').length || 0;
    const closedTicketsCount = assignedTickets?.filter(t => t.status === 'Closed').length || 0;

    const isLoading = isProfileLoading || areAssignedLoading || areCreatedLoading || areDeptsLoading || areSessionsLoading;

    const canSeeWorkHours = useMemo(() => {
        if (!loggedInUserProfile) return false;
        const isAdmin = loggedInUserProfile.role === 'Admin';
        const isManager = loggedInUserProfile.role === 'Manager' && loggedInUserProfile.departmentId === userProfile?.departmentId;
        const isSelf = currentUser?.uid === userId;
        return isAdmin || isManager || isSelf;
    }, [loggedInUserProfile, userProfile, currentUser, userId]);

    const recentTickets = useMemo(() => {
        const all = [...(assignedTickets || []), ...(createdTickets || [])];
        return all
            .filter((value, index, self) => index === self.findIndex((t) => t.id === value.id))
            .sort((a, b) => {
                const dateA = toDate(a.updatedAt)?.getTime() || 0;
                const dateB = toDate(b.updatedAt)?.getTime() || 0;
                return dateB - dateA;
            });
    }, [assignedTickets, createdTickets]);

    const handleExport = () => {
        if (!userProfile) return;

        const openCount = assignedTickets?.filter(t => t.status === 'Open' || t.status === 'In Progress').length || 0;
        const resolvedCount = assignedTickets?.filter(t => t.status === 'Resolved').length || 0;
        const closedCount = assignedTickets?.filter(t => t.status === 'Closed').length || 0;

        const now = new Date();
        const today = startOfToday();
        const weekStart = startOfWeek(now);
        const monthStart = startOfMonth(now);

        let todayBusyMinutes = 0;
        let weekBusyMinutes = 0;
        let monthBusyMinutes = 0;
        let firstActivityToday: Date | null = null;

        sessions?.forEach(session => {
            const start = toDate(session.startedAt);
            if (!start) return;
            const duration = session.durationInMinutes || 0;

            if (isWithinInterval(start, { start: today, end: now })) {
                todayBusyMinutes += duration;
                if (!firstActivityToday || start < firstActivityToday) {
                    firstActivityToday = start;
                }
            }
            if (isWithinInterval(start, { start: weekStart, end: now })) {
                weekBusyMinutes += duration;
            }
            if (isWithinInterval(start, { start: monthStart, end: now })) {
                monthBusyMinutes += duration;
            }
        });

        if (userProfile.status === 'Busy' && userProfile.currentSessionStartedAt) {
            const start = toDate(userProfile.currentSessionStartedAt);
            if (start) {
                const currentDuration = Math.max(0, differenceInMinutes(now, start));
                todayBusyMinutes += currentDuration;
                weekBusyMinutes += currentDuration;
                monthBusyMinutes += currentDuration;
                if (!firstActivityToday || start < firstActivityToday) {
                    firstActivityToday = start;
                }
            }
        }

        let todayAvailableMinutes = 0;
        if (firstActivityToday) {
            const totalElapsedToday = differenceInMinutes(now, firstActivityToday);
            todayAvailableMinutes = Math.max(0, totalElapsedToday - todayBusyMinutes);
        }

        const formatHoursDec = (mins: number) => (mins / 60).toFixed(2) + 'h';

        const reportData = [{
            'User Name': userProfile.name,
            'Email': userProfile.email,
            'Role': userProfile.role,
            'Department': departmentsMap.get(userProfile.departmentId || '') || 'N/A',
            'Open Tickets': openCount,
            'Resolved Tickets': resolvedCount,
            'Closed Tickets': closedCount,
            'Today Busy Hours': formatHoursDec(todayBusyMinutes),
            'Today Available Hours': formatHoursDec(todayAvailableMinutes),
            'This Week Busy Hours': formatHoursDec(weekBusyMinutes),
            'This Month Busy Hours': formatHoursDec(monthBusyMinutes),
            'Total Tickets Involved': recentTickets.length,
            'Report Generated At': format(new Date(), 'yyyy-MM-dd HH:mm')
        }];

        const worksheet = XLSX.utils.json_to_sheet(reportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Performance Summary");

        XLSX.writeFile(workbook, `${userProfile.name.replace(/\s+/g, '_')}_Performance_Report.xlsx`);
    };

    if (isLoading) {
        return (
             <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-4">
                    <Skeleton className="h-28" />
                    <Skeleton className="h-28" />
                    <Skeleton className="h-28" />
                    <Skeleton className="h-28" />
                </div>
                 <div className="grid md:grid-cols-3 gap-6">
                    <div className="md:col-span-1 space-y-6">
                      <Skeleton className="h-64" />
                      <Skeleton className="h-64" />
                    </div>
                    <Skeleton className="md:col-span-2 h-96" />
                </div>
            </div>
        )
    }

    if (!userProfile) {
        return <Card><CardHeader><CardTitle>User not found</CardTitle></CardHeader><CardContent><p>The user you are looking for does not exist.</p></CardContent></Card>;
    }
    
    const avatarUrl = userProfile.avatarUrl || `https://api.dicebear.com/9.x/initials/svg?seed=${userProfile.name.replace(/\s/g, '+')}&backgroundColor=1e40af`;
    const departmentName = userProfile.departmentId ? departmentsMap.get(userProfile.departmentId) || userProfile.departmentId : 'N/A';
    const isAvailable = userProfile.status === 'Available';
    
    const displayTickets = recentTickets.slice(0, 10);

    return (
        <div className="space-y-6">
             <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
                <StatCard title="Tickets Assigned" value={assignedTickets?.length || 0} icon={<UserCheck />} />
                <StatCard title="Tickets Created" value={createdTickets?.length || 0} icon={<Ticket />} />
                <StatCard title="Tickets Resolved" value={resolvedTicketsCount} icon={<CheckCheck />} />
                <StatCard title="Tickets Closed" value={closedTicketsCount} icon={<XCircle />} />
            </div>

            {canSeeWorkHours && (
                <div className="grid grid-cols-1 gap-6">
                    <WorkHoursStats userId={userId} userProfile={userProfile} />
                </div>
            )}

            <div className="grid md:grid-cols-3 gap-6 items-start">
                <div className="md:col-span-1 space-y-6">
                    <Card>
                        <CardHeader className="items-center text-center">
                            <Avatar className="h-24 w-24 border mb-4">
                                <AvatarImage src={avatarUrl} alt={userProfile.name} />
                                <AvatarFallback>{userProfile.name.charAt(0) || 'U'}</AvatarFallback>
                            </Avatar>
                            <div>
                                <CardTitle className="text-2xl">{userProfile.name}</CardTitle>
                                <CardDescription>{userProfile.email}</CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent className="text-sm">
                            <div className="flex justify-between py-2 border-b">
                                <span className="text-muted-foreground">Role</span>
                                <span className="font-medium">{userProfile.role}</span>
                            </div>
                            <div className="flex justify-between py-2 border-b">
                                <span className="text-muted-foreground">Department</span>
                                <span className="font-medium">{departmentName}</span>
                            </div>
                            <div className="flex justify-between py-2 border-b">
                                <span className="text-muted-foreground">Availability</span>
                                <span className="flex items-center gap-2 font-medium">
                                    <div className={cn("h-2 w-2 rounded-full", isAvailable ? "bg-green-500" : "bg-red-500")} />
                                    {userProfile.status || 'Available'}
                                </span>
                            </div>
                            <div className="flex justify-between pt-2">
                                <span className="text-muted-foreground">Login Status</span>
                                {userProfile.authId ? (
                                    <span className="flex items-center gap-2 font-medium text-green-600">
                                    <CheckCircle className="h-4 w-4" />
                                    <span>Active</span>
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-2 font-medium text-amber-600">
                                    <ShieldAlert className="h-4 w-4" />
                                    <span>No Login</span>
                                    </span>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                    {userProfile.role === 'Manager' && userProfile.departmentId && (
                        <DepartmentEmployeesCard
                            departmentId={userProfile.departmentId}
                            departmentName={departmentName}
                        />
                    )}
                </div>
                 <Card className="md:col-span-2">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle>Performance Summary</CardTitle>
                                <CardDescription>Export activity metrics and work hours tracking.</CardDescription>
                            </div>
                            <Button variant="outline" size="sm" onClick={handleExport} className="gap-2">
                                <Download className="h-4 w-4" />
                                Export Summary
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            <p className="text-sm font-semibold mb-2">Recent Ticket Activity (Preview)</p>
                            {displayTickets.length > 0 ? (
                                <Table>
                                    <TableHeader>
                                    <TableRow>
                                        <TableHead>Subject</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Last Updated</TableHead>
                                    </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                    {displayTickets.map((ticket) => (
                                        <TableRow key={ticket.id} onClick={() => router.push(`/tickets/${ticket.id}`)} className="cursor-pointer">
                                            <TableCell className="font-medium">{ticket.subject}</TableCell>
                                            <TableCell><TicketStatusBadge status={ticket.status} /></TableCell>
                                            <TableCell>{format(toDate(ticket.updatedAt) || new Date(), 'PP')}</TableCell>
                                        </TableRow>
                                    ))}
                                    </TableBody>
                                </Table>
                            ) : (
                                <p className="text-sm text-muted-foreground text-center py-10">No recent ticket activity found for this user.</p>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}

export default UserDetailsPage;

'use client';
import { useUser, useFirebase, useDoc, useMemoFirebase, useCollection } from "@/firebase";
import { doc, collection, query, orderBy } from "firebase/firestore";
import type { UserProfile, SystemLog } from '@/lib/types';
import { format } from 'date-fns';
import { useRouter } from "next/navigation";

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
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const eventTypeColors: Record<string, string> = {
    USER_CREATED: 'bg-green-100 text-green-800 border-green-200',
    USER_DELETED: 'bg-red-100 text-red-800 border-red-200',
    USER_LOGIN_CREATED: 'bg-blue-100 text-blue-800 border-blue-200',
    TICKET_REPLY: 'bg-gray-100 text-gray-800 border-gray-200',
    TICKET_REASSIGNED: 'bg-cyan-100 text-cyan-800 border-cyan-200',
    DEPARTMENT_CREATED: 'bg-purple-100 text-purple-800 border-purple-200',
    DEPARTMENT_UPDATED: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    DEPARTMENT_DELETED: 'bg-red-100 text-red-800 border-red-200',
    SUBJECT_CREATED: 'bg-purple-100 text-purple-800 border-purple-200',
    SUBJECT_UPDATED: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    SUBJECT_DELETED: 'bg-red-100 text-red-800 border-red-200',
};


function SystemLogTable() {
    const { firestore } = useFirebase();
    const router = useRouter();

    const logsQuery = useMemoFirebase(() => 
        firestore ? query(collection(firestore, 'system-logs'), orderBy('timestamp', 'desc')) : null,
        [firestore]
    );
    const { data: logs, isLoading } = useCollection<SystemLog>(logsQuery);
    
    const handleRowClick = (log: SystemLog) => {
        if ((log.eventType === 'TICKET_REPLY' || log.eventType === 'TICKET_REASSIGNED') && log.details?.ticketId) {
            router.push(`/tickets/${log.details.ticketId}`);
        }
    }

    if (isLoading) {
        return (
            <div className="space-y-2">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
        );
    }

    if (!logs || logs.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed rounded-lg">
                <ScrollText className="w-12 h-12 text-muted-foreground" />
                <p className="mt-4 text-muted-foreground">No system log entries found.</p>
            </div>
        )
    }

    return (
        <div className="rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-[200px]">Timestamp</TableHead>
                        <TableHead className="w-[180px]">Event Type</TableHead>
                        <TableHead>Message</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {logs.map(log => {
                        const isClickable = (log.eventType === 'TICKET_REPLY' || log.eventType === 'TICKET_REASSIGNED') && log.details?.ticketId;
                        return (
                            <TableRow 
                                key={log.id} 
                                onClick={() => handleRowClick(log)}
                                className={isClickable ? 'cursor-pointer' : ''}
                            >
                                <TableCell className="text-sm text-muted-foreground">
                                    {format(log.timestamp.toDate(), 'PPP p')}
                                </TableCell>
                                <TableCell>
                                    <Badge variant="outline" className={eventTypeColors[log.eventType] || ''}>
                                        {log.eventType}
                                    </Badge>
                                </TableCell>
                                <TableCell>{log.message}</TableCell>
                            </TableRow>
                        )
                    })}
                </TableBody>
            </Table>
        </div>
    );
}


export default function SystemLogPage() {
    const { user: currentUser, isUserLoading } = useUser();
    const { firestore } = useFirebase();

    const userProfileRef = useMemoFirebase(() => 
        currentUser && firestore ? doc(firestore, 'users', currentUser.uid) : null,
        [currentUser, firestore]
    );
    const { data: userProfile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef);

    const isLoading = isUserLoading || isProfileLoading;

    if (isLoading) {
        return (
            <div className="space-y-8 max-w-4xl mx-auto">
                <Skeleton className="h-96 w-full" />
            </div>
        );
    }

    if (userProfile?.role !== 'Admin') {
        return (
            <Card className="max-w-2xl mx-auto">
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                </CardHeader>
                <CardContent>
                    <p>You must be an administrator to view the system log.</p>
                </CardContent>
            </Card>
        );
    }

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>System Log</CardTitle>
          <CardDescription>A real-time stream of important system events.</CardDescription>
        </CardHeader>
        <CardContent>
            <SystemLogTable />
        </CardContent>
      </Card>
    </div>
  );
}

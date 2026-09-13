'use client';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { Ticket } from '@/lib/types';
import { format, subDays } from 'date-fns';
import { useMemo, useState } from 'react';
import { ScrollArea } from '../ui/scroll-area';
import { Timestamp } from 'firebase/firestore';

interface OverdueTicketsProps {
  tickets: Ticket[];
}

const toDate = (timestamp: Timestamp | string): Date => {
  if (timestamp instanceof Timestamp) {
    return timestamp.toDate();
  }
  if (!timestamp) return new Date();
  return new Date(timestamp);
};


export function OverdueTickets({ tickets }: OverdueTicketsProps) {
  const [days, setDays] = useState('30');

  const overdueTickets = useMemo(() => {
    const thresholdDate = subDays(new Date(), 3); // Overdue if older than 3 days
    const dateLimit = subDays(new Date(), parseInt(days));

    return tickets
      .filter(ticket => {
        const isOverdue =
          (ticket.status === 'Open' || ticket.status === 'In Progress' || ticket.status?.toLowerCase() === 'open') &&
          toDate(ticket.createdAt) < thresholdDate;

        const isInDateRange = toDate(ticket.createdAt) > dateLimit;

        return isOverdue && isInDateRange;
      })
      .sort((a, b) => toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime());
  }, [tickets, days]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Overdue Tickets ({overdueTickets.length})</CardTitle>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select date range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Last 30 Days</SelectItem>
              <SelectItem value="60">Last 60 Days</SelectItem>
              <SelectItem value="90">Last 90 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-full max-h-[800px]">
            <div className="space-y-6">
            {overdueTickets.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">No overdue tickets.</p>
            ) : (
                overdueTickets.map(ticket => {
                  const creatorName = ticket.createdBy?.name || (ticket as any).from || 'Unknown';
                  const creatorEmail = ticket.createdBy?.email || (ticket as any).from || '';
                  const avatarUrl = ticket.createdBy?.avatarUrl || '';
                  
                  return (
                    <div key={ticket.id} className="flex items-center gap-4">
                        <Avatar className="h-10 w-10 border">
                            <AvatarImage src={avatarUrl} alt={creatorName} />
                            <AvatarFallback>{creatorName.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 space-y-1">
                            <p className="text-sm font-medium leading-none">{creatorEmail || creatorName}</p>
                            <div className="w-2/3 h-2 bg-muted rounded-full"></div>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            {format(toDate(ticket.createdAt), 'MMM d, h:mm a')}
                        </p>
                    </div>
                  )
                })
            )}
            </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

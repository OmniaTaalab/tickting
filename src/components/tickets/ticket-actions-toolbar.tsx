'use client';

import { useTransition } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import type { UserProfile, TicketStatus } from '@/lib/types';
import { bulkUpdateTicketsAction } from '@/actions/ticket_bulk_update';
import { useToast } from '@/hooks/use-toast';
import { Button } from '../ui/button';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/hooks/use-language';

export function TicketActionsToolbar({
  selectedTicketIds,
  onClear,
}: {
  selectedTicketIds: string[];
  onClear: () => void;
}) {
  const { firestore } = useFirebase();
  const { toast } = useToast();
  const { t } = useLanguage();
  
  const [isStatusPending, startStatusTransition] = useTransition();
  const [isAssigneePending, startAssigneeTransition] = useTransition();

  // ONLY FETCH EMPLOYEES FOR BULK ASSIGNMENT
  const employeesQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(
      collection(firestore, 'users'),
      where('role', '==', 'Employee')
    );
  }, [firestore]);
  const { data: employees, isLoading: areEmployeesLoading } = useCollection<UserProfile>(employeesQuery);

  const handleStatusChange = (newStatus: TicketStatus) => {
    if (!newStatus) return;
    
    startStatusTransition(async () => {
      const formData = new FormData();
      selectedTicketIds.forEach(id => formData.append('ticketIds', id));
      formData.append('status', newStatus);
      
      toast({ title: 'Processing...', description: 'Updating ticket statuses.' });
      const result = await bulkUpdateTicketsAction({ success: false }, formData);

      if (result.success) {
        toast({ title: '✅ Success!', description: result.message });
        onClear();
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
      }
    });
  };

  const handleAssigneeChange = (newAssigneeId: string) => {
    if (!newAssigneeId) return;

    startAssigneeTransition(async () => {
        const formData = new FormData();
        selectedTicketIds.forEach(id => formData.append('ticketIds', id));
        formData.append('assigneeId', newAssigneeId);

        toast({ title: 'Processing...', description: 'Updating ticket assignees.' });
        const result = await bulkUpdateTicketsAction({ success: false }, formData);

        if (result.success) {
            toast({ title: '✅ Success!', description: result.message });
            onClear();
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.message });
        }
    });
  };
  
  const isPending = isStatusPending || isAssigneePending;


  return (
    <div className="flex items-center gap-2 md:gap-4 p-2 rounded-md border bg-muted">
      <div className="flex items-center gap-2 flex-1">
         {isPending && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        <p className="text-sm font-medium whitespace-nowrap">
          {selectedTicketIds.length} selected
        </p>
      </div>
      <Select onValueChange={handleStatusChange} disabled={isPending}>
        <SelectTrigger className="w-full sm:w-[150px] bg-background">
          <SelectValue placeholder="Change status..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="Open">{t('open')}</SelectItem>
          <SelectItem value="In Progress">{t('inProgress')}</SelectItem>
          <SelectItem value="Resolved">{t('resolved')}</SelectItem>
          <SelectItem value="Queue">{t('queue')}</SelectItem>
          <SelectItem value="Duplicate">{t('duplicate')}</SelectItem>
        </SelectContent>
      </Select>
      <Select onValueChange={handleAssigneeChange} disabled={areEmployeesLoading || isPending}>
        <SelectTrigger className="w-full sm:w-[150px] bg-background">
          <SelectValue placeholder={areEmployeesLoading ? "Loading..." : "Assign to..."} />
        </SelectTrigger>
        <SelectContent>
           <SelectItem value="unassigned">Unassigned</SelectItem>
          {employees?.map((employee) => (
            <SelectItem key={employee.id} value={employee.id}>
              {employee.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="ghost" size="sm" onClick={onClear} disabled={isPending}>
        Clear
      </Button>
    </div>
  );
}

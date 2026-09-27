'use client';

import { useState, useTransition } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCollection, useFirebase, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, query, doc } from 'firebase/firestore';
import type { UserProfile, TicketStatus } from '@/lib/types';
import { bulkUpdateTicketsAction } from '@/actions/ticket_bulk_update';
import { bulkDeleteTicketsAction } from '@/actions/ticket_delete';
import { useToast } from '@/hooks/use-toast';
import { Button } from '../ui/button';
import { Loader2, Trash2, AlertTriangle, UserCheck } from 'lucide-react';
import { useLanguage } from '@/hooks/use-language';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function TicketActionsToolbar({
  selectedTicketIds,
  onClear,
}: {
  selectedTicketIds: string[];
  onClear: () => void;
}) {
  const { firestore } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { t, isRTL } = useLanguage();
  
  const [isStatusPending, startStatusTransition] = useTransition();
  const [isAssigneePending, startAssigneeTransition] = useTransition();
  const [isDeletePending, startDeleteTransition] = useTransition();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  // Fetch current user profile to verify role
  const userProfileRef = useMemoFirebase(() => {
    if (!user || !firestore) return null;
    return doc(firestore, 'users', user.uid);
  }, [user, firestore]);
  const { data: userProfile } = useDoc<UserProfile>(userProfileRef);

  const isAdmin = userProfile?.role === 'Admin';

  // Fetch all staff users for assignment
  const usersQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'users'));
  }, [firestore]);
  const { data: allUsers, isLoading: areUsersLoading } = useCollection<UserProfile>(usersQuery);

  // Filter staff who can receive tickets (Employees, Managers, Admins)
  const assignableUsers = (allUsers || []).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const handleStatusChange = (newStatus: TicketStatus) => {
    if (!newStatus || selectedTicketIds.length === 0) return;
    
    startStatusTransition(async () => {
      const formData = new FormData();
      selectedTicketIds.forEach(id => formData.append('ticketIds', id));
      formData.append('status', newStatus);
      
      toast({ title: t('loading'), description: t('statusUpdated') });
      const result = await bulkUpdateTicketsAction({ success: false }, formData);

      if (result.success) {
        toast({ title: '✅ ' + t('approved'), description: result.message });
        onClear();
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message || 'Failed to update ticket status.' });
      }
    });
  };

  const handleAssigneeChange = (newAssigneeId: string) => {
    if (!newAssigneeId || selectedTicketIds.length === 0) return;

    startAssigneeTransition(async () => {
      const formData = new FormData();
      selectedTicketIds.forEach(id => formData.append('ticketIds', id));
      formData.append('assigneeId', newAssigneeId);

      toast({ title: t('loading'), description: t('assignPerson') });
      const result = await bulkUpdateTicketsAction({ success: false }, formData);

      if (result.success) {
        toast({ title: '✅ ' + t('approved'), description: result.message });
        onClear();
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message || 'Failed to assign tickets.' });
      }
    });
  };

  const handleConfirmBulkDelete = () => {
    if (!user || !isAdmin || selectedTicketIds.length === 0) return;

    startDeleteTransition(async () => {
      toast({
        title: t('bulkDeleting', { count: String(selectedTicketIds.length) }),
        description: t('loading'),
      });

      const result = await bulkDeleteTicketsAction(selectedTicketIds, {
        userId: user.uid,
        name: userProfile?.name || user.displayName || 'Admin',
      });

      if (result.success) {
        toast({
          title: '✅ ' + t('bulkDeleteSuccess', { count: String(result.deletedCount || selectedTicketIds.length) }),
          description: result.message,
        });
        setIsDeleteDialogOpen(false);
        onClear();
      } else {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: result.message || 'Failed to delete selected tickets.',
        });
      }
    });
  };
  
  const isPending = isStatusPending || isAssigneePending || isDeletePending;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 md:gap-4 p-2.5 rounded-xl border border-slate-200 bg-slate-50/90 shadow-sm backdrop-blur-sm">
        <div className="flex items-center gap-2.5 min-w-fit">
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
          ) : (
            <div className="h-2 w-2 rounded-full bg-primary animate-pulse shrink-0" />
          )}
          <span className="text-xs font-bold text-slate-700 whitespace-nowrap bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs">
            {t('selectedCount', { count: String(selectedTicketIds.length) })}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Select onValueChange={handleStatusChange} disabled={isPending}>
            <SelectTrigger className="w-auto min-w-[130px] sm:w-[150px] h-8 text-xs font-semibold bg-white border-slate-200">
              <SelectValue placeholder={t('changeStatusPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Open">{t('open')}</SelectItem>
              <SelectItem value="In Progress">{t('inProgress')}</SelectItem>
              <SelectItem value="Resolved">{t('resolved')}</SelectItem>
              <SelectItem value="Queue">{t('queue')}</SelectItem>
              <SelectItem value="Duplicate">{t('duplicate')}</SelectItem>
            </SelectContent>
          </Select>

          <Select onValueChange={handleAssigneeChange} disabled={areUsersLoading || isPending}>
            <SelectTrigger className="w-auto min-w-[130px] sm:w-[160px] h-8 text-xs font-semibold bg-white border-slate-200">
              <SelectValue placeholder={areUsersLoading ? t('loading') : t('assignToPlaceholder')} />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              <SelectItem value="unassigned">
                <span className="italic text-slate-500">{t('unassigned')}</span>
              </SelectItem>
              {assignableUsers.map((staff) => (
                <SelectItem key={staff.id} value={staff.id}>
                  <div className="flex items-center gap-2">
                    <span 
                      className={cn(
                        "h-2 w-2 rounded-full shrink-0", 
                        staff.status === 'Busy' ? "bg-rose-500" : "bg-emerald-500"
                      )} 
                    />
                    <span className="truncate">{staff.name}</span>
                    {staff.role && (
                      <span className="text-[10px] text-slate-400">({staff.role})</span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsDeleteDialogOpen(true)}
              disabled={isPending}
              className="h-8 text-xs font-bold bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100 hover:text-rose-700 hover:border-rose-300 gap-1.5 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>{t('bulkDelete')}</span>
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={isPending}
            className="h-8 text-xs font-medium text-slate-500 hover:text-slate-900"
          >
            {t('clearSelection')}
          </Button>
        </div>
      </div>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent className="sm:max-w-[440px]">
          <AlertDialogHeader className="text-start">
            <div className="flex items-center gap-2.5 text-rose-600 mb-1">
              <div className="p-2 rounded-lg bg-rose-100/80 text-rose-600">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <AlertDialogTitle className="text-base font-bold text-slate-900">
                {t('bulkDeleteConfirmTitle')}
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-xs leading-relaxed text-slate-600 pt-1">
              {t('bulkDeleteConfirmDesc', { count: String(selectedTicketIds.length) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0 mt-3">
            <AlertDialogCancel disabled={isDeletePending} className="text-xs font-semibold h-9">
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirmBulkDelete();
              }}
              disabled={isDeletePending}
              className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs h-9 px-4 gap-1.5 shadow-sm"
            >
              {isDeletePending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{t('bulkDeleting', { count: String(selectedTicketIds.length) })}</span>
                </>
              ) : (
                <>
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{t('bulkDelete')} ({selectedTicketIds.length})</span>
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}


'use client';
import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Loader2, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { UserProfile } from '@/lib/types';
import { deleteUserAction } from '@/actions/user_delete';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useUser } from '@/firebase';

interface DeleteUserDialogProps {
  user: UserProfile | null;
  isOpen: boolean;
  onClose: () => void;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} variant="destructive" className="font-bold">
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Delete User & Revoke Access
    </Button>
  );
}

export function DeleteUserDialog({ user, isOpen, onClose }: DeleteUserDialogProps) {
  const { toast } = useToast();
  const { user: currentUser } = useUser();
  const [state, dispatch] = useActionState(deleteUserAction, { success: false, message: null, errors: {} });

  useEffect(() => {
    if (state.success && isOpen) {
      toast({
        title: '✅ User Deleted',
        description: state.message,
      });
      onClose();
    }
  }, [state.success, state.message, onClose, toast, isOpen]);

  if (!user || !currentUser) return null;

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="sm:max-w-md">
        <form action={dispatch}>
            <input type="hidden" name="userId" value={user.id} />
            <input type="hidden" name="authId" value={user.authId || ''} />
            <input type="hidden" name="userName" value={user.name} />
            <input type="hidden" name="actorId" value={currentUser.uid} />
            <input type="hidden" name="actorName" value={currentUser.displayName || 'Admin'} />

            <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-bold">Permanently delete user?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-500">
                This will delete <strong>{user.name}</strong> from the database and <strong>permanently revoke their login access</strong>. This action cannot be undone.
            </AlertDialogDescription>
            </AlertDialogHeader>
             {state.errors?.form && (
                <Alert variant="destructive" className="mt-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>
                       {state.errors.form.join(', ')}
                    </AlertDescription>
                </Alert>
            )}
            <AlertDialogFooter className="mt-6 gap-2">
                <AlertDialogCancel type="button" onClick={onClose} className="rounded-xl">Cancel</AlertDialogCancel>
                <SubmitButton />
            </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

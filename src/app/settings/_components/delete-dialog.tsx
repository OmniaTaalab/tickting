'use client';
import { useActionState, useEffect, useRef } from 'react';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useUser } from '@/firebase';

interface DeleteDialogProps {
  item: { id: string, name: string } | null;
  isOpen: boolean;
  onClose: () => void;
  action: (prevState: any, formData: FormData) => Promise<any>;
  itemType: string;
}

export function DeleteDialog({ item, isOpen, onClose, action, itemType }: DeleteDialogProps) {
  const { toast } = useToast();
  const { user: currentUser } = useUser();
  const [state, dispatch, isPending] = useActionState(action, { success: false, message: null, errors: {} });
  const lastProcessedRef = useRef<any>(null);

  useEffect(() => {
    if (state !== lastProcessedRef.current) {
        if (state.success && isOpen) {
            toast({ title: '✅ Success!', description: state.message });
            onClose();
        }
        lastProcessedRef.current = state;
    }
  }, [state, onClose, toast, isOpen]);

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        {item && currentUser ? (
            <form action={dispatch}>
                <input type="hidden" name="id" value={item.id} />
                <input type="hidden" name="name" value={item.name} />
                <input type="hidden" name="actorId" value={currentUser.uid} />
                <input type="hidden" name="actorName" value={currentUser.displayName || 'Admin'} />

                <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete the <strong>{item.name}</strong> {itemType}.
                </AlertDialogDescription>
                </AlertDialogHeader>
                {state.errors?.form && (
                    <Alert variant="destructive" className="mt-4">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Error</AlertTitle>
                        <AlertDescription>{state.errors.form.join(', ')}</AlertDescription>
                    </Alert>
                )}
                <AlertDialogFooter className="mt-4">
                    <AlertDialogCancel type="button" disabled={isPending}>Cancel</AlertDialogCancel>
                    <Button 
                    type="submit" 
                    disabled={isPending} 
                    variant="destructive"
                    className="font-bold"
                    >
                        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Delete {itemType}
                    </Button>
                </AlertDialogFooter>
            </form>
        ) : (
            <div className="flex justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

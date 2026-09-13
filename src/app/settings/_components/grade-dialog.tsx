'use client';
import { useActionState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { Grade } from '@/lib/types';
import { createOrUpdateGradeAction } from '@/actions/grade_actions';
import { useUser } from '@/firebase';

const GradeSchema = z.object({
  name: z.string().min(1, 'Grade name is required.'),
});

interface GradeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  grade: Grade | null;
}

function GradeForm({ grade, onClose }: { grade: Grade | null, onClose: () => void }) {
    const { toast } = useToast();
    const { user: currentUser } = useUser();
    const [state, dispatch, isPending] = useActionState(createOrUpdateGradeAction, { success: false, message: null, errors: {} });
    const lastProcessedRef = useRef<any>(null);

    const form = useForm<z.infer<typeof GradeSchema>>({
        resolver: zodResolver(GradeSchema),
        defaultValues: { name: grade?.name || '' },
    });
    
    useEffect(() => {
        if (state !== lastProcessedRef.current) {
            if (state.success) {
                toast({ title: '✅ Success!', description: state.message });
                onClose();
            } else if (state.message && !state.success) {
                toast({ variant: 'destructive', title: 'Error', description: state.errors?.form?.join(', ') || state.message });
            }
            lastProcessedRef.current = state;
        }
    }, [state, toast, onClose]);
      
    const action = (formData: FormData) => {
        if (grade?.id) {
            formData.append('id', grade.id);
        }
        if (currentUser) {
          formData.append('actorId', currentUser.uid);
          formData.append('actorName', currentUser.displayName || 'Admin');
        }
        dispatch(formData);
    }

    return (
        <Form {...form}>
          <form action={action} className="space-y-4">
            {state.errors?.form && !state.success && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{state.errors.form.join(', ')}</AlertDescription>
              </Alert>
            )}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Grade Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Grade 1" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-2 animate-spin" />}
                {grade ? 'Save Changes' : 'Add Grade'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
    );
}

export function GradeDialog({ isOpen, onClose, grade }: GradeDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{grade ? 'Edit Grade' : 'Add New Grade'}</DialogTitle>
          <DialogDescription>
            {grade ? `Update the name for "${grade.name}".` : 'Create a new grade level.'}
          </DialogDescription>
        </DialogHeader>
        {isOpen && <GradeForm key={grade?.id || 'new'} grade={grade} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

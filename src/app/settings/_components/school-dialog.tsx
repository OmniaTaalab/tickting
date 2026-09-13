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
import type { School } from '@/lib/types';
import { createOrUpdateSchoolAction } from '@/actions/school_actions';
import { useUser } from '@/firebase';

const SchoolSchema = z.object({
  name: z.string().min(1, 'School name is required.'),
});

interface SchoolDialogProps {
  isOpen: boolean;
  onClose: () => void;
  school: School | null;
}

function SchoolForm({ school, onClose }: { school: School | null, onClose: () => void }) {
    const { toast } = useToast();
    const { user: currentUser } = useUser();
    const [state, dispatch, isPending] = useActionState(createOrUpdateSchoolAction, { success: false, message: null, errors: {} });
    const lastProcessedRef = useRef<any>(null);

    const form = useForm<z.infer<typeof SchoolSchema>>({
        resolver: zodResolver(SchoolSchema),
        defaultValues: { name: school?.name || '' },
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
        if (school?.id) {
            formData.append('id', school.id);
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
                  <FormLabel>School Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Al-Amal School" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-2 animate-spin" />}
                {school ? 'Save Changes' : 'Add School'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
    );
}

export function SchoolDialog({ isOpen, onClose, school }: SchoolDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{school ? 'Edit School' : 'Add New School'}</DialogTitle>
          <DialogDescription>
            {school ? `Update the name for "${school.name}".` : 'Create a new school entry.'}
          </DialogDescription>
        </DialogHeader>
        {isOpen && <SchoolForm key={school?.id || 'new'} school={school} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

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
import type { Department } from '@/lib/types';
import { createOrUpdateDepartmentAction } from '@/actions/department_actions';
import { useUser } from '@/firebase';

const DepartmentSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters.'),
});

interface DepartmentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  department: Department | null;
}

function DepartmentForm({ department, onClose }: { department: Department | null, onClose: () => void }) {
    const { toast } = useToast();
    const { user: currentUser } = useUser();
    const [state, dispatch, isPending] = useActionState(createOrUpdateDepartmentAction, { success: false, message: null, errors: {} });
    const lastProcessedRef = useRef<any>(null);

    const form = useForm<z.infer<typeof DepartmentSchema>>({
        resolver: zodResolver(DepartmentSchema),
        defaultValues: { name: department?.name || '' },
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
        if (department?.id) {
            formData.append('id', department.id);
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
                  <FormLabel>Category Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Marketing" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-2 animate-spin" />}
                {department ? 'Save Changes' : 'Add Category'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
    );
}

export function DepartmentDialog({ isOpen, onClose, department }: DepartmentDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{department ? 'Edit Category' : 'Add New Category'}</DialogTitle>
          <DialogDescription>
            {department ? `Update the name for the "${department.name}" category.` : 'Create a new category for routing tickets.'}
          </DialogDescription>
        </DialogHeader>
        {isOpen && <DepartmentForm key={department?.id || 'new'} department={department} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

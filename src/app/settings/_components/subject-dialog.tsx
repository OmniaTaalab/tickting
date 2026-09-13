'use client';
import { useActionState, useEffect } from 'react';
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
import type { Subject, Department } from '@/lib/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createOrUpdateSubjectAction } from '@/actions/subject_actions';
import { useUser } from '@/firebase';

const SubjectSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters.'),
  departmentId: z.string().min(1, 'You must select a department.'),
});

interface SubjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  subject: Subject | null;
  departments: Department[];
}

function SubjectForm({ subject, departments, onClose }: { subject: Subject | null, departments: Department[], onClose: () => void }) {
  const { toast } = useToast();
  const { user: currentUser } = useUser();
  const [state, dispatch, isPending] = useActionState(createOrUpdateSubjectAction, { success: false, message: null, errors: {} });

  const form = useForm<z.infer<typeof SubjectSchema>>({
    resolver: zodResolver(SubjectSchema),
    defaultValues: {
      name: subject?.name || '',
      departmentId: subject?.departmentId || '',
    },
  });

  useEffect(() => {
    if (state.success) {
      toast({ title: '✅ Success!', description: state.message });
      onClose();
    } else if (state.message && !state.success) {
      toast({ variant: 'destructive', title: 'Error', description: state.errors?.form?.join(', ') || state.message });
    }
  }, [state, toast, onClose]);

  const action = (formData: FormData) => {
    if (subject?.id) {
      formData.append('id', subject.id);
    }
    if (currentUser) {
      formData.append('actorId', currentUser.uid);
      formData.append('actorName', currentUser.displayName || 'Admin');
    }
    dispatch(formData);
  };

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
              <FormLabel>Subject Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g., Password Reset" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="departmentId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Department</FormLabel>
              <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger disabled={!departments.length}>
                    <SelectValue placeholder={!departments.length ? "No departments available" : "Select a department"} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {departments.map((dept) => (
                    <SelectItem key={dept.id} value={dept.id}>
                      {dept.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="mr-2 animate-spin" />}
            {subject ? 'Save Changes' : 'Add Subject'}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

export function SubjectDialog({ isOpen, onClose, subject, departments }: SubjectDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{subject ? 'Edit Subject' : 'Add New Subject'}</DialogTitle>
          <DialogDescription>
            {subject ? `Update the subject "${subject.name}".` : 'Create a new ticket subject and link it to a department.'}
          </DialogDescription>
        </DialogHeader>
        {isOpen && <SubjectForm key={subject?.id || 'new'} subject={subject} departments={departments} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
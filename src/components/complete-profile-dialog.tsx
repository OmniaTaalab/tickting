'use client';

import { useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, setDocumentNonBlocking, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc, query } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { UserProfile, Department } from '@/lib/types';

interface CompleteProfileDialogProps {
  user: User;
  onProfileComplete: () => void;
}

const ProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters.'),
  role: z.enum(['Admin', 'Employee', 'Manager']),
  departmentId: z.string().optional(),
});

export function CompleteProfileDialog({ user, onProfileComplete }: CompleteProfileDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { firestore } = useFirebase();
  const { toast } = useToast();

  const departmentsQuery = useMemoFirebase(() => 
    firestore ? query(collection(firestore, 'departments')) : null,
    [firestore]
  );
  const { data: departments } = useCollection<Department>(departmentsQuery);

  const form = useForm<z.infer<typeof ProfileSchema>>({
    resolver: zodResolver(ProfileSchema),
    defaultValues: {
      name: user.displayName || '',
      role: undefined,
      departmentId: '',
    },
  });

  async function onSubmit(values: z.infer<typeof ProfileSchema>) {
    if (!firestore) {
      toast({ variant: 'destructive', title: 'Database connection not found.' });
      return;
    }
    setIsSubmitting(true);

    const userRef = doc(firestore, 'users', user.uid);
    
    const newUserProfile: Omit<UserProfile, 'id' | 'email'> & { email: string } = {
      name: values.name,
      email: user.email || '',
      avatarUrl: user.photoURL || `https://api.dicebear.com/9.x/initials/svg?seed=${values.name.replace(/\s/g, '+')}&backgroundColor=1e40af`,
      role: values.role,
    };

    if (values.departmentId) {
        newUserProfile.departmentId = values.departmentId;
    }

    try {
        setDocumentNonBlocking(userRef, newUserProfile, { merge: true });
        toast({
            title: 'Profile Updated!',
            description: 'Your information has been saved.',
        });
        onProfileComplete();
    } catch (error: any) {
        toast({
            variant: 'destructive',
            title: 'Error updating profile',
            description: error.message || 'An unexpected error occurred.',
        });
    } finally {
        setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={true} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Complete Your Profile</DialogTitle>
          <DialogDescription>
            Welcome! Please fill out your details to continue.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Jane Doe" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                      <SelectTrigger>
                          <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                          <SelectItem value="Admin">Admin</SelectItem>
                          <SelectItem value="Employee">Employee</SelectItem>
                          <SelectItem value="Manager">Manager</SelectItem>
                      </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
             <FormField
                control={form.control}
                name="departmentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Department (Optional)</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                        <SelectTrigger>
                            <SelectValue placeholder="Select a department" />
                        </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                        {departments?.map((dept) => (
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
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save and Continue
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

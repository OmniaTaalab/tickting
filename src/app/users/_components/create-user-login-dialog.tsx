'use client';

import { useActionState, useEffect, useTransition } from 'react';
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
import type { UserProfile } from '@/lib/types';
import { createAuthUserForUserAction } from '@/actions/auth_create';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useUser } from '@/firebase';

// ✅ Schema
const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6, 'Password must be at least 6 characters.'),
});

interface CreateUserLoginDialogProps {
  user: UserProfile;
  isOpen: boolean;
  onClose: () => void;
}

export function CreateUserLoginDialog({ user, isOpen, onClose }: CreateUserLoginDialogProps) {
  const { toast } = useToast();
  const { user: currentUser } = useUser();
  const [state, dispatch] = useActionState(createAuthUserForUserAction, { success: false, message: null, errors: {} });

  const form = useForm<z.infer<typeof LoginSchema>>({
    resolver: zodResolver(LoginSchema),
    defaultValues: {
      email: user.email || '',
      password: '',
    },
  });

  useEffect(() => {
    if (state?.success) {
        toast({
            title: '✅ Login Created!',
            description: state.message,
        });
        form.reset();
        onClose();
    }
  }, [state, form, toast, onClose]);


  const action = (formData: FormData) => {
    formData.append('userId', user.id);
    if (currentUser) {
        formData.append('actorId', currentUser.uid);
        formData.append('actorName', currentUser.displayName || 'Admin');
    }
    dispatch(formData);
  }
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Login for {user.name}</DialogTitle>
          <DialogDescription>
            Set a password for this user to allow them to log in.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form action={action} className="space-y-4">
             {state?.errors?.form && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <AlertTitle>Configuration Required</AlertTitle>
                    <AlertDescription className="text-xs break-words mt-1">
                       {state.errors.form.map((err, idx) => (
                         <div key={idx} className="space-y-1">
                           <p>{err}</p>
                           {err.includes('https://console.developers.google.com') && (
                             <a
href={`https://console.developers.google.com/apis/api/identitytoolkit.googleapis.com/overview?project=${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}`}
                               rel="noreferrer"
                               className="inline-flex items-center gap-1 font-semibold underline bg-white/20 hover:bg-white/30 px-2 py-1 rounded text-white text-xs mt-1"
                             >
                               Enable Identity Toolkit API in Google Cloud ↗
                             </a>
                           )}
                         </div>
                       ))}
                    </AlertDescription>
                </Alert>
            )}
            {/* Email */}
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input placeholder="user@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Password */}
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Login
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

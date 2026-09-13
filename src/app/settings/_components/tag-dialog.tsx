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
import { createOrUpdateTagAction } from '@/actions/tag_actions';
import { useUser } from '@/firebase';

const TagSchema = z.object({
  name: z.string().min(1, 'Tag name is required.'),
});

interface TagDialogProps {
  isOpen: boolean;
  onClose: () => void;
  tag: { id: string; name: string } | null;
}

function TagForm({ tag, onClose }: { tag: { id: string; name: string } | null, onClose: () => void }) {
    const { toast } = useToast();
    const { user: currentUser } = useUser();
    const [state, dispatch, isPending] = useActionState(createOrUpdateTagAction, { success: false, message: null, errors: {} });
    const lastProcessedRef = useRef<any>(null);

    const form = useForm<z.infer<typeof TagSchema>>({
        resolver: zodResolver(TagSchema),
        defaultValues: { name: tag?.name || '' },
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
        if (tag?.id) {
            formData.append('id', tag.id);
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
                  <FormLabel>Tag Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., urgent, follow-up" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-2 animate-spin" />}
                {tag ? 'Save Changes' : 'Add Tag'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
    );
}

export function TagDialog({ isOpen, onClose, tag }: TagDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tag ? 'Edit Tag' : 'Add Predefined Tag'}</DialogTitle>
          <DialogDescription>
            {tag ? `Update the name for tag "${tag.name}".` : 'Create a new tag that staff can select for tickets.'}
          </DialogDescription>
        </DialogHeader>
        {isOpen && <TagForm key={tag?.id || 'new'} tag={tag} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

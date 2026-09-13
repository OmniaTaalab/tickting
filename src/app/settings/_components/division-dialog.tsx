'use client';
import { useActionState, useEffect, useState, useRef } from 'react';
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
import { Loader2, AlertCircle, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { Division } from '@/lib/types';
import { createOrUpdateDivisionAction } from '@/actions/division_actions';
import { useUser } from '@/firebase';
import { cn } from '@/lib/utils';

const DivisionSchema = z.object({
  name: z.string().min(1, 'Division name is required.'),
  color: z.string().min(1, 'Color selection is required.'),
});

interface DivisionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  division: Division | null;
}

const COLOR_OPTIONS = [
    { dot: '#ec4899', bg: '#fce7f3' }, // Pink
    { dot: '#3b82f6', bg: '#dbeafe' }, // Blue
    { dot: '#10b981', bg: '#dcfce7' }, // Green
    { dot: '#f59e0b', bg: '#fef3c7' }, // Amber
    { dot: '#4f46e5', bg: '#e0e7ff' }, // Indigo
    { dot: '#64748b', bg: '#f1f5f9' }, // Slate
    { dot: '#f97316', bg: '#ffedd5' }, // Orange
    { dot: '#ef4444', bg: '#fee2e2' }, // Red
    { dot: '#14b8a6', bg: '#ccfbf1' }, // Teal
    { dot: '#1e3a8a', bg: '#dbeafe' }, // Dark Blue
    { dot: '#a855f7', bg: '#f3e8ff' }, // Purple
    { dot: '#84cc16', bg: '#ecfccb' }, // Lime
];

function DivisionForm({ division, onClose }: { division: Division | null, onClose: () => void }) {
    const { toast } = useToast();
    const { user: currentUser } = useUser();
    const [state, dispatch, isPending] = useActionState(createOrUpdateDivisionAction, { success: false, message: null, errors: {} });
    const lastProcessedRef = useRef<any>(null);

    const form = useForm<z.infer<typeof DivisionSchema>>({
        resolver: zodResolver(DivisionSchema),
        defaultValues: { 
            name: division?.name || '', 
            color: division?.color || '#3b82f6' 
        },
    });
    
    const [selectedColor, setSelectedColor] = useState(division?.color || '#3b82f6');

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
        if (division?.id) {
            formData.append('id', division.id);
        }
        if (currentUser) {
          formData.append('actorId', currentUser.uid);
          formData.append('actorName', currentUser.displayName || 'Admin');
        }
        formData.append('color', selectedColor);
        dispatch(formData);
    }

    return (
        <Form {...form}>
          <form action={action} className="space-y-6 pt-4">
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
                  <FormLabel className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Name</FormLabel>
                  <FormControl>
                    <Input 
                        placeholder="e.g. Secondary School" 
                        className="h-10 border-slate-200 bg-white focus:ring-indigo-500"
                        {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormItem>
                <FormLabel className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Colour</FormLabel>
                <div className="flex flex-wrap gap-2.5 pt-1">
                    {COLOR_OPTIONS.map((option) => (
                        <button
                            key={option.dot}
                            type="button"
                            onClick={() => setSelectedColor(option.dot)}
                            className={cn(
                                "relative w-8 h-8 rounded-lg transition-all flex items-center justify-center",
                                selectedColor === option.dot 
                                    ? "ring-2 ring-slate-800 ring-offset-2 scale-110 shadow-sm" 
                                    : "hover:scale-105"
                            )}
                            style={{ backgroundColor: option.bg }}
                        >
                            <div 
                                className="w-2.5 h-2.5 rounded-full" 
                                style={{ backgroundColor: option.dot }}
                            />
                        </button>
                    ))}
                </div>
            </FormItem>

            <DialogFooter className="pt-4 gap-2">
              <Button type="button" variant="ghost" className="text-slate-500 font-medium" onClick={onClose}>Cancel</Button>
              <Button 
                type="submit" 
                disabled={isPending}
                className="bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white min-w-[120px]"
              >
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {division ? 'Save Changes' : 'Add division'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
    );
}

export function DivisionDialog({ isOpen, onClose, division }: DivisionDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md p-6">
        <DialogHeader className="border-b pb-4 mb-2">
          <DialogTitle className="text-xl font-bold text-slate-800">
            {division ? 'Edit division' : 'Add division'}
          </DialogTitle>
        </DialogHeader>
        {isOpen && <DivisionForm key={division?.id || 'new'} division={division} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

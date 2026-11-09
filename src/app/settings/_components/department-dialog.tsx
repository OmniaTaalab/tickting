'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { Department, Campus } from '@/lib/types';
import { createOrUpdateDepartmentAction } from '@/actions/department_actions';
import { useCollection, useFirebase, useMemoFirebase, useUser } from '@/firebase';
import { collection, orderBy, query } from 'firebase/firestore';
import { MultiSelect } from '@/components/multi-select';

interface DepartmentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  department: Department | null;
}

function DepartmentForm({ department, onClose }: { department: Department | null; onClose: () => void }) {
  const { toast } = useToast();
  const { user: currentUser } = useUser();
  const { firestore } = useFirebase();
  const [state, dispatch, isPending] = useActionState(createOrUpdateDepartmentAction, { success: false, message: null, errors: {} });
  const lastProcessedRef = useRef<any>(null);

  const [name, setName] = useState(department?.name || '');
  const [campusIds, setCampusIds] = useState<string[]>(department?.campusIds || []);

  const campusesQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'campuses'), orderBy('name', 'asc')) : null), [firestore]);
  const { data: campuses } = useCollection<Campus>(campusesQuery);

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
    if (department?.id) formData.append('id', department.id);
    if (currentUser) {
      formData.append('actorId', currentUser.uid);
      formData.append('actorName', currentUser.displayName || 'Admin');
    }
    formData.append('name', name);
    campusIds.forEach((id) => formData.append('campusIds', id));
    dispatch(formData);
  };

  return (
    <form action={action} className="space-y-5">
      {state.errors?.form && !state.success && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{state.errors.form.join(', ')}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-1.5 text-start">
        <Label htmlFor="dept-name" className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Category Name</Label>
        <Input id="dept-name" placeholder="e.g., Academic" value={name} onChange={(e) => setName(e.target.value)} className="h-11" required minLength={2} />
        {state.errors?.name && <p className="text-[10px] text-destructive font-bold">{state.errors.name.join(', ')}</p>}
      </div>
      <div className="space-y-1.5 text-start">
        <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Campuses</Label>
        <MultiSelect
          options={(campuses || []).map((c) => ({ id: c.id, label: c.name }))}
          value={campusIds}
          onChange={setCampusIds}
          placeholder="All campuses"
          bulkActions
        />
        <p className="text-[11px] text-slate-400">
          Leave empty for a category that exists on every campus. When set, employees and email queues of this category can only be placed on these campuses.
        </p>
        {state.errors?.campusIds && <p className="text-[10px] text-destructive font-bold">{state.errors.campusIds.join(', ')}</p>}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={isPending || name.trim().length < 2} className="bg-[#1e3a8a] text-white font-bold">
          {isPending && <Loader2 className="me-2 animate-spin h-4 w-4" />}
          {department ? 'Save Changes' : 'Add Category'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function DepartmentDialog({ isOpen, onClose, department }: DepartmentDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{department ? 'Edit Category' : 'Add New Category'}</DialogTitle>
          <DialogDescription>
            {department ? `Update "${department.name}" and the campuses it operates on.` : 'Create a category for routing tickets and choose the campuses it operates on.'}
          </DialogDescription>
        </DialogHeader>
        {isOpen && <DepartmentForm key={department?.id || 'new'} department={department} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

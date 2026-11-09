'use client';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
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
import { createAuthUserForUserAction } from '@/actions/auth_create';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCollection, useFirebase, useMemoFirebase, useUser } from '@/firebase';
import { collection, query } from 'firebase/firestore';
import type { Department, UserProfile } from '@/lib/types';
import { ScopeSelector, ScopeHiddenInputs, emptyScope, type ScopeValue } from '@/components/scope-selector';

interface CreateUserDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserProfile: UserProfile;
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} className="bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white font-bold h-11 px-8 rounded-xl">
      {pending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
      Create User
    </Button>
  );
}

export function CreateUserDialog({ isOpen, onClose, currentUserProfile }: CreateUserDialogProps) {
  const { toast } = useToast();
  const { user: actor } = useUser();
  const { firestore } = useFirebase();
  const [state, dispatch] = useActionState(createAuthUserForUserAction, { success: false, message: null, errors: {} });
  const lastState = useRef<any>(null);

  const isManager = currentUserProfile.role === 'Manager';
  const [selectedRole, setSelectedRole] = useState<string>(isManager ? 'Employee' : '');
  const [scope, setScope] = useState<ScopeValue>({ ...emptyScope('structure'), departmentId: isManager ? currentUserProfile.departmentId || '' : '' });

  const departmentsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'departments')) : null), [firestore]);
  const { data: departments } = useCollection<Department>(departmentsQuery);

  useEffect(() => {
    if (state !== lastState.current) {
      if (state?.success) {
        toast({ title: '✅ Success', description: state.message || 'User created successfully' });
        onClose();
      } else if (state?.message && !state?.success) {
        toast({ variant: 'destructive', title: 'Error', description: state.errors?.form?.join(', ') || state.message });
      }
      lastState.current = state;
    }
  }, [state, toast, onClose]);

  const isCreatingStaff = isManager || selectedRole === 'Employee' || selectedRole === 'Manager';
  const managerCampuses = isManager ? currentUserProfile.campusIds || null : null;

  const scopeComplete = useMemo(() => {
    if (!isCreatingStaff) return true;
    if (scope.mode === 'mailbox') return scope.mailboxIds.length > 0 && !!scope.departmentId;
    return scope.campusIds.length > 0 && !!scope.departmentId;
  }, [isCreatingStaff, scope]);

  const scopeErrors = {
    departmentId: state?.errors?.departmentId,
    campusIds: state?.errors?.campusIds,
    schoolIds: state?.errors?.schoolIds,
    divisionIds: state?.errors?.divisionIds,
    gradeIds: state?.errors?.gradeIds,
    mailboxIds: (state?.errors as any)?.mailboxIds,
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="text-start">
          <DialogTitle className="text-xl font-bold text-slate-800">
            {isManager ? 'Add Employee to Your Category' : 'Add New User'}
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            {isManager
              ? `Create a new account within the ${departments?.find((d) => d.id === currentUserProfile.departmentId)?.name || 'your'} category.`
              : 'Create a new user account with login credentials.'}
          </DialogDescription>
        </DialogHeader>

        <form action={dispatch} className="space-y-5 pt-2">
          {state?.errors?.form && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <AlertTitle>Configuration Required</AlertTitle>
              <AlertDescription className="text-xs break-words mt-1">
                {state.errors.form.map((err, idx) => (
                  <div key={idx} className="space-y-2">
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

          <input type="hidden" name="actorId" value={actor?.uid || currentUserProfile?.id || 'system'} />
          <input type="hidden" name="actorName" value={actor?.displayName || currentUserProfile?.name || 'Admin'} />

          {isManager ? (
            <input type="hidden" name="role" value="Employee" />
          ) : (
            <div className="space-y-1.5 text-start">
              <Label htmlFor="role" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Role</Label>
              <input type="hidden" name="role" value={selectedRole} />
              <Select onValueChange={setSelectedRole} value={selectedRole || undefined} required>
                <SelectTrigger id="role" className="h-11 border-slate-200">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Admin">Admin</SelectItem>
                  <SelectItem value="Employee">Employee</SelectItem>
                  <SelectItem value="Manager">Manager</SelectItem>
                </SelectContent>
              </Select>
              {state?.errors?.role && <p className="text-[10px] text-destructive font-bold">{state.errors.role.join(', ')}</p>}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 text-start sm:col-span-2">
              <Label htmlFor="name" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Full Name</Label>
              <Input id="name" name="name" placeholder="e.g., John Doe" required className="h-11 border-slate-200" />
              {state?.errors?.name && <p className="text-[10px] text-destructive font-bold">{state.errors.name.join(', ')}</p>}
            </div>
            <div className="space-y-1.5 text-start">
              <Label htmlFor="email" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Email</Label>
              <Input id="email" name="email" type="email" placeholder="e.g., john.doe@example.com" required className="h-11 border-slate-200" />
              {state?.errors?.email && <p className="text-[10px] text-destructive font-bold">{state.errors.email.join(', ')}</p>}
            </div>
            <div className="space-y-1.5 text-start">
              <Label htmlFor="password" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Password</Label>
              <Input id="password" name="password" type="password" placeholder="••••••••" required className="h-11 border-slate-200" />
              {state?.errors?.password && <p className="text-[10px] text-destructive font-bold">{state.errors.password.join(', ')}</p>}
            </div>
          </div>

          {isCreatingStaff && (
            <div className="space-y-3 pt-4 border-t border-slate-100 text-start">
              <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Scope</Label>
              <ScopeSelector
                value={scope}
                onChange={setScope}
                allowedCampusIds={managerCampuses}
                lockedDepartmentId={isManager ? currentUserProfile.departmentId || null : null}
                errors={scopeErrors}
              />
              <ScopeHiddenInputs value={scope} />
            </div>
          )}

          <DialogFooter className="gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="h-11 rounded-xl border-slate-200">Cancel</Button>
            <SubmitButton disabled={!selectedRole || !scopeComplete} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

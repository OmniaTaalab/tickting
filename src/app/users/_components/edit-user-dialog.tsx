'use client';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
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
import { Loader2, AlertCircle, Lock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { updateUserAction } from '@/actions/user_update';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useUser } from '@/firebase';
import type { UserProfile } from '@/lib/types';
import { useLanguage } from '@/hooks/use-language';
import { ScopeSelector, ScopeHiddenInputs, type ScopeValue } from '@/components/scope-selector';

interface EditUserDialogProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserProfile;
  currentUserProfile: UserProfile;
}

const scopeFromUser = (user: UserProfile): ScopeValue => ({
  mode: user.scopeMode === 'mailbox' || (!user.scopeMode && (user.mailboxIds?.length || 0) > 0) ? 'mailbox' : 'structure',
  departmentId: user.departmentId || '',
  campusIds: user.campusIds || [],
  schoolIds: user.schoolIds || (user.schoolId ? [user.schoolId] : []),
  divisionIds: user.divisionIds || [],
  gradeIds: user.gradeIds || [],
  mailboxIds: user.mailboxIds || [],
});

export function EditUserDialog({ isOpen, onClose, user, currentUserProfile }: EditUserDialogProps) {
  const { toast } = useToast();
  const { user: actor } = useUser();
  const { t } = useLanguage();
  const [state, dispatch, isPending] = useActionState(updateUserAction, { success: false, message: null, errors: {} });
  const lastState = useRef<any>(null);

  const [userName, setUserName] = useState(user.name);
  const [selectedRole, setSelectedRole] = useState<string>(user.role);
  const [scope, setScope] = useState<ScopeValue>(() => scopeFromUser(user));

  useEffect(() => {
    setUserName(user.name);
    setSelectedRole(user.role);
    setScope(scopeFromUser(user));
  }, [user]);

  const isAdmin = currentUserProfile.role === 'Admin';
  const isManager = currentUserProfile.role === 'Manager';

  const canEditTarget = useMemo(() => {
    if (isAdmin) return true;
    if (isManager) {
      const actorCampuses = currentUserProfile.campusIds || [];
      const targetCampuses = user.campusIds || [];
      return targetCampuses.some((id) => actorCampuses.includes(id)) || user.id === currentUserProfile.id;
    }
    return user.id === currentUserProfile.id;
  }, [isAdmin, isManager, currentUserProfile, user]);

  useEffect(() => {
    if (state !== lastState.current) {
      if (state.success) {
        toast({ title: '✅ User Updated!', description: state.message });
        onClose();
      } else if (state.message && !state.success && state.errors?.form) {
        toast({ variant: 'destructive', title: 'Error', description: state.errors.form.join(', ') });
      }
      lastState.current = state;
    }
  }, [state, toast, onClose]);

  const showOrgFields = (isAdmin || isManager) && selectedRole !== 'Admin';
  const scopeComplete = useMemo(() => {
    if (!showOrgFields) return true;
    if (scope.mode === 'mailbox') return scope.mailboxIds.length > 0 && !!scope.departmentId;
    return scope.campusIds.length > 0 && !!scope.departmentId;
  }, [showOrgFields, scope]);

  const scopeErrors = {
    departmentId: state.errors?.departmentId,
    campusIds: state.errors?.campusIds,
    schoolIds: state.errors?.schoolIds,
    divisionIds: state.errors?.divisionIds,
    gradeIds: state.errors?.gradeIds,
    mailboxIds: (state.errors as any)?.mailboxIds,
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="text-start">
          <DialogTitle className="text-xl font-bold text-slate-800">{t('edit')} — {user.name}</DialogTitle>
          <DialogDescription className="text-slate-500">
            Update the profile, role and the campuses, schools and divisions this person serves.
          </DialogDescription>
        </DialogHeader>

        {!canEditTarget ? (
          <Alert variant="destructive">
            <Lock className="h-4 w-4" />
            <AlertTitle>Permission denied</AlertTitle>
            <AlertDescription>You can only manage staff within your assigned campuses.</AlertDescription>
          </Alert>
        ) : (
          <form action={dispatch} className="space-y-5 pt-2">
            {state.errors?.form && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{state.errors.form.join(', ')}</AlertDescription>
              </Alert>
            )}

            <input type="hidden" name="userId" value={user.id} />
            <input type="hidden" name="actorId" value={actor?.uid || currentUserProfile.id} />
            <input type="hidden" name="actorName" value={actor?.displayName || currentUserProfile.name || 'Admin'} />
            <input type="hidden" name="role" value={selectedRole} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5 text-start">
                <Label htmlFor="edit-name" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Full Name</Label>
                <Input id="edit-name" name="name" value={userName} onChange={(e) => setUserName(e.target.value)} required className="h-11 border-slate-200" />
                {state.errors?.name && <p className="text-[10px] text-destructive font-bold">{state.errors.name.join(', ')}</p>}
              </div>
              <div className="space-y-1.5 text-start">
                <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Role</Label>
                <Select value={selectedRole} onValueChange={setSelectedRole} disabled={!isAdmin}>
                  <SelectTrigger className="h-11 border-slate-200"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Admin">Admin</SelectItem>
                    <SelectItem value="Employee">Employee</SelectItem>
                    <SelectItem value="Manager">Manager</SelectItem>
                  </SelectContent>
                </Select>
                {!isAdmin && <p className="text-[10px] text-slate-400">Only administrators can change roles.</p>}
              </div>
              <div className="space-y-1.5 text-start sm:col-span-2">
                <Label htmlFor="edit-password" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">New password (optional)</Label>
                <Input id="edit-password" name="password" type="password" placeholder="Leave empty to keep the current password" className="h-11 border-slate-200" />
              </div>
            </div>

            {showOrgFields && (
              <div className="space-y-3 pt-4 border-t border-slate-100 text-start">
                <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Scope</Label>
                <ScopeSelector
                  value={scope}
                  onChange={setScope}
                  allowedCampusIds={isManager ? currentUserProfile.campusIds || null : null}
                  lockedDepartmentId={isManager ? currentUserProfile.departmentId || null : null}
                  errors={scopeErrors}
                />
                <ScopeHiddenInputs value={scope} />
              </div>
            )}

            <DialogFooter className="gap-3 pt-4">
              <Button type="button" variant="outline" onClick={onClose} disabled={isPending} className="h-11 rounded-xl border-slate-200">Cancel</Button>
              <Button type="submit" disabled={isPending || !scopeComplete} className="bg-[#1e3a8a] text-white font-bold h-11 px-8 rounded-xl shadow-md">
                {isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

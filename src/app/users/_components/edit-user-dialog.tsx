'use client';
import { useActionState, useEffect, useState, useMemo } from 'react';
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
import { Loader2, AlertCircle, ChevronDown, Check, Lock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { updateUserAction } from '@/actions/user_update';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCollection, useFirebase, useMemoFirebase, useUser } from '@/firebase';
import { collection, query } from 'firebase/firestore';
import type { Department, UserProfile, Division, Campus } from '@/lib/types';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/hooks/use-language';

interface EditUserDialogProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserProfile;
  currentUserProfile: UserProfile;
}

export function EditUserDialog({ isOpen, onClose, user, currentUserProfile }: EditUserDialogProps) {
  const { toast } = useToast();
  const { user: actor } = useUser();
  const { t } = useLanguage();
  const [state, dispatch, isPending] = useActionState(updateUserAction, { success: false, message: null, errors: {} });
  const { firestore } = useFirebase();
  
  // Controlled states for stability
  const [userName, setUserName] = useState(user.name);
  const [selectedRole, setSelectedRole] = useState<string>(user.role);
  const [selectedDivs, setSelectedDivs] = useState<string[]>(user.divisionIds || []);
  const [selectedCampuses, setSelectedCampuses] = useState<string[]>(user.campusIds || []);

  const isAdmin = currentUserProfile.role === 'Admin';
  const isManager = currentUserProfile.role === 'Manager';

  const departmentsQuery = useMemoFirebase(() => 
    firestore ? query(collection(firestore, 'departments')) : null,
    [firestore]
  );
  const { data: departments, isLoading: areDepartmentsLoading } = useCollection<Department>(departmentsQuery);

  const divisionsQuery = useMemoFirebase(() => 
    firestore ? query(collection(firestore, 'divisions')) : null,
    [firestore]
  );
  const { data: divisions, isLoading: areDivisionsLoading } = useCollection<Division>(divisionsQuery);

  const campusesQuery = useMemoFirebase(() => 
    firestore ? query(collection(firestore, 'campuses')) : null,
    [firestore]
  );
  const { data: campuses, isLoading: areCampusesLoading } = useCollection<Campus>(campusesQuery);

  const filteredCampuses = useMemo(() => {
    if (!campuses) return [];
    if (isAdmin) return campuses;
    const myCampusIds = currentUserProfile.campusIds || [];
    if (myCampusIds.length > 0) {
        return campuses.filter(c => myCampusIds.includes(c.id));
    }
    return campuses;
  }, [campuses, currentUserProfile, isAdmin]);

  // Authorization check for Manager
  const canEditTarget = useMemo(() => {
    if (isAdmin) return true;
    if (isManager) {
        const actorCampuses = currentUserProfile.campusIds || [];
        const targetCampuses = user.campusIds || [];
        return targetCampuses.some(id => actorCampuses.includes(id)) || user.id === currentUserProfile.id;
    }
    return user.id === currentUserProfile.id;
  }, [isAdmin, isManager, currentUserProfile, user]);

  useEffect(() => {
    if (state.success) {
      toast({
        title: '✅ User Updated!',
        description: state.message,
      });
      onClose();
    }
  }, [state.success, state.message, toast, onClose]);

  const showOrgFields = (isAdmin || isManager) && selectedRole !== 'Admin';

  const toggleDivision = (id: string) => {
    setSelectedDivs(prev => 
        prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleCampus = (id: string) => {
    setSelectedCampuses(prev => 
        prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  if (!canEditTarget) {
      return (
          <Dialog open={isOpen} onOpenChange={onClose}>
              <DialogContent>
                  <DialogHeader>
                      <DialogTitle>Access Denied</DialogTitle>
                      <DialogDescription>
                          You do not have permission to edit users outside of your assigned campuses.
                      </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                      <Button onClick={onClose}>Close</Button>
                  </DialogFooter>
              </DialogContent>
          </Dialog>
      );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit User: {user.name}</DialogTitle>
          <DialogDescription>
             Update the details for this user profile.
          </DialogDescription>
        </DialogHeader>
        
          <form action={dispatch} className="space-y-4 pt-2">
             {(state.errors?.form || state.message && !state.success) && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>
                       {state.errors?.form?.join(', ') || state.message}
                    </AlertDescription>
                </Alert>
            )}
            
            <input type="hidden" name="userId" value={user.id} />
            {!isAdmin && <input type="hidden" name="role" value={selectedRole} />}
            {isManager && <input type="hidden" name="departmentId" value={user.departmentId || ''} />}
            
            {actor && (
              <>
                <input type="hidden" name="actorId" value={actor.uid} />
                <input type="hidden" name="actorName" value={actor.displayName || 'Admin'} />
              </>
            )}
            
            <div className="space-y-2">
                <Label htmlFor="name" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Full Name</Label>
                <Input 
                    id="name" 
                    name="name" 
                    value={userName} 
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder="e.g. John Doe"
                    required 
                    className="h-11 border-slate-200"
                />
                {state.errors?.name && <p className="text-[10px] text-destructive font-bold">{state.errors.name.join(', ')}</p>}
            </div>

            <div className="space-y-2">
                <Label htmlFor="email" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Email</Label>
                <Input id="email" name="email" type="email" defaultValue={user.email} disabled className="bg-slate-50 border-slate-200" />
            </div>

            <div className="space-y-2 p-4 bg-amber-50/30 border border-amber-100 rounded-xl">
                <Label htmlFor="password" className="text-[10px] font-bold text-amber-700 uppercase tracking-widest flex items-center gap-1">
                    <Lock className="h-3 w-3" /> {t('newPassword')}
                </Label>
                <Input 
                    id="password" 
                    name="password" 
                    type="password" 
                    placeholder={t('passwordPlaceholder')} 
                    className="h-10 border-slate-200 bg-white"
                />
                <p className="text-[9px] text-slate-400 italic">Leave blank to keep current password.</p>
            </div>
            
            {isAdmin ? (
              <div className="space-y-2">
                  <Label htmlFor="role" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Role</Label>
                  <input type="hidden" name="role" value={selectedRole} />
                  <Select defaultValue={user.role} onValueChange={setSelectedRole} required>
                      <SelectTrigger id="role" className="h-11 border-slate-200">
                          <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                      <SelectContent>
                          <SelectItem value="Admin">Admin</SelectItem>
                          <SelectItem value="Employee">Employee</SelectItem>
                          <SelectItem value="Manager">Manager</SelectItem>
                      </SelectContent>
                  </Select>
                  {state.errors?.role && <p className="text-[10px] text-destructive font-bold">{state.errors.role.join(', ')}</p>}
              </div>
            ) : (
                <div className="space-y-1 pt-1">
                    <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Role</Label>
                    <p className="text-sm font-bold text-slate-700">{user.role}</p>
                </div>
            )}

            {showOrgFields && (
                <div className="space-y-4 pt-2 border-t border-slate-50">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="departmentId" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Category <span className="text-destructive">*</span></Label>
                            <Select name="departmentId" defaultValue={user.departmentId} disabled={isManager} required>
                                <SelectTrigger id="departmentId" className="h-11 border-slate-200" disabled={areDepartmentsLoading || isManager}>
                                    <SelectValue placeholder={areDepartmentsLoading ? "Loading..." : "Select Category"} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">None</SelectItem>
                                    {departments?.map((dept) => (
                                        <SelectItem key={dept.id} value={dept.id}>
                                            {dept.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {isManager && <p className="text-[9px] text-slate-400 italic">Managers cannot change departments.</p>}
                            {state.errors?.departmentId && <p className="text-[10px] text-destructive font-bold">{state.errors.departmentId.join(', ')}</p>}
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="divisionIds" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Divisions</Label>
                            {selectedDivs.map(id => <input key={id} type="hidden" name="divisionIds" value={id} />)}
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button 
                                        variant="outline" 
                                        className="h-auto min-h-[44px] w-full justify-between border-slate-200 bg-white hover:bg-white px-3 font-normal"
                                        disabled={areDivisionsLoading}
                                    >
                                        <div className="flex flex-wrap gap-1">
                                            {selectedDivs.length > 0 ? (
                                                selectedDivs.map(id => {
                                                    const div = divisions?.find(d => d.id === id);
                                                    return (
                                                        <Badge 
                                                            key={id} 
                                                            variant="secondary" 
                                                            className="bg-slate-100 text-slate-700 text-[10px] px-1.5 py-0 h-5"
                                                        >
                                                            {div?.name}
                                                        </Badge>
                                                    );
                                                })
                                            ) : (
                                                <span className="text-slate-400">Select Divisions</span>
                                            )}
                                        </div>
                                        <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[220px] p-0" align="start">
                                    <div className="p-2 space-y-1 max-h-[300px] overflow-y-auto">
                                        {divisions?.map((div) => (
                                            <div 
                                                key={div.id}
                                                onClick={() => toggleDivision(div.id)}
                                                className="flex items-center gap-2 p-2 rounded-md hover:bg-slate-50 cursor-pointer transition-colors"
                                            >
                                                <Checkbox 
                                                    id={`div-edit-${div.id}`} 
                                                    checked={selectedDivs.includes(div.id)}
                                                    onCheckedChange={() => toggleDivision(div.id)}
                                                    className="h-4 w-4"
                                                />
                                                <Label 
                                                    htmlFor={`div-edit-${div.id}`} 
                                                    className="text-sm font-medium text-slate-700 flex-1 cursor-pointer"
                                                >
                                                    {div.name}
                                                </Label>
                                            </div>
                                        ))}
                                    </div>
                                </PopoverContent>
                            </Popover>
                            {state.errors?.divisionIds && <p className="text-[10px] text-destructive font-bold">{state.errors.divisionIds.join(', ')}</p>}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="campusIds" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Campuses <span className="text-destructive">*</span></Label>
                        {selectedCampuses.map(id => <input key={id} type="hidden" name="campusIds" value={id} />)}
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button 
                                    variant="outline" 
                                    className="h-auto min-h-[44px] w-full justify-between border-slate-200 bg-white hover:bg-white px-3 font-normal"
                                    disabled={areCampusesLoading}
                                >
                                    <div className="flex flex-wrap gap-1">
                                        {selectedCampuses.length > 0 ? (
                                            selectedCampuses.map(id => {
                                                const cmp = campuses?.find(c => c.id === id);
                                                return (
                                                    <Badge 
                                                        key={id} 
                                                        variant="secondary" 
                                                        className="bg-slate-100 text-slate-700 text-[10px] px-1.5 py-0 h-5"
                                                    >
                                                        {cmp?.name}
                                                    </Badge>
                                                );
                                            })
                                        ) : (
                                            <span className="text-slate-400">Select Campuses</span>
                                        )}
                                    </div>
                                    <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[220px] p-0" align="start">
                                <div className="p-2 space-y-1 max-h-[300px] overflow-y-auto">
                                    {filteredCampuses.map((cmp) => (
                                        <div 
                                            key={cmp.id}
                                            onClick={() => toggleCampus(cmp.id)}
                                            className="flex items-center gap-2 p-2 rounded-md hover:bg-slate-50 cursor-pointer transition-colors"
                                        >
                                            <Checkbox 
                                                id={`cmp-edit-${cmp.id}`} 
                                                checked={selectedCampuses.includes(cmp.id)}
                                                onCheckedChange={() => toggleCampus(cmp.id)}
                                                className="h-4 w-4"
                                            />
                                            <Label 
                                                htmlFor={`cmp-edit-${cmp.id}`} 
                                                className="text-sm font-medium text-slate-700 flex-1 cursor-pointer"
                                            >
                                                {cmp.name}
                                            </Label>
                                        </div>
                                    ))}
                                </div>
                            </PopoverContent>
                        </Popover>
                        {state.errors?.campusIds && <p className="text-[10px] text-destructive font-bold">{state.errors.campusIds.join(', ')}</p>}
                    </div>
                </div>
            )}

            <DialogFooter className="gap-3 pt-6">
              <Button type="button" variant="outline" onClick={onClose} disabled={isPending} className="h-11 rounded-xl border-slate-200">Cancel</Button>
              <Button type="submit" disabled={isPending} className="bg-[#1e3a8a] text-white font-bold h-11 px-8 rounded-xl shadow-md">
                  {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
              </Button>
            </DialogFooter>
          </form>
      </DialogContent>
    </Dialog>
  );
}

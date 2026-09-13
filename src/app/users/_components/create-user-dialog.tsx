'use client';
import { useActionState, useEffect, useState, useMemo } from 'react';
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
import { Loader2, AlertCircle, Check, ChevronDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { createAuthUserForUserAction } from '@/actions/auth_create';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCollection, useFirebase, useMemoFirebase, useUser } from '@/firebase';
import { collection, query } from 'firebase/firestore';
import type { Department, UserProfile, Division, Campus } from '@/lib/types';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';

interface CreateUserDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserProfile: UserProfile;
}

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending} className="bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white font-bold">
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create User
        </Button>
    )
}

export function CreateUserDialog({ isOpen, onClose, currentUserProfile }: CreateUserDialogProps) {
  const { toast } = useToast();
  const { user: actor } = useUser();
  const [state, dispatch] = useActionState(createAuthUserForUserAction, { success: false, message: null, errors: {} });
  const { firestore } = useFirebase();
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [selectedDept, setSelectedDept] = useState<string>('');
  const [selectedDivs, setSelectedDivs] = useState<string[]>([]);
  const [selectedCampuses, setSelectedCampuses] = useState<string[]>([]);

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
    if (currentUserProfile.role === 'Admin') return campuses;
    
    const myCampusIds = currentUserProfile.campusIds || [];
    return campuses.filter(c => myCampusIds.includes(c.id));
  }, [campuses, currentUserProfile]);

  useEffect(() => {
    if (state.success) {
      toast({ title: '✅ Success', description: state.message });
      onClose();
    }
  }, [state.success, state.message, toast, onClose]);

  // Show org fields logic
  const isCreatingStaff = isManager || selectedRole === 'Employee' || selectedRole === 'Manager';
  const showCategorySelect = !isManager && isCreatingStaff;

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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-slate-800">
            {isManager ? 'Add Employee to Your Category' : 'Add New User'}
          </DialogTitle>
          <DialogDescription className="text-slate-500">
             {isManager 
                ? `Create a new account within the ${departments?.find(d => d.id === currentUserProfile.departmentId)?.name || 'your'} category.` 
                : 'Create a new user account with login credentials.'}
          </DialogDescription>
        </DialogHeader>
        
          <form action={dispatch} className="space-y-5 pt-4">
             {state.errors?.form && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{state.errors.form.join(', ')}</AlertDescription>
                </Alert>
            )}

            {actor && (
              <>
                <input type="hidden" name="actorId" value={actor.uid} />
                <input type="hidden" name="actorName" value={actor.displayName || 'Admin'} />
              </>
            )}

             {isManager ? (
                <>
                    <input type="hidden" name="role" value="Employee" />
                    <input type="hidden" name="departmentId" value={currentUserProfile.departmentId} />
                </>
             ) : (
                <div className="space-y-1.5">
                    <Label htmlFor="role" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Role</Label>
                    <input type="hidden" name="role" value={selectedRole} />
                    <Select onValueChange={setSelectedRole} value={selectedRole} required>
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
             )}
            
            <div className="space-y-1.5">
                <Label htmlFor="name" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Full Name</Label>
                <Input id="name" name="name" placeholder="e.g., John Doe" required className="h-11 border-slate-200" />
                {state.errors?.name && <p className="text-[10px] text-destructive font-bold">{state.errors.name.join(', ')}</p>}
            </div>

            <div className="space-y-1.5">
                <Label htmlFor="email" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Email</Label>
                <Input id="email" name="email" type="email" placeholder="e.g., john.doe@example.com" required className="h-11 border-slate-200" />
                {state.errors?.email && <p className="text-[10px] text-destructive font-bold">{state.errors.email.join(', ')}</p>}
            </div>

            <div className="space-y-1.5">
                <Label htmlFor="password" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Password</Label>
                <Input id="password" name="password" type="password" placeholder="••••••••" required className="h-11 border-slate-200" />
                {state.errors?.password && <p className="text-[10px] text-destructive font-bold">{state.errors.password.join(', ')}</p>}
            </div>
            
             {isCreatingStaff && (
                <div className="space-y-4 pt-2 border-t border-slate-50">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="divisionIds" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Divisions <span className="text-destructive">*</span></Label>
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
                                                <span className="text-slate-400">{areDivisionsLoading ? "Loading..." : "Select Divisions"}</span>
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
                                                    id={`div-${div.id}`} 
                                                    checked={selectedDivs.includes(div.id)}
                                                    onCheckedChange={() => toggleDivision(div.id)}
                                                    className="h-4 w-4"
                                                />
                                                <Label 
                                                    htmlFor={`div-${div.id}`} 
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

                        {showCategorySelect ? (
                            <div className="space-y-1.5">
                                <Label htmlFor="departmentId" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Category <span className="text-destructive">*</span></Label>
                                <input type="hidden" name="departmentId" value={selectedDept} />
                                <Select onValueChange={setSelectedDept} value={selectedDept} required>
                                    <SelectTrigger id="departmentId" className="h-11 border-slate-200" disabled={areDepartmentsLoading}>
                                        <SelectValue placeholder={areDepartmentsLoading ? "Loading..." : "Select Category"} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {departments?.map((dept) => (
                                            <SelectItem key={dept.id} value={dept.id}>
                                                {dept.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {state.errors?.departmentId && <p className="text-[10px] text-destructive font-bold">{state.errors.departmentId.join(', ')}</p>}
                            </div>
                        ) : (
                            <div className="flex items-end pb-3">
                                 <p className="text-[10px] text-slate-400 font-medium italic">Category fixed to: {departments?.find(d => d.id === currentUserProfile.departmentId)?.name || '...'}</p>
                            </div>
                        )}
                    </div>

                    <div className="space-y-1.5">
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
                                            <span className="text-slate-400">{areCampusesLoading ? "Loading..." : "Select Campuses"}</span>
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
                                                id={`cmp-${cmp.id}`} 
                                                checked={selectedCampuses.includes(cmp.id)}
                                                onCheckedChange={() => toggleCampus(cmp.id)}
                                                className="h-4 w-4"
                                            />
                                            <Label 
                                                htmlFor={`cmp-${cmp.id}`} 
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
              <Button type="button" variant="outline" onClick={onClose} className="h-11 rounded-xl border-slate-200">Cancel</Button>
              <SubmitButton />
            </DialogFooter>
          </form>
      </DialogContent>
    </Dialog>
  );
}

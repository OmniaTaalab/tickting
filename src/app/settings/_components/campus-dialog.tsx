'use client';
import { useActionState, useEffect, useState, useMemo, useRef } from 'react';
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
import { Loader2, AlertCircle, Plus, Trash2, ChevronDown, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { Campus, School, Grade, CampusSchoolConfig } from '@/lib/types';
import { createOrUpdateCampusAction } from '@/actions/campus_actions';
import { useUser, useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy } from 'firebase/firestore';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface CampusDialogProps {
  isOpen: boolean;
  onClose: () => void;
  campus: Campus | null;
}

function SchoolConfigRow({ 
    config, 
    schools, 
    allGrades, 
    onChange, 
    onRemove 
}: { 
    config: CampusSchoolConfig; 
    schools: School[]; 
    allGrades: Grade[]; 
    onChange: (newConfig: CampusSchoolConfig) => void;
    onRemove: () => void;
}) {
    const handleSchoolChange = (schoolId: string) => {
        onChange({ ...config, schoolId });
    };

    const toggleGrade = (gradeId: string) => {
        const newGrades = config.gradeIds.includes(gradeId)
            ? config.gradeIds.filter(id => id !== gradeId)
            : [...config.gradeIds, gradeId];
        onChange({ ...config, gradeIds: newGrades });
    };

    return (
        <div className="flex flex-col sm:flex-row items-start gap-3 p-4 bg-slate-50 border rounded-xl relative group">
            <div className="flex-1 w-full space-y-2">
                <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">School</Label>
                <Select onValueChange={handleSchoolChange} value={config.schoolId}>
                    <SelectTrigger className="bg-white h-10">
                        <SelectValue placeholder="Select School" />
                    </SelectTrigger>
                    <SelectContent>
                        {schools.map(s => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="flex-1 w-full space-y-2">
                <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Grades</Label>
                <Popover>
                    <PopoverTrigger asChild>
                        <Button 
                            type="button"
                            variant="outline" 
                            className="h-10 w-full justify-between bg-white border-slate-200 px-3 font-normal"
                        >
                            <div className="flex flex-wrap gap-1 overflow-hidden">
                                {config.gradeIds.length > 0 ? (
                                    config.gradeIds.map(id => {
                                        const g = allGrades.find(grade => grade.id === id);
                                        return (
                                            <Badge key={id} variant="secondary" className="bg-slate-100 text-[9px] px-1.5 py-0 h-5">
                                                {g?.name || id}
                                            </Badge>
                                        );
                                    })
                                ) : (
                                    <span className="text-slate-400 text-xs">Select Grades</span>
                                )}
                            </div>
                            <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[200px] p-0" align="start">
                        <div className="p-2 space-y-1 max-h-[250px] overflow-y-auto">
                            {allGrades.map((grade) => (
                                <div 
                                    key={grade.id}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        toggleGrade(grade.id);
                                    }}
                                    className="flex items-center gap-2 p-2 rounded-md hover:bg-slate-50 cursor-pointer transition-colors select-none"
                                >
                                    <Checkbox 
                                        id={`grade-${config.schoolId}-${grade.id}`} 
                                        checked={config.gradeIds.includes(grade.id)}
                                        className="h-4 w-4 pointer-events-none"
                                    />
                                    <span className="text-sm font-medium text-slate-700 flex-1 select-none">{grade.name}</span>
                                </div>
                            ))}
                        </div>
                    </PopoverContent>
                </Popover>
            </div>

            <Button 
                type="button" 
                variant="ghost" 
                size="icon" 
                onClick={onRemove}
                className="h-9 w-9 text-slate-400 hover:text-red-500 hover:bg-red-50 self-end mb-0.5"
            >
                <Trash2 className="h-4 w-4" />
            </Button>
        </div>
    );
}

export function CampusDialog({ isOpen, onClose, campus }: CampusDialogProps) {
  const { toast } = useToast();
  const { user: currentUser } = useUser();
  const { firestore } = useFirebase();
  const [state, dispatch, isPending] = useActionState(createOrUpdateCampusAction, { success: false, message: null, errors: {} });
  const lastProcessedRef = useRef<any>(null);

  const [name, setName] = useState(campus?.name || '');
  const [schoolConfigs, setSchoolConfigs] = useState<CampusSchoolConfig[]>(campus?.schoolConfigs || []);

  const schoolsQuery = useMemoFirebase(() => 
    firestore ? query(collection(firestore, 'schools'), orderBy('name', 'asc')) : null, [firestore]
  );
  const { data: schools } = useCollection<School>(schoolsQuery);

  const gradesQuery = useMemoFirebase(() => 
    firestore ? query(collection(firestore, 'grades'), orderBy('name', 'asc')) : null, [firestore]
  );
  const { data: grades } = useCollection<Grade>(gradesQuery);

  useEffect(() => {
    if (state !== lastProcessedRef.current) {
        if (state.success) {
            toast({ title: '✅ Success!', description: state.message });
            onClose();
        } else if (state.message) {
            // handle errors if needed
        }
        lastProcessedRef.current = state;
    }
  }, [state, toast, onClose]);

  const addSchoolConfig = () => {
    setSchoolConfigs([...schoolConfigs, { schoolId: '', gradeIds: [] }]);
  };

  const updateSchoolConfig = (index: number, newConfig: CampusSchoolConfig) => {
    const updated = [...schoolConfigs];
    updated[index] = newConfig;
    setSchoolConfigs(updated);
  };

  const removeSchoolConfig = (index: number) => {
    setSchoolConfigs(schoolConfigs.filter((_, i) => i !== index));
  };

  const handleAction = (formData: FormData) => {
    if (!currentUser) return;
    formData.append('name', name);
    formData.append('schoolConfigsJson', JSON.stringify(schoolConfigs));
    formData.append('actorId', currentUser.uid);
    formData.append('actorName', currentUser.displayName || 'Admin');
    if (campus?.id) formData.append('id', campus.id);
    dispatch(formData);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto p-0">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="text-xl font-bold">{campus ? 'Edit Campus' : 'Add New Campus'}</DialogTitle>
          <DialogDescription>
            Configure schools and grades for this campus location.
          </DialogDescription>
        </DialogHeader>

        <form action={handleAction} className="p-6 space-y-6">
            {state.errors?.form && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{state.errors.form.join(', ')}</AlertDescription>
                </Alert>
            )}

            <div className="space-y-2">
                <Label htmlFor="campus-name" className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Campus Name</Label>
                <Input 
                    id="campus-name"
                    placeholder="e.g., 1st Settlement" 
                    value={name} 
                    onChange={(e) => setName(e.target.value)}
                    className="h-11 border-slate-200 focus:ring-[#1e3a8a]"
                    required
                />
            </div>

            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">School Configurations</Label>
                    <Button 
                        type="button" 
                        variant="outline" 
                        size="sm" 
                        onClick={addSchoolConfig}
                        className="h-8 border-[#1e3a8a] text-[#1e3a8a] font-bold hover:bg-blue-50"
                    >
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Add School
                    </Button>
                </div>

                <div className="space-y-3">
                    {schoolConfigs.map((config, idx) => (
                        <SchoolConfigRow 
                            key={idx}
                            config={config}
                            schools={schools || []}
                            allGrades={grades || []}
                            onChange={(newC) => updateSchoolConfig(idx, newC)}
                            onRemove={() => removeSchoolConfig(idx)}
                        />
                    ))}
                    {schoolConfigs.length === 0 && (
                        <div className="text-center py-10 border-2 border-dashed rounded-xl bg-slate-50/50 text-slate-400 text-sm italic">
                            No schools added yet. Click "Add School" to start.
                        </div>
                    )}
                </div>
            </div>

            <DialogFooter className="pt-4 sticky bottom-0 bg-white border-t mt-6 -mx-6 px-6 py-4">
              <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>Cancel</Button>
              <Button 
                type="submit" 
                disabled={isPending || !name || schoolConfigs.length === 0} 
                className="bg-[#1e3a8a] text-white font-bold px-8 h-11"
              >
                {isPending && <Loader2 className="mr-2 animate-spin h-4 w-4" />}
                {campus ? 'Save Changes' : 'Create Campus'}
              </Button>
            </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

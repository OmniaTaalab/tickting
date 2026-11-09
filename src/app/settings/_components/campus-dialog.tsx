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
import { Loader2, AlertCircle, Plus, Trash2, Layers } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { Campus, School, Grade, Division, CampusSchoolConfig, CampusDivisionConfig } from '@/lib/types';
import { createOrUpdateCampusAction } from '@/actions/campus_actions';
import { useUser, useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy } from 'firebase/firestore';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MultiSelect } from '@/components/multi-select';
import { divisionsOfSchoolConfig } from '@/lib/org-structure';

interface CampusDialogProps {
  isOpen: boolean;
  onClose: () => void;
  campus: Campus | null;
}

/**
 * Campus structure editor:
 *   campus -> school -> division -> grades
 * Each grade belongs to exactly one division inside a school, so a grade already
 * used by another division of the same school is disabled in the picker.
 */
function DivisionRow({
  config,
  usedGradeIds,
  divisions,
  grades,
  onChange,
  onRemove,
}: {
  config: CampusDivisionConfig;
  usedGradeIds: string[];
  divisions: Division[];
  grades: Grade[];
  onChange: (next: CampusDivisionConfig) => void;
  onRemove: () => void;
}) {
  const gradeOptions = useMemo(
    () =>
      grades.map((g) => ({
        id: g.id,
        label: g.name,
        disabled: usedGradeIds.includes(g.id) && !config.gradeIds.includes(g.id),
      })),
    [grades, usedGradeIds, config.gradeIds]
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.4fr_auto] gap-2 items-start">
      <Select onValueChange={(divisionId) => onChange({ ...config, divisionId })} value={config.divisionId || undefined}>
        <SelectTrigger className="bg-white h-10">
          <SelectValue placeholder="Division" />
        </SelectTrigger>
        <SelectContent>
          {divisions.map((d) => (
            <SelectItem key={d.id} value={d.id}>
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.color || '#94a3b8' }} />
                {d.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <MultiSelect
        options={gradeOptions}
        value={config.gradeIds}
        onChange={(gradeIds) => onChange({ ...config, gradeIds })}
        placeholder="Grades in this division"
        className="min-h-10"
        maxBadges={5}
        bulkActions
      />
      <Button type="button" variant="ghost" size="icon" onClick={onRemove} className="h-10 w-10 text-slate-400 hover:text-red-500 hover:bg-red-50">
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

function SchoolCard({
  config,
  schools,
  divisions,
  grades,
  takenSchoolIds,
  onChange,
  onRemove,
}: {
  config: CampusSchoolConfig;
  schools: School[];
  divisions: Division[];
  grades: Grade[];
  takenSchoolIds: string[];
  onChange: (next: CampusSchoolConfig) => void;
  onRemove: () => void;
}) {
  const divisionConfigs = divisionsOfSchoolConfig(config);
  const usedGradeIds = divisionConfigs.flatMap((d) => d.gradeIds);
  const usedDivisionIds = divisionConfigs.map((d) => d.divisionId);

  const setDivisions = (next: CampusDivisionConfig[]) =>
    onChange({ ...config, divisions: next, gradeIds: Array.from(new Set(next.flatMap((d) => d.gradeIds))) });

  return (
    <div className="p-4 bg-slate-50 border rounded-xl space-y-3">
      <div className="flex items-end gap-3">
        <div className="flex-1 space-y-1.5">
          <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">School</Label>
          <Select onValueChange={(schoolId) => onChange({ ...config, schoolId })} value={config.schoolId || undefined}>
            <SelectTrigger className="bg-white h-10">
              <SelectValue placeholder="Select school" />
            </SelectTrigger>
            <SelectContent>
              {schools.map((s) => (
                <SelectItem key={s.id} value={s.id} disabled={takenSchoolIds.includes(s.id) && s.id !== config.schoolId}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onRemove} className="h-10 w-10 text-slate-400 hover:text-red-500 hover:bg-red-50">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-2 ps-3 border-s-2 border-slate-200">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
            <Layers className="h-3 w-3" /> Divisions and their grades
          </Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-[#1e3a8a] font-bold text-xs"
            onClick={() => setDivisions([...divisionConfigs, { divisionId: '', gradeIds: [] }])}
          >
            <Plus className="h-3.5 w-3.5 me-1" /> Add division
          </Button>
        </div>
        {divisionConfigs.length === 0 && (
          <p className="text-xs text-slate-400 italic py-2">No divisions yet. Add one and pick the grades that belong to it.</p>
        )}
        {divisionConfigs.map((div, idx) => (
          <DivisionRow
            key={idx}
            config={div}
            usedGradeIds={usedGradeIds}
            divisions={divisions.filter((d) => !usedDivisionIds.includes(d.id) || d.id === div.divisionId)}
            grades={grades}
            onChange={(next) => setDivisions(divisionConfigs.map((d, i) => (i === idx ? next : d)))}
            onRemove={() => setDivisions(divisionConfigs.filter((_, i) => i !== idx))}
          />
        ))}
      </div>
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
  const [schoolConfigs, setSchoolConfigs] = useState<CampusSchoolConfig[]>(
    (campus?.schoolConfigs || []).map((c) => ({ ...c, divisions: divisionsOfSchoolConfig(c) }))
  );

  const schoolsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'schools'), orderBy('name', 'asc')) : null), [firestore]);
  const { data: schools } = useCollection<School>(schoolsQuery);
  const divisionsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'divisions'), orderBy('name', 'asc')) : null), [firestore]);
  const { data: divisions } = useCollection<Division>(divisionsQuery);
  const gradesQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'grades'), orderBy('name', 'asc')) : null), [firestore]);
  const { data: grades } = useCollection<Grade>(gradesQuery);

  useEffect(() => {
    if (state !== lastProcessedRef.current) {
      if (state.success) {
        toast({ title: '✅ Success!', description: state.message });
        onClose();
      } else if (state.message && state.errors?.form) {
        toast({ variant: 'destructive', title: 'Error', description: state.errors.form.join(', ') });
      }
      lastProcessedRef.current = state;
    }
  }, [state, toast, onClose]);

  const incomplete = useMemo(
    () =>
      schoolConfigs.some(
        (c) => !c.schoolId || divisionsOfSchoolConfig(c).some((d) => !d.divisionId || d.gradeIds.length === 0)
      ),
    [schoolConfigs]
  );

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
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto p-0">
        <DialogHeader className="p-6 pb-0 text-start">
          <DialogTitle className="text-xl font-bold">{campus ? 'Edit Campus' : 'Add New Campus'}</DialogTitle>
          <DialogDescription>
            Schools on this campus, the divisions inside each school, and the grades each division covers.
            Email queues and employee scopes are derived from this structure.
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
          {state.errors?.schoolConfigsJson && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{state.errors.schoolConfigsJson.join(', ')}</AlertDescription>
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
              <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Schools on this campus</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSchoolConfigs([...schoolConfigs, { schoolId: '', gradeIds: [], divisions: [] }])}
                className="h-8 border-[#1e3a8a] text-[#1e3a8a] font-bold hover:bg-blue-50"
              >
                <Plus className="h-3.5 w-3.5 me-1" />
                Add School
              </Button>
            </div>

            <div className="space-y-3">
              {schoolConfigs.map((config, idx) => (
                <SchoolCard
                  key={idx}
                  config={config}
                  schools={schools || []}
                  divisions={divisions || []}
                  grades={grades || []}
                  takenSchoolIds={schoolConfigs.map((c) => c.schoolId)}
                  onChange={(next) => setSchoolConfigs(schoolConfigs.map((c, i) => (i === idx ? next : c)))}
                  onRemove={() => setSchoolConfigs(schoolConfigs.filter((_, i) => i !== idx))}
                />
              ))}
              {schoolConfigs.length === 0 && (
                <div className="text-center py-10 border-2 border-dashed rounded-xl bg-slate-50/50 text-slate-400 text-sm italic">
                  No schools added yet. Click "Add School" to start.
                </div>
              )}
            </div>
            {incomplete && (
              <p className="text-[11px] text-amber-600 font-medium">
                Every school needs a name, and every division needs a division and at least one grade.
              </p>
            )}
          </div>

          <DialogFooter className="pt-4 sticky bottom-0 bg-white border-t mt-6 -mx-6 px-6 py-4">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button
              type="submit"
              disabled={isPending || !name || schoolConfigs.length === 0 || incomplete}
              className="bg-[#1e3a8a] text-white font-bold px-8 h-11"
            >
              {isPending && <Loader2 className="me-2 animate-spin h-4 w-4" />}
              {campus ? 'Save Changes' : 'Create Campus'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

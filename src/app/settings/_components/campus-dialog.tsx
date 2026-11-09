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
import { Loader2, AlertCircle, Plus, Trash2, GraduationCap, Layers } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { Campus, School, Grade, Division, CampusSchoolConfig, CampusDivisionConfig } from '@/lib/types';
import { createOrUpdateCampusAction } from '@/actions/campus_actions';
import { useUser, useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy } from 'firebase/firestore';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MultiSelect } from '@/components/multi-select';
import { gradesOfSchoolConfig } from '@/lib/org-structure';
import { cn } from '@/lib/utils';

interface CampusDialogProps {
  isOpen: boolean;
  onClose: () => void;
  campus: Campus | null;
}

const NONE = '__none__';

/** grade -> division lookup from the stored divisions[] shape. */
function divisionByGrade(config: CampusSchoolConfig): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of config.divisions || []) {
    if (!d?.divisionId) continue;
    for (const g of d.gradeIds || []) map.set(g, d.divisionId);
  }
  return map;
}

/** Rebuild the stored shape from "grades offered" + "division per grade". */
function buildConfig(schoolId: string, gradeIds: string[], byGrade: Map<string, string>): CampusSchoolConfig {
  const groups = new Map<string, string[]>();
  for (const g of gradeIds) {
    const d = byGrade.get(g);
    if (!d) continue;
    groups.set(d, [...(groups.get(d) || []), g]);
  }
  const divisions: CampusDivisionConfig[] = Array.from(groups, ([divisionId, grades]) => ({ divisionId, gradeIds: grades }));
  return { schoolId, gradeIds, divisions };
}

/**
 * One school on the campus:
 *   1. which grades the school offers here,
 *   2. which division each grade belongs to (one division per grade).
 * Divisions are derived from the per-grade choice, so there is no separate
 * "add division" step to get wrong.
 */
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
  const offered = gradesOfSchoolConfig(config);
  const byGrade = divisionByGrade(config);
  const gradeName = useMemo(() => new Map(grades.map((g) => [g.id, g.name])), [grades]);
  const divisionOf = (id: string) => divisions.find((d) => d.id === id);
  const unassigned = offered.filter((g) => !byGrade.get(g));
  const [bulkDivision, setBulkDivision] = useState<string>('');

  const setOffered = (gradeIds: string[]) => {
    const next = new Map(byGrade);
    for (const g of Array.from(next.keys())) if (!gradeIds.includes(g)) next.delete(g);
    onChange(buildConfig(config.schoolId, gradeIds, next));
  };
  const setDivision = (gradeId: string, divisionId: string) => {
    const next = new Map(byGrade);
    if (divisionId === NONE) next.delete(gradeId);
    else next.set(gradeId, divisionId);
    onChange(buildConfig(config.schoolId, offered, next));
  };
  const assignUnassigned = () => {
    if (!bulkDivision) return;
    const next = new Map(byGrade);
    for (const g of unassigned) next.set(g, bulkDivision);
    onChange(buildConfig(config.schoolId, offered, next));
    setBulkDivision('');
  };

  // Keep grade rows in the order of the global grade list.
  const orderedOffered = grades.filter((g) => offered.includes(g.id)).map((g) => g.id);

  return (
    <div className="p-4 bg-slate-50 border rounded-xl space-y-4">
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

      <div className="space-y-1.5">
        <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
          <GraduationCap className="h-3 w-3" /> Grades offered by this school
        </Label>
        <MultiSelect
          options={grades.map((g) => ({ id: g.id, label: g.name }))}
          value={offered}
          onChange={setOffered}
          placeholder="Select the grades this school has on this campus"
          className="min-h-10"
          maxBadges={8}
          bulkActions
          searchable
        />
      </div>

      {orderedOffered.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
              <Layers className="h-3 w-3" /> Division of each grade
              {unassigned.length > 0 && (
                <span className="text-amber-600 normal-case tracking-normal font-semibold ms-1">· {unassigned.length} without a division</span>
              )}
            </Label>
            {unassigned.length > 0 && (
              <div className="flex items-center gap-1">
                <Select value={bulkDivision || undefined} onValueChange={setBulkDivision}>
                  <SelectTrigger className="h-8 w-[190px] bg-white text-xs">
                    <SelectValue placeholder="Set unassigned to…" />
                  </SelectTrigger>
                  <SelectContent>
                    {divisions.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" size="sm" variant="outline" className="h-8 text-xs font-bold" disabled={!bulkDivision} onClick={assignUnassigned}>
                  <Plus className="h-3 w-3 me-1" /> Apply
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 ps-1">
            {orderedOffered.map((gradeId) => {
              const current = byGrade.get(gradeId);
              const div = current ? divisionOf(current) : undefined;
              return (
                <div key={gradeId} className="flex items-center gap-2">
                  <span className={cn('text-xs font-semibold w-[118px] shrink-0 truncate', current ? 'text-slate-700' : 'text-amber-600')} title={gradeName.get(gradeId) || gradeId}>
                    {gradeName.get(gradeId) || gradeId}
                  </span>
                  <Select value={current || NONE} onValueChange={(v) => setDivision(gradeId, v)}>
                    <SelectTrigger className={cn('h-8 bg-white text-xs', !current && 'border-amber-300')}>
                      <SelectValue>
                        <span className="flex items-center gap-2">
                          {div && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: div.color || '#94a3b8' }} />}
                          {div ? div.name : <span className="text-slate-400">No division</span>}
                        </span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}><span className="text-slate-400">No division</span></SelectItem>
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
                </div>
              );
            })}
          </div>
        </div>
      )}
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
    (campus?.schoolConfigs || []).map((c) => ({ schoolId: c.schoolId, gradeIds: gradesOfSchoolConfig(c), divisions: c.divisions || [] }))
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

  const missingSchool = schoolConfigs.some((c) => !c.schoolId);
  const unassignedCount = schoolConfigs.reduce((n, c) => n + gradesOfSchoolConfig(c).filter((g) => !divisionByGrade(c).get(g)).length, 0);

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
            For each school on this campus: the grades it offers, and the division each grade belongs to.
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
            {missingSchool && <p className="text-[11px] text-amber-600 font-medium">Every row needs a school selected.</p>}
            {!missingSchool && unassignedCount > 0 && (
              <p className="text-[11px] text-amber-600 font-medium">
                {unassignedCount} grade(s) have no division. They stay available on the school, but email queues and employee scopes only route through divisions.
              </p>
            )}
          </div>

          <DialogFooter className="pt-4 sticky bottom-0 bg-white border-t mt-6 -mx-6 px-6 py-4">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button
              type="submit"
              disabled={isPending || !name || schoolConfigs.length === 0 || missingSchool}
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

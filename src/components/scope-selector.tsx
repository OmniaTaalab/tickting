'use client';
import { useEffect, useMemo } from 'react';
import { collection, orderBy, query } from 'firebase/firestore';
import { Building2, Inbox, Layers, School as SchoolIcon, GraduationCap } from 'lucide-react';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MultiSelect } from '@/components/multi-select';
import { useLanguage } from '@/hooks/use-language';
import { cn } from '@/lib/utils';
import type { Campus, Department, Division, Grade, MailboxConfig, School } from '@/lib/types';
import {
  departmentsForCampuses,
  divisionIdsFor,
  gradeIdsFor,
  schoolIdsForCampuses,
  scopeFromMailboxes,
} from '@/lib/org-structure';

export type ScopeMode = 'structure' | 'mailbox';

export type ScopeValue = {
  mode: ScopeMode;
  departmentId: string;
  campusIds: string[];
  schoolIds: string[];
  divisionIds: string[];
  gradeIds: string[];
  mailboxIds: string[];
};

export const emptyScope = (mode: ScopeMode = 'structure'): ScopeValue => ({
  mode,
  departmentId: '',
  campusIds: [],
  schoolIds: [],
  divisionIds: [],
  gradeIds: [],
  mailboxIds: [],
});

interface ScopeSelectorProps {
  value: ScopeValue;
  onChange: (next: ScopeValue) => void;
  /** Campuses the editing user may assign (Managers are limited to their own). */
  allowedCampusIds?: string[] | null;
  /** Category is fixed (Manager adding to their own category). */
  lockedDepartmentId?: string | null;
  errors?: Partial<Record<'departmentId' | 'campusIds' | 'schoolIds' | 'divisionIds' | 'gradeIds' | 'mailboxIds', string[]>>;
  disabled?: boolean;
}

/**
 * Employee scope picker. Two modes, same result (campuses, category, schools,
 * divisions, grades), all derived from the campus structure:
 *  - By campus structure: campuses -> category (filtered by campus) -> schools
 *    (on those campuses) -> divisions (under those schools) -> grades (automatic).
 *  - By configured mailboxes: pick mailboxes; everything else is derived and the
 *    employee only receives tickets from those mailboxes.
 */
export function ScopeSelector({ value, onChange, allowedCampusIds, lockedDepartmentId, errors, disabled }: ScopeSelectorProps) {
  const { firestore } = useFirebase();
  const { t } = useLanguage();

  const campusesQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'campuses'), orderBy('name', 'asc')) : null), [firestore]);
  const { data: campuses } = useCollection<Campus>(campusesQuery);
  const departmentsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'departments'), orderBy('name', 'asc')) : null), [firestore]);
  const { data: departments } = useCollection<Department>(departmentsQuery);
  const schoolsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'schools'), orderBy('name', 'asc')) : null), [firestore]);
  const { data: schools } = useCollection<School>(schoolsQuery);
  const divisionsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'divisions'), orderBy('name', 'asc')) : null), [firestore]);
  const { data: divisions } = useCollection<Division>(divisionsQuery);
  const gradesQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'grades'), orderBy('name', 'asc')) : null), [firestore]);
  const { data: grades } = useCollection<Grade>(gradesQuery);
  const mailboxesQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'mailboxes'), orderBy('email', 'asc')) : null), [firestore]);
  const { data: mailboxes } = useCollection<MailboxConfig>(mailboxesQuery);

  const allCampuses = campuses || [];
  const visibleCampuses = useMemo(
    () => (allowedCampusIds && allowedCampusIds.length ? allCampuses.filter((c) => allowedCampusIds.includes(c.id)) : allCampuses),
    [allCampuses, allowedCampusIds]
  );
  const nameOf = (list: { id: string; name: string }[] | null | undefined) => new Map((list || []).map((x) => [x.id, x.name.trim()]));
  const campusName = nameOf(campuses);
  const schoolName = nameOf(schools);
  const divisionName = nameOf(divisions);
  const gradeName = nameOf(grades);

  // ---- structure mode: options cascade from the selections above them ----
  const departmentOptions = useMemo(
    () => departmentsForCampuses(departments || [], value.campusIds),
    [departments, value.campusIds]
  );
  const schoolOptions = useMemo(() => {
    const ids = schoolIdsForCampuses(allCampuses, value.campusIds);
    return ids.map((id) => ({
      id,
      label: schoolName.get(id) || id,
      hint: allCampuses
        .filter((c) => value.campusIds.includes(c.id) && (c.schoolConfigs || []).some((cfg) => cfg.schoolId === id))
        .map((c) => c.name)
        .join(', '),
    }));
  }, [allCampuses, value.campusIds, schoolName]);
  const divisionOptions = useMemo(() => {
    const ids = divisionIdsFor(allCampuses, value.campusIds, value.schoolIds);
    return ids.map((id) => ({ id, label: divisionName.get(id) || id }));
  }, [allCampuses, value.campusIds, value.schoolIds, divisionName]);
  const derivedGradeIds = useMemo(
    () => gradeIdsFor(allCampuses, value.campusIds, value.schoolIds, value.divisionIds),
    [allCampuses, value.campusIds, value.schoolIds, value.divisionIds]
  );

  // ---- mailbox mode ----
  const mailboxOptions = useMemo(() => {
    const list = (mailboxes || []).filter((m) => m.enabled !== false);
    const scoped = allowedCampusIds && allowedCampusIds.length ? list.filter((m) => !m.campusId || allowedCampusIds.includes(m.campusId)) : list;
    const byDept = lockedDepartmentId ? scoped.filter((m) => m.departmentId === lockedDepartmentId) : scoped;
    return byDept.map((m) => ({
      id: m.id,
      label: m.email,
      hint: [m.campusName || 'All campuses', m.departmentName].filter(Boolean).join(' · '),
    }));
  }, [mailboxes, allowedCampusIds, lockedDepartmentId]);
  const selectedMailboxes = useMemo(() => (mailboxes || []).filter((m) => value.mailboxIds.includes(m.id)), [mailboxes, value.mailboxIds]);

  // Keep derived fields in sync with the selections (grades in structure mode; everything in mailbox mode).
  useEffect(() => {
    if (value.mode === 'structure') {
      const next = derivedGradeIds;
      const same = next.length === value.gradeIds.length && next.every((g) => value.gradeIds.includes(g));
      if (!same) onChange({ ...value, gradeIds: next });
      return;
    }
    const derived = scopeFromMailboxes(selectedMailboxes, allCampuses);
    const deptIds = Array.from(new Set(selectedMailboxes.map((m) => m.departmentId)));
    const departmentId = deptIds.length === 1 ? deptIds[0] : value.departmentId;
    const eq = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
    if (
      !eq(derived.campusIds, value.campusIds) ||
      !eq(derived.schoolIds, value.schoolIds) ||
      !eq(derived.divisionIds, value.divisionIds) ||
      !eq(derived.gradeIds, value.gradeIds) ||
      departmentId !== value.departmentId
    ) {
      onChange({ ...value, ...derived, departmentId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.mode, value.mailboxIds, derivedGradeIds.join('|'), selectedMailboxes.length, allCampuses.length]);

  const setMode = (mode: ScopeMode) => {
    if (mode === value.mode) return;
    onChange(mode === 'mailbox' ? { ...emptyScope('mailbox'), departmentId: lockedDepartmentId || '' } : { ...emptyScope('structure'), departmentId: lockedDepartmentId || '' });
  };

  const setCampuses = (campusIds: string[]) => {
    const schoolIds = value.schoolIds.filter((id) => schoolIdsForCampuses(allCampuses, campusIds).includes(id));
    const divisionIds = value.divisionIds.filter((id) => divisionIdsFor(allCampuses, campusIds, schoolIds).includes(id));
    const dept = departmentsForCampuses(departments || [], campusIds).some((d) => d.id === value.departmentId) ? value.departmentId : lockedDepartmentId || '';
    onChange({ ...value, campusIds, schoolIds, divisionIds, departmentId: dept });
  };
  const setSchools = (schoolIds: string[]) => {
    const divisionIds = value.divisionIds.filter((id) => divisionIdsFor(allCampuses, value.campusIds, schoolIds).includes(id));
    onChange({ ...value, schoolIds, divisionIds });
  };

  const err = (key: keyof NonNullable<ScopeSelectorProps['errors']>) =>
    errors?.[key]?.length ? <p className="text-[10px] text-destructive font-bold">{errors[key]!.join(', ')}</p> : null;

  const departmentMismatch =
    value.mode === 'mailbox' && new Set(selectedMailboxes.map((m) => m.departmentId)).size > 1;

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
        {(['structure', 'mailbox'] as ScopeMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            disabled={disabled}
            onClick={() => setMode(mode)}
            className={cn(
              'h-9 rounded-lg text-xs font-bold uppercase tracking-tight flex items-center justify-center gap-2 transition-all',
              value.mode === mode ? 'bg-white text-[#1e3a8a] shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            {mode === 'structure' ? <Building2 className="h-3.5 w-3.5" /> : <Inbox className="h-3.5 w-3.5" />}
            {mode === 'structure' ? t('scopeByStructure') : t('scopeByMailbox')}
          </button>
        ))}
      </div>

      {value.mode === 'mailbox' ? (
        <div className="space-y-1.5">
          <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('mailboxes')}</Label>
          <MultiSelect
            options={mailboxOptions}
            value={value.mailboxIds}
            onChange={(mailboxIds) => onChange({ ...value, mailboxIds })}
            placeholder="Select mailboxes…"
            emptyText={t('noMailboxes')}
            searchable
            disabled={disabled}
          />
          {err('mailboxIds')}
          {departmentMismatch && (
            <p className="text-[11px] text-amber-600 font-medium">The selected mailboxes belong to different categories. An employee has one category; pick mailboxes of the same category.</p>
          )}
          <p className="text-[11px] text-slate-400">The employee will only receive tickets from these mailboxes.</p>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('campuses')} <span className="text-destructive">*</span></Label>
            <MultiSelect
              options={visibleCampuses.map((c) => ({ id: c.id, label: c.name }))}
              value={value.campusIds}
              onChange={setCampuses}
              placeholder="Select campuses…"
              disabled={disabled}
            />
            {err('campusIds')}
          </div>

          {!lockedDepartmentId && (
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('categories')} <span className="text-destructive">*</span></Label>
              <Select value={value.departmentId || undefined} onValueChange={(departmentId) => onChange({ ...value, departmentId })} disabled={disabled || !value.campusIds.length}>
                <SelectTrigger className="h-11 border-slate-200">
                  <SelectValue placeholder={value.campusIds.length ? 'Select category' : 'Select campuses first'} />
                </SelectTrigger>
                <SelectContent>
                  {departmentOptions.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {err('departmentId')}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1"><SchoolIcon className="h-3 w-3" /> {t('schools')}</Label>
              <MultiSelect
                options={schoolOptions}
                value={value.schoolIds}
                onChange={setSchools}
                placeholder={value.campusIds.length ? 'Select schools…' : 'Select campuses first'}
                emptyText="No schools configured on the selected campuses"
                disabled={disabled || !value.campusIds.length}
                bulkActions
              />
              {err('schoolIds')}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1"><Layers className="h-3 w-3" /> {t('divisions')}</Label>
              <MultiSelect
                options={divisionOptions}
                value={value.divisionIds}
                onChange={(divisionIds) => onChange({ ...value, divisionIds })}
                placeholder={value.schoolIds.length ? 'Select divisions…' : 'Select schools first'}
                emptyText="No divisions configured under the selected schools"
                disabled={disabled || !value.schoolIds.length}
                bulkActions
              />
              {err('divisionIds')}
            </div>
          </div>
        </>
      )}

      {/* Derived summary (read-only) */}
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-3 space-y-2">
        <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1"><GraduationCap className="h-3 w-3" /> {t('derivedGrades')}</Label>
        <div className="flex flex-wrap gap-1">
          {value.gradeIds.length ? (
            value.gradeIds.map((id) => (
              <Badge key={id} variant="secondary" className="bg-white border text-[10px] px-1.5 py-0 h-5">{gradeName.get(id) || id}</Badge>
            ))
          ) : (
            <span className="text-xs text-slate-400 italic">No grades yet — pick divisions (or mailboxes).</span>
          )}
        </div>
        {value.mode === 'mailbox' && (
          <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-3 gap-y-1 pt-1">
            <span>Campuses: <b>{value.campusIds.map((id) => campusName.get(id) || id).join(', ') || '—'}</b></span>
            <span>Schools: <b>{value.schoolIds.map((id) => schoolName.get(id) || id).join(', ') || '—'}</b></span>
            <span>Divisions: <b>{value.divisionIds.map((id) => divisionName.get(id) || id).join(', ') || '—'}</b></span>
          </div>
        )}
        {err('gradeIds')}
      </div>
    </div>
  );
}

/** Hidden inputs so a `<form action>` server action receives the scope. */
export function ScopeHiddenInputs({ value }: { value: ScopeValue }) {
  return (
    <>
      <input type="hidden" name="scopeMode" value={value.mode} />
      {value.departmentId && <input type="hidden" name="departmentId" value={value.departmentId} />}
      {value.campusIds.map((id) => <input key={`c-${id}`} type="hidden" name="campusIds" value={id} />)}
      {value.schoolIds.map((id) => <input key={`s-${id}`} type="hidden" name="schoolIds" value={id} />)}
      {value.divisionIds.map((id) => <input key={`d-${id}`} type="hidden" name="divisionIds" value={id} />)}
      {value.gradeIds.map((id) => <input key={`g-${id}`} type="hidden" name="gradeIds" value={id} />)}
      {value.mailboxIds.map((id) => <input key={`m-${id}`} type="hidden" name="mailboxIds" value={id} />)}
    </>
  );
}

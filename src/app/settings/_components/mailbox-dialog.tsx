'use client';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { collection, orderBy, query } from 'firebase/firestore';
import { Loader2, AlertCircle, PlugZap, CheckCircle2, XCircle } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MultiSelect } from '@/components/multi-select';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/hooks/use-language';
import { useCollection, useFirebase, useMemoFirebase, useUser } from '@/firebase';
import { createOrUpdateMailboxAction } from '@/actions/mailbox_actions';
import { testMailboxConnection, type MailboxTestResult } from '@/firebase/functions';
import type { Campus, Department, Division, MailboxConfig, MailboxScope, School, UserProfile } from '@/lib/types';
import { campusesForDepartment, divisionIdsFor, schoolIdsForCampuses } from '@/lib/org-structure';

interface MailboxDialogProps {
  isOpen: boolean;
  onClose: () => void;
  mailbox: MailboxConfig | null;
}

export function MailboxDialog({ isOpen, onClose, mailbox }: MailboxDialogProps) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const { user: currentUser } = useUser();
  const { firestore } = useFirebase();
  const [state, dispatch, isPending] = useActionState(createOrUpdateMailboxAction, { success: false, message: null, errors: {} });
  const lastProcessedRef = useRef<any>(null);

  const [email, setEmail] = useState(mailbox?.email || '');
  const [displayName, setDisplayName] = useState(mailbox?.displayName || '');
  const [departmentId, setDepartmentId] = useState(mailbox?.departmentId || '');
  const [scope, setScope] = useState<MailboxScope>(mailbox?.scope || 'academic');
  const [campusId, setCampusId] = useState(mailbox?.campusId || '');
  const [schoolIds, setSchoolIds] = useState<string[]>(mailbox?.schoolIds || []);
  const [divisionIds, setDivisionIds] = useState<string[]>(mailbox?.divisionIds || []);
  const [assignTo, setAssignTo] = useState<string[]>(mailbox?.assignTo || []);
  const [enabled, setEnabled] = useState(mailbox?.enabled ?? true);
  const [notes, setNotes] = useState(mailbox?.notes || '');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<MailboxTestResult | null>(null);

  const departmentsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'departments'), orderBy('name', 'asc')) : null), [firestore]);
  const { data: departments } = useCollection<Department>(departmentsQuery);
  const campusesQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'campuses'), orderBy('name', 'asc')) : null), [firestore]);
  const { data: campuses } = useCollection<Campus>(campusesQuery);
  const schoolsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'schools'), orderBy('name', 'asc')) : null), [firestore]);
  const { data: schools } = useCollection<School>(schoolsQuery);
  const divisionsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'divisions'), orderBy('name', 'asc')) : null), [firestore]);
  const { data: divisions } = useCollection<Division>(divisionsQuery);
  const usersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'users'), orderBy('name', 'asc')) : null), [firestore]);
  const { data: users } = useCollection<UserProfile>(usersQuery);

  const department = useMemo(() => departments?.find((d) => d.id === departmentId), [departments, departmentId]);
  const campusOptions = useMemo(() => campusesForDepartment(campuses || [], department), [campuses, department]);
  const campus = useMemo(() => campuses?.find((c) => c.id === campusId), [campuses, campusId]);

  const schoolOptions = useMemo(() => {
    if (!campus) return [];
    const ids = schoolIdsForCampuses([campus], [campus.id]);
    return ids.map((id) => ({ id, label: schools?.find((s) => s.id === id)?.name.trim() || id }));
  }, [campus, schools]);

  const isDirector = assignTo.length > 0;
  const divisionOptions = useMemo(() => {
    const all = (divisions || []).map((d) => ({ id: d.id, label: d.name }));
    if (isDirector || !campus) return isDirector ? all : [];
    const ids = divisionIdsFor([campus], [campus.id], schoolIds);
    return all.filter((d) => ids.includes(d.id));
  }, [divisions, campus, schoolIds, isDirector]);

  const staffOptions = useMemo(
    () =>
      (users || [])
        .filter((u) => (u.role === 'Employee' || u.role === 'Manager') && (!departmentId || u.departmentId === departmentId))
        .filter((u) => !campusId || !u.campusIds?.length || u.campusIds.includes(campusId))
        .map((u) => ({ id: u.email.toLowerCase(), label: u.name, hint: u.email })),
    [users, departmentId, campusId]
  );

  // Keep dependent selections valid, but only once the lists they depend on have loaded.
  // Pruning against a still-empty list wiped the saved campus, schools and divisions on edit.
  const structureLoaded = !!departments && !!campuses && !!schools && !!divisions;
  useEffect(() => {
    if (!structureLoaded) return;
    if (campusId && !campusOptions.some((c) => c.id === campusId)) setCampusId('');
  }, [structureLoaded, campusOptions, campusId]);
  useEffect(() => {
    if (!structureLoaded) return;
    setSchoolIds((prev) => (prev.every((id) => schoolOptions.some((o) => o.id === id)) ? prev : prev.filter((id) => schoolOptions.some((o) => o.id === id))));
  }, [structureLoaded, schoolOptions]);
  useEffect(() => {
    if (!structureLoaded) return;
    setDivisionIds((prev) => (prev.every((id) => divisionOptions.some((o) => o.id === id)) ? prev : prev.filter((id) => divisionOptions.some((o) => o.id === id))));
  }, [structureLoaded, divisionOptions]);

  useEffect(() => {
    if (state !== lastProcessedRef.current) {
      if (state.success) {
        toast({ title: '✅ Saved', description: state.message });
        onClose();
      } else if (state.message && state.errors?.form) {
        toast({ variant: 'destructive', title: 'Error', description: state.errors.form.join(', ') });
      }
      lastProcessedRef.current = state;
    }
  }, [state, toast, onClose]);

  const handleAction = (formData: FormData) => {
    if (!currentUser) return;
    if (mailbox?.id) formData.append('id', mailbox.id);
    formData.append('email', email.trim().toLowerCase());
    formData.append('displayName', displayName.trim());
    formData.append('departmentId', departmentId);
    formData.append('scope', scope);
    if (scope !== 'department') formData.append('campusId', campusId);
    if (scope === 'academic') {
      schoolIds.forEach((id) => formData.append('schoolIds', id));
      divisionIds.forEach((id) => formData.append('divisionIds', id));
    }
    assignTo.forEach((e) => formData.append('assignTo', e));
    formData.append('enabled', enabled ? 'true' : 'false');
    formData.append('notes', notes.trim());
    formData.append('actorId', currentUser.uid);
    formData.append('actorName', currentUser.displayName || 'Admin');
    dispatch(formData);
  };

  const runTest = async () => {
    if (!email.includes('@')) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testMailboxConnection({ email: email.trim().toLowerCase(), mailboxId: mailbox?.id });
      setTestResult(result);
    } catch (error: any) {
      setTestResult({ ok: false, error: error?.message || 'Request failed', durationMs: 0 });
    } finally {
      setTesting(false);
    }
  };

  const canSubmit =
    email.includes('@') &&
    !!departmentId &&
    (scope === 'department' || !!campusId) &&
    (scope !== 'academic' || (schoolIds.length > 0 && divisionIds.length > 0));

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto p-0">
        <DialogHeader className="p-6 pb-0 text-start">
          <DialogTitle className="text-xl font-bold">{mailbox ? t('editMailbox') : t('addMailbox')}</DialogTitle>
          <DialogDescription>
            Where parents write, which category and campus the queue belongs to, and the schools and divisions it routes to.
            Grades come from the campus structure.
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

          {/* Mailbox identity */}
          <div className="grid grid-cols-1 sm:grid-cols-[1.4fr_1fr] gap-4">
            <div className="space-y-1.5 text-start">
              <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('mailboxEmail')} *</Label>
              <div className="flex gap-2">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="queue@nis-egypt.com" className="h-11" required />
                <Button type="button" variant="outline" onClick={runTest} disabled={testing || !email.includes('@')} className="h-11 shrink-0 gap-2 border-[#1e3a8a] text-[#1e3a8a] font-bold">
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                  {t('testConnection')}
                </Button>
              </div>
              {state.errors?.email && <p className="text-[10px] text-destructive font-bold">{state.errors.email.join(', ')}</p>}
              {testResult && (
                <div className={`text-xs rounded-lg px-3 py-2 flex items-start gap-2 ${testResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                  {testResult.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> : <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
                  <span>
                    {testResult.ok
                      ? `Connected as ${testResult.emailAddress}. ${testResult.inboxLast7Days} inbox message(s) in the last 7 days.`
                      : `Connection failed: ${testResult.error}`}
                  </span>
                </div>
              )}
            </div>
            <div className="space-y-1.5 text-start">
              <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('mailboxDisplayName')}</Label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="NIS CRM Support" className="h-11" />
            </div>
          </div>

          {/* Category + scope */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 text-start">
              <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('categories')} *</Label>
              <Select value={departmentId || undefined} onValueChange={setDepartmentId}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {(departments || []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {state.errors?.departmentId && <p className="text-[10px] text-destructive font-bold">{state.errors.departmentId.join(', ')}</p>}
            </div>
            <div className="space-y-1.5 text-start">
              <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('mailboxScope')} *</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as MailboxScope)}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="department">{t('scopeDepartment')}</SelectItem>
                  <SelectItem value="campus">{t('scopeCampus')}</SelectItem>
                  <SelectItem value="academic">{t('scopeAcademic')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {scope !== 'department' && (
            <div className="space-y-4 p-4 rounded-xl bg-slate-50 border">
              <div className="space-y-1.5 text-start">
                <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('campuses')} *</Label>
                <Select value={campusId || undefined} onValueChange={setCampusId} disabled={!departmentId}>
                  <SelectTrigger className="h-11 bg-white"><SelectValue placeholder={departmentId ? 'Select campus' : 'Select category first'} /></SelectTrigger>
                  <SelectContent>
                    {campusOptions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {state.errors?.campusId && <p className="text-[10px] text-destructive font-bold">{state.errors.campusId.join(', ')}</p>}
              </div>

              {scope === 'academic' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5 text-start">
                    <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('schools')} *</Label>
                    <MultiSelect
                      options={schoolOptions}
                      value={schoolIds}
                      onChange={setSchoolIds}
                      placeholder={campusId ? 'Select schools…' : 'Select campus first'}
                      emptyText="No schools configured on this campus"
                      disabled={!campusId}
                      bulkActions
                    />
                    {state.errors?.schoolIds && <p className="text-[10px] text-destructive font-bold">{state.errors.schoolIds.join(', ')}</p>}
                  </div>
                  <div className="space-y-1.5 text-start">
                    <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('divisions')} *</Label>
                    <MultiSelect
                      options={divisionOptions}
                      value={divisionIds}
                      onChange={setDivisionIds}
                      placeholder={schoolIds.length || isDirector ? 'Select divisions…' : 'Select schools first'}
                      emptyText="No divisions configured under the selected schools"
                      disabled={!campusId || (!schoolIds.length && !isDirector)}
                      bulkActions
                    />
                    {state.errors?.divisionIds && <p className="text-[10px] text-destructive font-bold">{state.errors.divisionIds.join(', ')}</p>}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Director-style staff list */}
          <div className="space-y-1.5 text-start">
            <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('assignOnlyTo')}</Label>
            <MultiSelect
              options={staffOptions}
              value={assignTo}
              onChange={setAssignTo}
              placeholder="Any staff with matching scope"
              emptyText="No staff in this category / campus"
              searchable
            />
            <p className="text-[11px] text-slate-400">{t('assignOnlyToHint')}</p>
            {state.errors?.assignTo && <p className="text-[10px] text-destructive font-bold">{state.errors.assignTo.join(', ')}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 items-start">
            <div className="flex items-center gap-3 h-11">
              <Switch checked={enabled} onCheckedChange={setEnabled} id="mailbox-enabled" />
              <Label htmlFor="mailbox-enabled" className="text-sm font-semibold">{enabled ? t('enabled') : t('disabled')}</Label>
            </div>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className="min-h-[44px]" rows={2} />
          </div>

          <DialogFooter className="pt-4 sticky bottom-0 bg-white border-t mt-2 -mx-6 px-6 py-4">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" disabled={isPending || !canSubmit} className="bg-[#1e3a8a] text-white font-bold px-8 h-11">
              {isPending && <Loader2 className="me-2 animate-spin h-4 w-4" />}
              {mailbox ? 'Save Changes' : 'Add Mailbox'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

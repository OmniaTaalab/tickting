'use client';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { collection, orderBy, query } from 'firebase/firestore';
import { Inbox, Plus, Pencil, Trash2, MoreHorizontal, CheckCircle2, XCircle, Clock, Search, Users2, PlugZap, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/hooks/use-language';
import { useCollection, useFirebase, useMemoFirebase, useUser } from '@/firebase';
import { deleteMailboxAction, setMailboxEnabledAction } from '@/actions/mailbox_actions';
import { testMailboxConnection } from '@/firebase/functions';
import type { Campus, Division, MailboxConfig, School } from '@/lib/types';
import { cn } from '@/lib/utils';
import { MailboxDialog } from './mailbox-dialog';

const toDate = (v: any): Date | null => {
  if (!v) return null;
  if (typeof v?.toDate === 'function') return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

function SyncBadge({ mailbox, t }: { mailbox: MailboxConfig; t: (k: string) => string }) {
  const at = toDate(mailbox.lastSyncAt);
  if (!mailbox.lastSyncStatus || mailbox.lastSyncStatus === 'never' || !at) {
    return <Badge variant="outline" className="text-[10px] gap-1 text-slate-400"><Clock className="h-3 w-3" /> {t('neverSynced')}</Badge>;
  }
  const ok = mailbox.lastSyncStatus === 'ok';
  return (
    <div className="space-y-0.5">
      <Badge variant="outline" className={cn('text-[10px] gap-1', ok ? 'text-emerald-700 border-emerald-200 bg-emerald-50' : 'text-red-700 border-red-200 bg-red-50')} title={mailbox.lastSyncError || ''}>
        {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />} {ok ? t('syncOk') : t('syncFailed')}
      </Badge>
      <p className="text-[10px] text-slate-400">{at.toLocaleString()}{ok && mailbox.lastSyncMessageCount != null ? ` · ${mailbox.lastSyncMessageCount} msg` : ''}</p>
      {!ok && mailbox.lastSyncError && <p className="text-[10px] text-red-500 max-w-[220px] truncate" title={mailbox.lastSyncError}>{mailbox.lastSyncError}</p>}
    </div>
  );
}

export function MailboxList() {
  const { firestore } = useFirebase();
  const { user: currentUser } = useUser();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<MailboxConfig | null>(null);
  const [toDelete, setToDelete] = useState<MailboxConfig | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const [toggleState, toggleDispatch] = useActionState(setMailboxEnabledAction, { success: false });
  const [deleteState, deleteDispatch] = useActionState(deleteMailboxAction, { success: false });
  const lastToggle = useRef<any>(null);
  const lastDelete = useRef<any>(null);

  const mailboxesQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'mailboxes'), orderBy('email', 'asc')) : null), [firestore]);
  const { data: mailboxes, isLoading } = useCollection<MailboxConfig>(mailboxesQuery);
  const campusesQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'campuses')) : null), [firestore]);
  const { data: campuses } = useCollection<Campus>(campusesQuery);
  const schoolsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'schools')) : null), [firestore]);
  const { data: schools } = useCollection<School>(schoolsQuery);
  const divisionsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'divisions')) : null), [firestore]);
  const { data: divisions } = useCollection<Division>(divisionsQuery);

  const campusName = useMemo(() => new Map((campuses || []).map((c) => [c.id, c.name])), [campuses]);
  const schoolName = useMemo(() => new Map((schools || []).map((s) => [s.id, s.name.trim()])), [schools]);
  const divisionName = useMemo(() => new Map((divisions || []).map((d) => [d.id, d.name])), [divisions]);

  useEffect(() => {
    if (toggleState !== lastToggle.current) {
      if (toggleState.message) toast({ title: toggleState.success ? '✅' : 'Error', description: toggleState.message || toggleState.errors?.form?.join(', '), variant: toggleState.success ? undefined : 'destructive' });
      lastToggle.current = toggleState;
    }
  }, [toggleState, toast]);
  useEffect(() => {
    if (deleteState !== lastDelete.current) {
      if (deleteState.success || deleteState.errors?.form) {
        toast({ title: deleteState.success ? '🗑️ Deleted' : 'Error', description: deleteState.message || deleteState.errors?.form?.join(', '), variant: deleteState.success ? undefined : 'destructive' });
        setToDelete(null);
      }
      lastDelete.current = deleteState;
    }
  }, [deleteState, toast]);

  const filtered = useMemo(() => {
    const list = mailboxes || [];
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter((m) =>
      m.email.includes(q) ||
      (m.departmentName || '').toLowerCase().includes(q) ||
      (m.campusName || '').toLowerCase().includes(q) ||
      m.schoolIds.some((id) => (schoolName.get(id) || '').toLowerCase().includes(q)) ||
      m.divisionIds.some((id) => (divisionName.get(id) || '').toLowerCase().includes(q))
    );
  }, [mailboxes, search, schoolName, divisionName]);

  const actorFields = (fd: FormData) => {
    fd.append('actorId', currentUser?.uid || '');
    fd.append('actorName', currentUser?.displayName || 'Admin');
  };

  const toggleEnabled = (m: MailboxConfig, enabled: boolean) => {
    const fd = new FormData();
    fd.append('id', m.id);
    fd.append('enabled', enabled ? 'true' : 'false');
    actorFields(fd);
    toggleDispatch(fd);
  };

  const confirmDelete = () => {
    if (!toDelete) return;
    const fd = new FormData();
    fd.append('id', toDelete.id);
    actorFields(fd);
    deleteDispatch(fd);
  };

  const runTest = async (m: MailboxConfig) => {
    setTestingId(m.id);
    try {
      const r = await testMailboxConnection({ email: m.email, mailboxId: m.id });
      toast(r.ok
        ? { title: '✅ Connected', description: `${r.emailAddress}: ${r.inboxLast7Days} inbox message(s) in the last 7 days.` }
        : { variant: 'destructive', title: 'Connection failed', description: r.error });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Connection failed', description: error?.message || 'Request failed' });
    } finally {
      setTestingId(null);
    }
  };

  const scopeLabel = (m: MailboxConfig) => (m.scope === 'department' ? t('scopeDepartment') : m.scope === 'campus' ? t('scopeCampus') : t('scopeAcademic'));

  return (
    <Card className="border-none shadow-sm bg-white overflow-hidden">
      {isDialogOpen && (
        <MailboxDialog key={selected?.id || 'new'} isOpen={isDialogOpen} onClose={() => { setDialogOpen(false); setSelected(null); }} mailbox={selected} />
      )}
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{toDelete?.email}"?</AlertDialogTitle>
            <AlertDialogDescription>
              The mailbox will stop syncing. Staff attached to it by mailbox are detached. Existing tickets are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CardHeader className="bg-slate-50/50 border-b px-6 py-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="text-start">
            <CardTitle className="text-xl font-bold flex items-center gap-2">
              <Inbox className="h-5 w-5 text-indigo-600" />
              {t('emailConfigurations')}
              <Badge variant="secondary" className="font-mono text-[10px]">{mailboxes?.length || 0}</Badge>
            </CardTitle>
            <CardDescription>{t('emailConfigurationsSub')}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input placeholder="Search mailbox, campus, school…" value={search} onChange={(e) => setSearch(e.target.value)} className="ps-9 h-10 w-[260px] bg-white" />
            </div>
            <Button onClick={() => { setSelected(null); setDialogOpen(true); }} className="bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white font-bold gap-2">
              <Plus className="h-4 w-4" /> {t('addMailbox')}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50/30">
              <TableRow>
                <TableHead className="ps-6 text-start">{t('mailboxEmail')}</TableHead>
                <TableHead className="text-start">{t('categories')} / {t('campuses')}</TableHead>
                <TableHead className="text-start">{t('schools')} / {t('divisions')}</TableHead>
                <TableHead className="text-start">{t('lastSync')}</TableHead>
                <TableHead className="text-start">{t('enabled')}</TableHead>
                <TableHead className="text-end pe-6">{t('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(6)].map((__, j) => <TableCell key={j} className={j === 0 ? 'ps-6' : ''}><Skeleton className="h-6 w-28" /></TableCell>)}
                  </TableRow>
                ))
              ) : (
                filtered.map((m) => (
                  <TableRow key={m.id} className={cn('group hover:bg-slate-50/50', !m.enabled && 'opacity-60')}>
                    <TableCell className="ps-6 py-4 text-start">
                      <p className="font-bold text-slate-900 leading-none">{m.email}</p>
                      <p className="text-[11px] text-slate-400 mt-1">{m.displayName || scopeLabel(m)}</p>
                      {m.assignTo?.length > 0 && (
                        <Badge variant="outline" className="mt-1 text-[10px] gap-1 text-indigo-700 border-indigo-200 bg-indigo-50"><Users2 className="h-3 w-3" /> {m.assignTo.length} staff only</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-start">
                      <p className="text-sm font-medium text-slate-700">{m.departmentName}</p>
                      <p className="text-xs text-slate-500">{m.campusId ? campusName.get(m.campusId) || m.campusName : 'All campuses'}</p>
                    </TableCell>
                    <TableCell className="text-start">
                      {m.scope === 'academic' ? (
                        <div className="space-y-1 max-w-[260px]">
                          <div className="flex flex-wrap gap-1">{m.schoolIds.map((id) => <Badge key={id} variant="outline" className="text-[9px] px-1.5 py-0 h-auto bg-blue-50/40 text-blue-700 border-blue-100">{schoolName.get(id) || id}</Badge>)}</div>
                          <div className="flex flex-wrap gap-1">{m.divisionIds.map((id) => <Badge key={id} variant="secondary" className="text-[9px] px-1.5 py-0 h-auto">{divisionName.get(id) || id}</Badge>)}</div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 italic">{scopeLabel(m)}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-start"><SyncBadge mailbox={m} t={t} /></TableCell>
                    <TableCell className="text-start">
                      <Switch checked={m.enabled !== false} onCheckedChange={(v) => toggleEnabled(m, v)} />
                    </TableCell>
                    <TableCell className="text-end pe-6">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-[#1e3a8a]" title={t('testConnection')} onClick={() => runTest(m)} disabled={testingId === m.id}>
                          {testingId === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => { setSelected(m); setDialogOpen(true); }}><Pencil className="me-2 h-4 w-4" /> {t('edit')}</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setToDelete(m)} className="text-destructive focus:text-destructive"><Trash2 className="me-2 h-4 w-4" /> {t('delete')}</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {!isLoading && filtered.length === 0 && (
          <div className="text-center py-12">
            <Inbox className="h-12 w-12 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-500 font-medium">{t('noMailboxes')}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

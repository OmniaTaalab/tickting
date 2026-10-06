'use client';

import React, { useState, useTransition } from 'react';
import { useOfficialHolidays } from '@/hooks/use-official-holidays';
import type { OfficialHoliday } from '@/lib/types';
import { DEFAULT_HOLIDAY_EMAIL } from '@/lib/types';
import {
  saveOfficialHoliday,
  deleteOfficialHoliday,
  toggleOfficialHolidayStatus,
} from '@/actions/holiday_actions';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CalendarOff,
  Plus,
  Pencil,
  Trash2,
  Calendar,
  Mail,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Search,
  Sparkles,
} from 'lucide-react';
import { format, parseISO, isValid } from 'date-fns';

interface OfficialHolidaysSettingsProps {
  isAdmin?: boolean;
}

export function OfficialHolidaysSettings({ isAdmin = true }: OfficialHolidaysSettingsProps) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  // Load holidays via centralized hook (with auth check & server action fallback)
  const { allHolidays: holidays, isLoading } = useOfficialHolidays();

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedHoliday, setSelectedHoliday] = useState<OfficialHoliday | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    id: '',
    name: '',
    date: '',
    isActive: true,
    emailSubject: DEFAULT_HOLIDAY_EMAIL.subject,
    emailBody: DEFAULT_HOLIDAY_EMAIL.body,
  });
  const [formError, setFormError] = useState<string | null>(null);

  // Handlers
  const handleOpenAdd = () => {
    setSelectedHoliday(null);
    setFormData({
      id: '',
      name: '',
      date: '',
      isActive: true,
      emailSubject: DEFAULT_HOLIDAY_EMAIL.subject,
      emailBody: DEFAULT_HOLIDAY_EMAIL.body,
    });
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleOpenEdit = (holiday: OfficialHoliday) => {
    setSelectedHoliday(holiday);
    setFormData({
      id: holiday.id || '',
      name: holiday.name || '',
      date: holiday.date || '',
      isActive: holiday.isActive !== false,
      emailSubject: holiday.emailSubject || DEFAULT_HOLIDAY_EMAIL.subject,
      emailBody: holiday.emailBody || DEFAULT_HOLIDAY_EMAIL.body,
    });
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleOpenDelete = (holiday: OfficialHoliday) => {
    setSelectedHoliday(holiday);
    setIsDeleteOpen(true);
  };

  const handleSave = () => {
    setFormError(null);

    // Client-side quick validations
    if (!formData.name.trim()) {
      setFormError(t('holidayNameRequired') || 'Holiday Name is required.');
      return;
    }
    if (!formData.date.trim()) {
      setFormError(t('holidayDateRequired') || 'Holiday Date is required.');
      return;
    }
    if (!formData.emailSubject.trim()) {
      setFormError(t('emailSubjectRequired') || 'Auto Reply Email Subject is required.');
      return;
    }
    if (!formData.emailBody.trim()) {
      setFormError(t('emailBodyRequired') || 'Auto Reply Email Body is required.');
      return;
    }

    startTransition(async () => {
      const res = await saveOfficialHoliday(formData);
      if (!res.success) {
        setFormError(res.message || 'Failed to save holiday.');
        toast({
          variant: 'destructive',
          title: t('error') || 'Error',
          description: res.message || 'Failed to save holiday.',
        });
      } else {
        toast({
          title: t('success') || 'Success',
          description: t('holidaySaved') || 'Official holiday saved successfully.',
        });
        setIsFormOpen(false);
      }
    });
  };

  const handleDelete = () => {
    if (!selectedHoliday?.id) return;
    startTransition(async () => {
      const res = await deleteOfficialHoliday(selectedHoliday.id!);
      if (!res.success) {
        toast({
          variant: 'destructive',
          title: t('error') || 'Error',
          description: res.message || 'Failed to delete holiday.',
        });
      } else {
        toast({
          title: t('success') || 'Success',
          description: t('holidayDeleted') || 'Official holiday deleted successfully.',
        });
        setIsDeleteOpen(false);
      }
    });
  };

  const handleToggleStatus = (holiday: OfficialHoliday) => {
    if (!holiday.id) return;
    const nextStatus = !(holiday.isActive !== false);
    startTransition(async () => {
      const res = await toggleOfficialHolidayStatus(holiday.id!, nextStatus);
      if (!res.success) {
        toast({
          variant: 'destructive',
          title: t('error') || 'Error',
          description: res.message || 'Failed to update status.',
        });
      } else {
        toast({
          title: t('success') || 'Success',
          description: nextStatus ? (t('holidayActivated') || 'Holiday activated.') : (t('holidayDeactivated') || 'Holiday deactivated.'),
        });
      }
    });
  };

  // Filtered holidays
  const filteredHolidays = (holidays || []).filter((h) => {
    if (!searchQuery) return true;
    const queryLower = searchQuery.toLowerCase();
    return (
      h.name?.toLowerCase().includes(queryLower) ||
      h.date?.includes(queryLower) ||
      h.emailSubject?.toLowerCase().includes(queryLower)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card className="border-none shadow-sm overflow-hidden bg-white">
        <CardHeader className="bg-slate-50/50 border-b px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1 text-start">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-rose-50 text-rose-700">
                <CalendarOff className="h-5 w-5" />
              </div>
              <CardTitle className="text-xl font-bold text-slate-900 font-headline">
                {t('officialHolidays')}
              </CardTitle>
            </div>
            <CardDescription className="text-slate-500 font-medium">
              {t('officialHolidaysDesc')}
            </CardDescription>
          </div>

          {isAdmin && (
            <Button
              onClick={handleOpenAdd}
              className="bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white font-bold gap-2 shadow-xs transition-all shrink-0"
            >
              <Plus className="h-4 w-4" />
              {t('addHoliday')}
            </Button>
          )}
        </CardHeader>

        <CardContent className="p-6 space-y-4">
          {/* Search bar & summary */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder={t('searchHolidays') || 'Search holidays by name or date...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ps-9 bg-slate-50/50 border-slate-200 text-sm"
              />
            </div>
            <div className="text-xs text-slate-500 font-semibold flex items-center gap-2">
              <span>{t('totalHolidays') || 'Total'}: <strong className="text-slate-800">{holidays?.length || 0}</strong></span>
              <span>•</span>
              <span className="text-emerald-700">{t('active') || 'Active'}: <strong className="text-emerald-800">{(holidays || []).filter(h => h.isActive !== false).length}</strong></span>
            </div>
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="space-y-2 py-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-md" />
              ))}
            </div>
          ) : filteredHolidays.length === 0 ? (
            <div className="text-center py-12 px-4 border-2 border-dashed rounded-xl bg-slate-50/50">
              <div className="mx-auto w-12 h-12 bg-rose-50 rounded-full flex items-center justify-center mb-3">
                <CalendarOff className="h-6 w-6 text-rose-500" />
              </div>
              <h4 className="text-sm font-bold text-slate-800">
                {searchQuery ? (t('noMatchingHolidays') || 'No matching holidays found') : (t('noHolidaysYet') || 'No Official Holidays Configured')}
              </h4>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                {searchQuery
                  ? (t('tryDifferentSearch') || 'Try searching for another term or clear the filter.')
                  : (t('addFirstHolidayDesc') || 'Configure official holidays to pause SLA timers and automatically send closure emails to requesters.')}
              </p>
              {!searchQuery && isAdmin && (
                <Button
                  onClick={handleOpenAdd}
                  variant="outline"
                  size="sm"
                  className="mt-4 gap-1.5 font-semibold text-xs border-slate-300 hover:bg-slate-100"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('addHoliday')}
                </Button>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
              <Table>
                <TableHeader className="bg-slate-50/80">
                  <TableRow>
                    <TableHead className="font-bold text-slate-700 text-xs uppercase tracking-wider">{t('holidayName')}</TableHead>
                    <TableHead className="font-bold text-slate-700 text-xs uppercase tracking-wider">{t('holidayDate')}</TableHead>
                    <TableHead className="font-bold text-slate-700 text-xs uppercase tracking-wider text-center">{t('holidayStatus')}</TableHead>
                    <TableHead className="font-bold text-slate-700 text-xs uppercase tracking-wider">{t('emailSubject')}</TableHead>
                    <TableHead className="font-bold text-slate-700 text-xs uppercase tracking-wider text-end">{t('actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-slate-100 bg-white">
                  {filteredHolidays.map((holiday) => {
                    const isActive = holiday.isActive !== false;
                    let formattedDate = holiday.date;
                    try {
                      const parsed = parseISO(holiday.date);
                      if (isValid(parsed)) {
                        formattedDate = format(parsed, 'EEEE, MMM d, yyyy');
                      }
                    } catch {
                      formattedDate = holiday.date;
                    }

                    return (
                      <TableRow key={holiday.id} className="hover:bg-slate-50/60 transition-colors">
                        <TableCell className="font-bold text-slate-900 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-rose-500" />
                            {holiday.name}
                          </div>
                        </TableCell>

                        <TableCell className="text-slate-600 font-medium text-xs whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5 text-slate-400" />
                            <span>{formattedDate}</span>
                            <span className="text-[11px] text-slate-400 font-mono">({holiday.date})</span>
                          </div>
                        </TableCell>

                        <TableCell className="text-center">
                          {isAdmin ? (
                            <button
                              type="button"
                              onClick={() => handleToggleStatus(holiday)}
                              disabled={isPending}
                              className="cursor-pointer focus:outline-hidden"
                            >
                              <Badge
                                variant="outline"
                                className={`text-[11px] font-bold transition-all ${
                                  isActive
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                    : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                                }`}
                              >
                                {isActive ? (
                                  <span className="flex items-center gap-1">
                                    <CheckCircle2 className="h-3 w-3" />
                                    {t('active')}
                                  </span>
                                ) : (
                                  <span>{t('inactive')}</span>
                                )}
                              </Badge>
                            </button>
                          ) : (
                            <Badge
                              variant="outline"
                              className={isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500'}
                            >
                              {isActive ? t('active') : t('inactive')}
                            </Badge>
                          )}
                        </TableCell>

                        <TableCell className="text-slate-700 text-xs max-w-xs truncate font-normal">
                          <div className="flex items-center gap-1.5 truncate">
                            <Mail className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            <span className="truncate">{holiday.emailSubject || DEFAULT_HOLIDAY_EMAIL.subject}</span>
                          </div>
                        </TableCell>

                        <TableCell className="text-end">
                          {isAdmin && (
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleOpenEdit(holiday)}
                                className="h-8 w-8 text-slate-600 hover:text-[#1e3a8a] hover:bg-slate-100 rounded-lg"
                                title={t('edit') || 'Edit'}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleOpenDelete(holiday)}
                                className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                                title={t('delete') || 'Delete'}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Dialog */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold font-headline text-slate-900">
              <CalendarOff className="h-5 w-5 text-rose-600" />
              {formData.id ? t('editHoliday') : t('addHoliday')}
            </DialogTitle>
            <DialogDescription>
              {t('holidayFormDesc') || 'Configure holiday details, date, and custom automated email message.'}
            </DialogDescription>
          </DialogHeader>

          {formError && (
            <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
              <div className="flex-1">{formError}</div>
            </div>
          )}

          <div className="space-y-4 py-2">
            {/* Holiday Name & Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5 text-start">
                <Label htmlFor="holiday-name" className="text-xs font-bold text-slate-700">
                  {t('holidayName')} <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="holiday-name"
                  placeholder="e.g., Armed Forces Day"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="text-sm font-medium"
                />
              </div>

              <div className="space-y-1.5 text-start">
                <Label htmlFor="holiday-date" className="text-xs font-bold text-slate-700">
                  {t('holidayDate')} <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="holiday-date"
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  className="text-sm font-medium"
                />
                <p className="text-[11px] text-slate-400 font-normal">
                  {t('timezoneNotice') || 'Evaluated in Africa/Cairo system timezone.'}
                </p>
              </div>
            </div>

            {/* Active Status Switch */}
            <div className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 bg-slate-50/50">
              <div className="space-y-0.5 text-start">
                <Label className="text-xs font-bold text-slate-800">{t('holidayStatus')}</Label>
                <p className="text-[11px] text-slate-500">
                  {formData.isActive
                    ? (t('activeHolidayDesc') || 'Active: This date is treated as non-working and pauses SLA.')
                    : (t('inactiveHolidayDesc') || 'Inactive: System operates on normal schedule.')}
                </p>
              </div>
              <Switch
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
              />
            </div>

            {/* Auto Reply Email Section */}
            <div className="pt-2 border-t space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 uppercase tracking-wider">
                  <Mail className="h-4 w-4 text-[#1e3a8a]" />
                  <span>{t('autoReplyEmailConfig') || 'Holiday Auto-Reply Email'}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setFormData({
                      ...formData,
                      emailSubject: DEFAULT_HOLIDAY_EMAIL.subject,
                      emailBody: DEFAULT_HOLIDAY_EMAIL.body,
                    })
                  }
                  className="text-[11px] text-slate-500 hover:text-slate-800 h-7 px-2"
                >
                  <Sparkles className="h-3 w-3 me-1 text-amber-500" />
                  {t('resetToDefault') || 'Reset to Default'}
                </Button>
              </div>

              <div className="space-y-1.5 text-start">
                <Label htmlFor="email-subject" className="text-xs font-bold text-slate-700">
                  {t('emailSubject')} <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="email-subject"
                  placeholder="e.g. Office Closed - Official Holiday"
                  value={formData.emailSubject}
                  onChange={(e) => setFormData({ ...formData, emailSubject: e.target.value })}
                  className="text-sm font-medium"
                />
              </div>

              <div className="space-y-1.5 text-start">
                <Label htmlFor="email-body" className="text-xs font-bold text-slate-700">
                  {t('emailBody')} <span className="text-rose-500">*</span>
                </Label>
                <Textarea
                  id="email-body"
                  rows={6}
                  value={formData.emailBody}
                  onChange={(e) => setFormData({ ...formData, emailBody: e.target.value })}
                  className="text-xs font-mono leading-relaxed resize-y"
                  placeholder="Enter the automated reply message..."
                />
                <div className="flex flex-wrap gap-1.5 pt-1 text-[11px] text-slate-500">
                  <span className="font-semibold text-slate-600">{t('availableTags') || 'Available placeholders'}:</span>
                  <code className="bg-slate-100 px-1 py-0.5 rounded text-[10px] text-slate-700 font-mono">{`{{userName}}`}</code>
                  <code className="bg-slate-100 px-1 py-0.5 rounded text-[10px] text-slate-700 font-mono">{`{{subject}}`}</code>
                  <code className="bg-slate-100 px-1 py-0.5 rounded text-[10px] text-slate-700 font-mono">{`{{ticketNumber}}`}</code>
                  <code className="bg-slate-100 px-1 py-0.5 rounded text-[10px] text-slate-700 font-mono">{`{{departmentName}}`}</code>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsFormOpen(false)}
              disabled={isPending}
              className="text-xs font-bold"
            >
              {t('cancel') || 'Cancel'}
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={isPending}
              className="bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white text-xs font-bold"
            >
              {isPending ? (t('saving') || 'Saving...') : (t('save') || 'Save Official Holiday')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Alert Dialog */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-bold text-slate-900">
              {t('deleteHolidayConfirm') || 'Delete Official Holiday?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 text-sm">
              {t('deleteHolidayWarning') || 'Are you sure you want to permanently delete the official holiday'} <strong>&quot;{selectedHoliday?.name}&quot;</strong> ({selectedHoliday?.date})? {t('actionCannotBeUndone') || 'This action cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{t('cancel') || 'Cancel'}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isPending}
              className="bg-rose-600 hover:bg-rose-700 text-white font-bold"
            >
              {isPending ? (t('deleting') || 'Deleting...') : (t('delete') || 'Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useDoc, useFirebase, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { doc, collection, query, orderBy } from 'firebase/firestore';
import type { AfterHoursEmailSettings, Department, UserProfile } from '@/lib/types';
import { DEFAULT_AFTER_HOURS_EMAIL } from '@/lib/types';
import { Loader2, Save, Eye, Edit3, Mail, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { updateAfterHoursEmailAction } from '@/actions/after_hours_actions';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/hooks/use-language';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function AfterHoursEmailSettingsPanel() {
  const { firestore } = useFirebase();
  const { user: currentUser } = useUser();
  const { toast } = useToast();
  const { t } = useLanguage();
  
  const [isSaving, setIsSaving] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [selectedDeptId, setSelectedDeptId] = useState<string>('global');

  // Fetch departments for selection
  const userProfileRef = useMemoFirebase(() => 
    currentUser && firestore ? doc(firestore, 'users', currentUser.uid) : null,
    [currentUser, firestore]
  );
  const { data: userProfile } = useDoc<UserProfile>(userProfileRef);

  const deptsQuery = useMemoFirebase(() => 
    firestore ? query(collection(firestore, 'departments'), orderBy('name', 'asc')) : null, 
    [firestore]
  );
  const { data: departments } = useCollection<Department>(deptsQuery);

  const filteredDepartments = useMemo(() => {
    if (!departments || !userProfile) return [];
    if (userProfile.role === 'Admin') return departments;
    if (userProfile.role === 'Manager' && userProfile.departmentId) {
      return departments.filter(d => d.id === userProfile.departmentId);
    }
    return [];
  }, [departments, userProfile]);

  useEffect(() => {
    if (userProfile?.role === 'Manager' && userProfile.departmentId && selectedDeptId === 'global') {
        setSelectedDeptId(userProfile.departmentId);
    }
  }, [userProfile, selectedDeptId]);

  // Fetch data based on selectedDeptId
  const globalRef = useMemoFirebase(() => (firestore ? doc(firestore, 'settings', 'afterHoursTicketEmail') : null), [firestore]);
  const deptRef = useMemoFirebase(() => (firestore && selectedDeptId !== 'global' ? doc(firestore, 'departments', selectedDeptId) : null), [firestore, selectedDeptId]);

  const { data: globalSettings, isLoading: isGlobalLoading } = useDoc<AfterHoursEmailSettings>(globalRef);
  const { data: deptDoc, isLoading: isDeptLoading } = useDoc<Department>(deptRef);

  const [localSettings, setLocalSettings] = useState<AfterHoursEmailSettings>(DEFAULT_AFTER_HOURS_EMAIL);

  useEffect(() => {
    if (selectedDeptId === 'global') {
        if (globalSettings) setLocalSettings(globalSettings);
        else setLocalSettings(DEFAULT_AFTER_HOURS_EMAIL);
    } else {
        if (deptDoc?.afterHoursEmail) setLocalSettings(deptDoc.afterHoursEmail);
        else if (globalSettings) setLocalSettings(globalSettings);
        else setLocalSettings(DEFAULT_AFTER_HOURS_EMAIL);
    }
  }, [selectedDeptId, globalSettings, deptDoc]);

  const handleSave = async () => {
    if (!currentUser) return;
    setIsSaving(true);
    // Ensure enabled is true since the toggle is removed
    const result = await updateAfterHoursEmailAction({ ...localSettings, enabled: true }, {
      userId: currentUser.uid,
      name: currentUser.displayName || 'Admin',
    }, selectedDeptId);

    if (result.success) {
      toast({ title: '✅ Success!', description: result.message });
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSaving(false);
  };

  const renderPreview = (text: string) => {
    const deptName = selectedDeptId === 'global' ? "Support Team" : (departments?.find(d => d.id === selectedDeptId)?.name || "Department");
    return text
      .replace(/{{userName}}/g, "John Doe")
      .replace(/{{ticketId}}/g, "8429")
      .replace(/{{departmentName}}/g, deptName)
      .replace(/{{subject}}/g, "Password Reset Help")
      .replace(/{{submittedAt}}/g, new Date().toLocaleString())
      .replace(/{{workingHours}}/g, "Sun-Thu: 08:00-16:00");
  };

  const isLoading = isGlobalLoading || isDeptLoading;

  return (
    <div className="space-y-6">
      <Card className="border-none shadow-sm bg-white overflow-hidden">
        <CardHeader className="bg-slate-50/50 border-b px-6 py-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-1 text-start">
              <div className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-[#1e3a8a]" />
                <CardTitle className="text-xl font-bold">{t('afterHoursEmailTitle')}</CardTitle>
              </div>
              <CardDescription>
                {t('afterHoursDescription')}
              </CardDescription>
            </div>
            
            <div className="flex flex-wrap items-center gap-3">
                <Button 
                    variant="outline" 
                    size="sm" 
                    className="gap-2 font-bold h-9 rounded-xl border-slate-200"
                    onClick={() => setIsPreview(!isPreview)}
                >
                    {isPreview ? <Edit3 className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    {isPreview ? t('edit') : t('preview')}
                </Button>
                <Button 
                    onClick={handleSave} 
                    disabled={isSaving || isLoading} 
                    className="bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white gap-2 shadow-sm h-9 px-6 font-bold"
                >
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {t('saveTemplate')}
                </Button>
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="p-6">
          {/* DEPARTMENT SELECTOR */}
          {userProfile?.role === 'Admin' && (
            <div className="max-w-md mb-8 p-4 bg-blue-50/50 rounded-xl border border-blue-100/50 text-start">
              <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">
                  {t('selectCategoryToEdit')}
              </Label>
              <Select onValueChange={setSelectedDeptId} value={selectedDeptId}>
                <SelectTrigger className="h-11 border-slate-200 bg-white">
                  <SelectValue placeholder={t('allCategories')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">{t('entireOrg')}</SelectItem>
                  {filteredDepartments.map((dept) => (
                    <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {isLoading ? (
             <div className="flex justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
             </div>
          ) : !isPreview ? (
            <div className="grid gap-6 text-start">
               <div className="space-y-2">
                  <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('emailSubject')}</Label>
                  <Input 
                    value={localSettings.subject}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, subject: e.target.value }))}
                    placeholder={t('emailSubject')}
                    className="h-11 border-slate-200 focus:ring-[#1e3a8a]"
                  />
               </div>

               <div className="space-y-2">
                  <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('messageBody')}</Label>
                  <Textarea 
                    value={localSettings.body}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, body: e.target.value }))}
                    placeholder={t('messageBody')}
                    className="min-h-[250px] border-slate-200 focus:ring-[#1e3a8a] p-4 text-sm leading-relaxed"
                  />
               </div>

               <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                    <div className="flex items-center gap-2 mb-3">
                        <Info className="h-4 w-4 text-blue-600" />
                        <span className="text-xs font-bold text-blue-800 uppercase tracking-wider">{t('availableVariables')}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {['{{userName}}', '{{ticketId}}', '{{departmentName}}', '{{subject}}', '{{submittedAt}}', '{{workingHours}}'].map(v => (
                            <Badge key={v} variant="secondary" className="bg-white border-blue-200 text-blue-700 font-mono text-[10px] py-0.5">
                                {v}
                            </Badge>
                        ))}
                    </div>
               </div>
            </div>
          ) : (
            <div className="border border-slate-100 rounded-2xl overflow-hidden bg-slate-50 text-start">
                <div className="bg-white border-b p-6 space-y-4">
                    <div className="flex gap-4">
                        <span className="text-xs font-bold text-slate-400 w-16 uppercase tracking-wider">{t('to')}:</span>
                        <span className="text-xs font-medium text-slate-700">John Doe &lt;j.doe@example.com&gt;</span>
                    </div>
                    <div className="flex gap-4">
                        <span className="text-xs font-bold text-slate-400 w-16 uppercase tracking-wider">{t('from')}:</span>
                        <span className="text-xs font-medium text-slate-700">NIS Connect Support &lt;support@nis-egypt.com&gt;</span>
                    </div>
                    <div className="flex gap-4">
                        <span className="text-xs font-bold text-slate-400 w-16 uppercase tracking-wider">{t('emailSubject')}:</span>
                        <span className="text-sm font-black text-slate-900">{renderPreview(localSettings.subject)}</span>
                    </div>
                </div>
                <div className="p-10 bg-white min-h-[400px]">
                    <div className="max-w-xl mx-auto whitespace-pre-wrap text-sm text-slate-700 leading-loose font-medium">
                        {renderPreview(localSettings.body)}
                    </div>
                    <div className="max-w-xl mx-auto mt-20 pt-8 border-t border-slate-100 text-[11px] text-slate-400 text-center font-bold uppercase tracking-widest">
                        Sent via NIS Connect Automated Response
                    </div>
                </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

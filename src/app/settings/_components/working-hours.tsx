'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCollection, useFirebase, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, query, orderBy, doc } from 'firebase/firestore';
import type { Department, WorkingHours, UserProfile } from '@/lib/types';
import { WEEKDAYS, DEFAULT_WORKING_HOURS } from '@/lib/types';
import { Loader2, Save, Clock, CalendarDays } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { updateDepartmentWorkingHoursAction } from '@/actions/department_actions';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/hooks/use-language';

export function DepartmentWorkingHours() {
  const { firestore } = useFirebase();
  const { user: currentUser } = useUser();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [isSaving, setIsSaving] = useState(false);
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);

  const userProfileRef = useMemoFirebase(() => 
    currentUser && firestore ? doc(firestore, 'users', currentUser.uid) : null,
    [currentUser, firestore]
  );
  const { data: userProfile } = useDoc<UserProfile>(userProfileRef);

  const deptsQuery = useMemoFirebase(() => 
    firestore ? query(collection(firestore, 'departments'), orderBy('name', 'asc')) : null, 
    [firestore]
  );
  const { data: departments, isLoading } = useCollection<Department>(deptsQuery);

  const filteredDepartments = useMemo(() => {
    if (!departments || !userProfile) return [];
    if (userProfile.role === 'Admin') return departments;
    if (userProfile.role === 'Manager' && userProfile.departmentId) {
      return departments.filter(d => d.id === userProfile.departmentId);
    }
    return [];
  }, [departments, userProfile]);

  useEffect(() => {
    if (filteredDepartments.length === 1 && !selectedDeptId) {
      setSelectedDeptId(filteredDepartments[0].id);
    }
  }, [filteredDepartments, selectedDeptId]);

  const [localWorkingHours, setLocalWorkingHours] = useState<WorkingHours>(DEFAULT_WORKING_HOURS);

  useEffect(() => {
    if (selectedDeptId && departments) {
      const dept = departments.find(d => d.id === selectedDeptId);
      if (dept?.workingHours) {
        setLocalWorkingHours(dept.workingHours);
      } else {
        setLocalWorkingHours(DEFAULT_WORKING_HOURS);
      }
    }
  }, [selectedDeptId, departments]);

  const handleDayToggle = (day: string, isOpen: boolean) => {
    setLocalWorkingHours(prev => ({
      ...prev,
      [day]: { ...prev[day], isOpen }
    }));
  };

  const handleTimeChange = (day: string, field: 'start' | 'end', value: string) => {
    setLocalWorkingHours(prev => ({
      ...prev,
      [day]: { ...prev[day], [field]: value }
    }));
  };

  const handleSave = async () => {
    if (!selectedDeptId || !currentUser) return;
    setIsSaving(true);
    
    const result = await updateDepartmentWorkingHoursAction(
        selectedDeptId,
        localWorkingHours,
        { userId: currentUser.uid, name: currentUser.displayName || 'Admin' }
    );

    if (result.success) {
      toast({ title: '✅ Success!', description: result.message });
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSaving(false);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-none shadow-sm bg-white overflow-hidden">
        <CardHeader className="bg-slate-50/50 border-b px-6 py-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1 text-start">
              <CardTitle className="text-xl font-bold flex items-center gap-2">
                <Clock className="h-5 w-5 text-indigo-600" />
                {t('workingHoursByCategory')}
              </CardTitle>
              <CardDescription>
                {userProfile?.role === 'Manager' 
                  ? t('manageOrg')
                  : t('manageOrg')}
              </CardDescription>
            </div>
            <Button 
                onClick={handleSave} 
                disabled={isSaving || !selectedDeptId}
                className="bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white gap-2 shadow-sm font-bold"
            >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t('saveHours')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {filteredDepartments.length > 1 && (
            <div className="max-w-md mb-8 text-start">
              <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">
                  {t('selectCategoryToConfigure')}
              </Label>
              <Select onValueChange={setSelectedDeptId} value={selectedDeptId || undefined}>
                <SelectTrigger className="h-11 border-slate-200">
                  <SelectValue placeholder={t('allCategories')} />
                </SelectTrigger>
                <SelectContent>
                  {filteredDepartments.map((dept) => (
                    <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {selectedDeptId ? (
            <div className="grid gap-4">
               <div className="hidden md:grid grid-cols-4 gap-4 px-4 py-2 bg-slate-50 rounded-lg text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                    <div className="col-span-1 text-start">{t('day')}</div>
                    <div className="col-span-1 text-start">{t('status')}</div>
                    <div className="col-span-1 text-center">{t('startTime')}</div>
                    <div className="col-span-1 text-center">{t('endTime')}</div>
               </div>

               <div className="divide-y divide-slate-100">
                  {WEEKDAYS.map((day) => {
                    const config = localWorkingHours[day] || DEFAULT_WORKING_HOURS[day];
                    return (
                        <div key={day} className="grid grid-cols-1 md:grid-cols-4 items-center gap-4 py-4 px-4 hover:bg-slate-50/50 transition-colors">
                            <div className="flex items-center gap-2 text-start">
                                <CalendarDays className="h-4 w-4 text-slate-400" />
                                <span className="font-bold text-slate-700">{t(day) || day}</span>
                            </div>
                            
                            <div className="flex items-center gap-3 text-start">
                                <Switch 
                                    checked={config.isOpen} 
                                    onCheckedChange={(val) => handleDayToggle(day, val)}
                                    className="data-[state=checked]:bg-emerald-500 scale-90"
                                />
                                <span className={cn(
                                    "text-xs font-bold uppercase tracking-tight",
                                    config.isOpen ? "text-emerald-600" : "text-slate-400"
                                )}>
                                    {config.isOpen ? t('open') : t('closed')}
                                </span>
                            </div>

                            <div className="flex items-center justify-center">
                                <Input 
                                    type="time" 
                                    disabled={!config.isOpen}
                                    value={config.start}
                                    onChange={(e) => handleTimeChange(day, 'start', e.target.value)}
                                    className="h-9 w-32 text-center font-semibold border-slate-200"
                                />
                            </div>

                            <div className="flex items-center justify-center">
                                <Input 
                                    type="time" 
                                    disabled={!config.isOpen}
                                    value={config.end}
                                    onChange={(e) => handleTimeChange(day, 'end', e.target.value)}
                                    className="h-9 w-32 text-center font-semibold border-slate-200"
                                />
                            </div>
                        </div>
                    );
                  })}
               </div>
            </div>
          ) : (
            <div className="py-20 text-center border border-dashed rounded-2xl bg-slate-50/50">
                <Clock className="h-10 w-10 text-slate-200 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">{t('selectCategoryToConfigure')}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

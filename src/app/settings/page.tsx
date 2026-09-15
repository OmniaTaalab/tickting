
'use client';
import { useUser, useFirebase, useDoc, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import type { UserProfile } from '@/lib/types';
import { useLanguage } from "@/hooks/use-language";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { DepartmentList } from "./_components/department-list";
import { GradeList } from "./_components/grade-list";
import { CampusList } from "./_components/campus-list";
import { SchoolList } from "./_components/school-list";
import { DivisionList } from "./_components/division-list";
import { TagList } from "./_components/tag-list";
import { SettingsStats } from "./_components/settings-stats";
import { EmployeeManagement } from "./_components/employee-management";
import { SLAPolicies } from "./_components/sla-policies";
import { DepartmentWorkingHours } from "./_components/working-hours";
import { AfterHoursEmailSettingsPanel } from "./_components/after-hours-email-settings";
import { ActionLogTab } from "./_components/action-log-tab";
import { Building2, Users2, LayoutGrid, ShieldCheck, Clock8, Tags, Clock, Mail, ScrollText } from "lucide-react";

export default function SettingsPage() {
    const { user: currentUser, isUserLoading } = useUser();
    const { firestore } = useFirebase();
    const { t } = useLanguage();

    const userProfileRef = useMemoFirebase(() => 
        currentUser && firestore ? doc(firestore, 'users', currentUser.uid) : null,
        [currentUser, firestore]
    );
    const { data: userProfile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef);

    const isLoading = isUserLoading || isProfileLoading;

    if (isLoading) {
        return (
            <div className="space-y-8 max-w-7xl mx-auto">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                    {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
                </div>
                <Skeleton className="h-[600px] w-full rounded-xl" />
            </div>
        );
    }

    const isAdmin = userProfile?.role === 'Admin';
    const isManager = userProfile?.role === 'Manager';

    if (!isAdmin && !isManager) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Card className="max-w-md w-full border-none shadow-lg">
                    <CardHeader className="text-center">
                        <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
                            <ShieldCheck className="h-6 w-6 text-red-600" />
                        </div>
                        <CardTitle className="text-xl">Access Restricted</CardTitle>
                        <CardDescription>
                            This area is reserved for system administrators and managers only.
                        </CardDescription>
                    </CardHeader>
                </Card>
            </div>
        );
    }

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-10">
      {/* Page Header */}
      <div className="space-y-1 text-start">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 font-headline">{t('adminSettings')}</h1>
        <p className="text-slate-500 font-medium">{t('manageOrg')}</p>
      </div>

      {/* Quick Stats Overview - Visible to Admins and Managers */}
      <SettingsStats />

      {/* Main Settings Tabs - Default to structure (Branches Settings) */}
      <Tabs defaultValue="structure" className="w-full space-y-6">
        <TabsList className="bg-slate-100/50 p-1 border h-12 items-stretch gap-1">
            <TabsTrigger 
                value="structure" 
                className="data-[state=active]:bg-[#1e3a8a] data-[state=active]:text-white data-[state=active]:shadow-sm px-6 gap-2 transition-all font-bold text-xs uppercase tracking-tight"
            >
                <LayoutGrid className="h-4 w-4" />
                {t('branchesSettings')}
            </TabsTrigger>
            <TabsTrigger 
                value="staff" 
                className="data-[state=active]:bg-[#1e3a8a] data-[state=active]:text-white data-[state=active]:shadow-sm px-6 gap-2 transition-all font-bold text-xs uppercase tracking-tight"
            >
                <Users2 className="h-4 w-4" />
                {t('employeeMgmt')}
            </TabsTrigger>
            <TabsTrigger 
                value="working-hours" 
                className="data-[state=active]:bg-[#1e3a8a] data-[state=active]:text-white data-[state=active]:shadow-sm px-6 gap-2 transition-all font-bold text-xs uppercase tracking-tight"
            >
                <Clock className="h-4 w-4" />
                {t('workingHours')}
            </TabsTrigger>
            <TabsTrigger 
                value="tags" 
                className="data-[state=active]:bg-[#1e3a8a] data-[state=active]:text-white data-[state=active]:shadow-sm px-6 gap-2 transition-all font-bold text-xs uppercase tracking-tight"
            >
                <Tags className="h-4 w-4" />
                {t('tagsSettings')}
            </TabsTrigger>
            <TabsTrigger 
                value="sla" 
                className="data-[state=active]:bg-[#1e3a8a] data-[state=active]:text-white data-[state=active]:shadow-sm px-6 gap-2 transition-all font-bold text-xs uppercase tracking-tight"
            >
                <Clock8 className="h-4 w-4" />
                {t('slaPolicies')}
            </TabsTrigger>
            <TabsTrigger 
                value="after-hours-email" 
                className="data-[state=active]:bg-[#1e3a8a] data-[state=active]:text-white data-[state=active]:shadow-sm px-6 gap-2 transition-all font-bold text-xs uppercase tracking-tight"
            >
                <Mail className="h-4 w-4" />
                {t('afterHoursEmail')}
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger 
                  value="system-log" 
                  className="data-[state=active]:bg-[#1e3a8a] data-[state=active]:text-white data-[state=active]:shadow-sm px-6 gap-2 transition-all font-bold text-xs uppercase tracking-tight"
              >
                  <ScrollText className="h-4 w-4" />
                  {t('systemLog')}
              </TabsTrigger>
            )}
        </TabsList>

        {/* BRANCHES SETTINGS TAB */}
        <TabsContent value="structure" className="space-y-6 animate-in fade-in-50 duration-500">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Categories Card */}
                <Card className="border-none shadow-sm overflow-hidden bg-white">
                    <CardHeader className="bg-slate-50/50 border-b text-start">
                        <CardTitle className="text-lg font-bold">{t('categories')}</CardTitle>
                        <CardDescription>{t('categoriesSub')}</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <DepartmentList />
                    </CardContent>
                </Card>

                {/* Divisions Card */}
                <Card className="border-none shadow-sm overflow-hidden bg-white">
                    <CardHeader className="bg-slate-50/50 border-b text-start">
                        <CardTitle className="text-lg font-bold">{t('divisions')}</CardTitle>
                        <CardDescription>{t('divisionsSub')}</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <DivisionList />
                    </CardContent>
                </Card>

                {/* Schools Card */}
                <Card className="border-none shadow-sm overflow-hidden bg-white">
                    <CardHeader className="bg-slate-50/50 border-b text-start">
                        <CardTitle className="text-lg font-bold">{t('schools')}</CardTitle>
                        <CardDescription>{t('schoolsSub')}</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <SchoolList />
                    </CardContent>
                </Card>

                {/* Campuses Card */}
                <Card className="border-none shadow-sm overflow-hidden bg-white">
                    <CardHeader className="bg-slate-50/50 border-b text-start">
                        <CardTitle className="text-lg font-bold">{t('campuses')}</CardTitle>
                        <CardDescription>{t('campusesSub')}</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <CampusList />
                    </CardContent>
                </Card>

                {/* Grades Card */}
                <Card className="border-none shadow-sm overflow-hidden bg-white lg:col-span-2">
                    <CardHeader className="bg-slate-50/50 border-b text-start">
                        <CardTitle className="text-lg font-bold">{t('grades')}</CardTitle>
                        <CardDescription>{t('gradesSub')}</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <GradeList />
                    </CardContent>
                </Card>
            </div>
        </TabsContent>

        {/* STAFF MANAGEMENT TAB */}
        <TabsContent value="staff" className="animate-in fade-in-50 duration-500">
            <EmployeeManagement />
        </TabsContent>

        {/* WORKING HOURS TAB */}
        <TabsContent value="working-hours" className="animate-in fade-in-50 duration-500">
            <DepartmentWorkingHours />
        </TabsContent>

        {/* TAGS SETTINGS TAB */}
        <TabsContent value="tags" className="animate-in fade-in-50 duration-500">
             <Card className="border-none shadow-sm overflow-hidden bg-white">
                <CardHeader className="bg-slate-50/50 border-b px-6 py-6 text-start">
                    <CardTitle className="text-xl font-bold flex items-center gap-2">
                        <Tags className="h-5 w-5 text-indigo-600" />
                        {t('tagsSettings')}
                    </CardTitle>
                    <CardDescription>
                        {t('tagsDescription')}
                    </CardDescription>
                </CardHeader>
                <CardContent className="pt-6">
                    <TagList />
                </CardContent>
            </Card>
        </TabsContent>

        {/* SLA POLICIES TAB */}
        <TabsContent value="sla" className="animate-in fade-in-50 duration-500">
            <SLAPolicies />
        </TabsContent>

        {/* AFTER-HOURS EMAIL TAB */}
        <TabsContent value="after-hours-email" className="animate-in fade-in-50 duration-500">
            <AfterHoursEmailSettingsPanel />
        </TabsContent>

        {/* SYSTEM LOG TAB - ADMIN ONLY */}
        {isAdmin && (
          <TabsContent value="system-log" className="animate-in fade-in-50 duration-500">
              <ActionLogTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

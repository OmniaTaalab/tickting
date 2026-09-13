'use client';
import { useCollection, useFirebase, useMemoFirebase } from "@/firebase";
import { collection, query } from "firebase/firestore";
import type { Department, Division, School, UserProfile, Campus } from '@/lib/types';
import { Card, CardContent } from "@/components/ui/card";
import { Building2, Users2, Layers, School as SchoolIcon, LayoutGrid } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";

export function SettingsStats() {
    const { firestore } = useFirebase();
    const { t } = useLanguage();

    const deptsQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'departments')) : null, [firestore]);
    const divisionsQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'divisions')) : null, [firestore]);
    const schoolsQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'schools')) : null, [firestore]);
    const campusesQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'campuses')) : null, [firestore]);
    const staffQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'users')) : null, [firestore]);

    const { data: depts } = useCollection<Department>(deptsQuery);
    const { data: divisions } = useCollection<Division>(divisionsQuery);
    const { data: schools } = useCollection<School>(schoolsQuery);
    const { data: campuses } = useCollection<Campus>(campusesQuery);
    const { data: staff } = useCollection<UserProfile>(staffQuery);

    const stats = [
        { label: t('staffMembers'), value: staff?.length || 0, icon: Users2, color: "text-blue-600", bg: "bg-blue-50" },
        { label: t('campuses'), value: campuses?.length || 0, icon: Building2, color: "text-blue-500", bg: "bg-blue-50/50" },
        { label: t('schools'), value: schools?.length || 0, icon: SchoolIcon, color: "text-emerald-600", bg: "bg-emerald-50" },
        { label: t('divisions'), value: divisions?.length || 0, icon: LayoutGrid, color: "text-indigo-600", bg: "bg-indigo-50" },
        { label: t('categories'), value: depts?.length || 0, icon: Layers, color: "text-blue-600", bg: "bg-blue-50" },
    ];

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {stats.map((stat) => (
                <Card key={stat.label} className="border-none shadow-sm hover:shadow-md transition-shadow bg-white">
                    <CardContent className="p-6 flex items-center gap-4">
                        <div className={`p-3 rounded-xl ${stat.bg} shrink-0`}>
                            <stat.icon className={`h-6 w-6 ${stat.color}`} />
                        </div>
                        <div className="min-w-0">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">{stat.label}</p>
                            <h3 className="text-2xl font-black text-slate-900 leading-none mt-1">{stat.value}</h3>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

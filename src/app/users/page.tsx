
'use client';

import { useState, useMemo } from 'react';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import type { UserProfile, Department, Division } from '@/lib/types';
import { useCollection, useFirebase, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, query, orderBy, doc } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { PlusCircle, Search, MoreHorizontal, Pencil, Trash2, RotateCcw, X, Filter } from 'lucide-react';
import { CreateUserLoginDialog } from './_components/create-user-login-dialog';
import { CreateUserDialog } from './_components/create-user-dialog';
import { DeleteUserDialog } from './_components/delete-user-dialog';
import { EditUserDialog } from './_components/edit-user-dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/hooks/use-language';

const avatarBgColors = [
    'bg-[#ef4444]', // Red
    'bg-[#ec4899]', // Pink
    'bg-[#3b82f6]', // Blue
    'bg-[#10b981]', // Green
    'bg-[#f59e0b]', // Amber
    'bg-[#8b5cf6]', // Purple
    'bg-[#64748b]', // Slate
    'bg-[#f97316]', // Orange
    'bg-[#06b6d4]', // Cyan
    'bg-[#14b8a6]', // Teal
    'bg-[#84cc16]', // Lime
    'bg-[#0ea5e9]', // Sky
];

const getAvatarColor = (name: string) => {
    const total = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return avatarBgColors[total % avatarBgColors.length];
};

const getInitials = (name: string) => {
    return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .substring(0, 2);
};

const getDivisionStyle = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes('early') || lower.includes('years')) return 'bg-pink-100 text-pink-600 border-pink-100';
    if (lower.includes('elementary')) return 'bg-sky-100 text-sky-600 border-sky-100';
    if (lower.includes('middle')) return 'bg-emerald-100 text-emerald-600 border-emerald-100';
    if (lower.includes('high')) return 'bg-amber-100 text-amber-600 border-amber-100';
    if (lower.includes('ib') || lower.includes('diploma')) return 'bg-purple-100 text-purple-600 border-purple-100';
    if (lower.includes('operations')) return 'bg-slate-100 text-slate-600 border-slate-200';
    if (lower.includes('facilities')) return 'bg-blue-50 text-blue-500 border-blue-100';
    if (lower.includes('transport')) return 'bg-orange-100 text-orange-600 border-orange-100';
    if (lower.includes('admissions')) return 'bg-rose-100 text-rose-600 border-rose-100';
    if (lower.includes('front')) return 'bg-teal-100 text-teal-600 border-teal-100';
    if (lower.includes('finance')) return 'bg-lime-100 text-lime-700 border-lime-200';
    return 'bg-slate-100 text-slate-500 border-slate-200';
};

function StaffCard({ 
    user, 
    departmentName, 
    divisionNames,
    onEdit, 
    onDelete, 
    onCreateLogin 
}: { 
    user: UserProfile; 
    departmentName: string;
    divisionNames: string[];
    onEdit: (user: UserProfile) => void;
    onDelete: (user: UserProfile) => void;
    onCreateLogin: (user: UserProfile) => void;
}) {
    const router = useRouter();
    
    return (
        <div className="relative group bg-white border border-slate-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all duration-300 flex items-start gap-4">
            <Avatar className={cn("h-12 w-12 shrink-0 shadow-sm border-2 border-white", getAvatarColor(user.name))}>
                <AvatarFallback className="text-white font-bold text-sm tracking-tighter">
                    {getInitials(user.name)}
                </AvatarFallback>
            </Avatar>
            
            <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                    <h3 
                        className="font-bold text-slate-800 text-[15px] truncate cursor-pointer hover:text-primary transition-colors"
                        onClick={() => router.push(`/users/${user.id}`)}
                    >
                        {user.name}
                    </h3>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-300 hover:text-slate-600 transition-colors">
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onEdit(user)}>
                                <Pencil className="mr-2 h-4 w-4" /> Edit
                            </DropdownMenuItem>
                            {!user.authId && (
                                <DropdownMenuItem onClick={() => onCreateLogin(user)}>
                                    <PlusCircle className="mr-2 h-4 w-4" /> Create Login
                                </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => onDelete(user)} className="text-destructive">
                                <Trash2 className="mr-2 h-4 w-4" /> Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                
                <p className="text-[13px] text-slate-500 font-medium leading-tight mb-2">{user.role}</p>
                
                <div className="flex flex-wrap gap-1 mb-3">
                    <Badge variant="secondary" className="text-[10px] px-2 py-0.5 h-auto font-bold bg-slate-100 text-slate-500 border-0 uppercase tracking-tight">
                        {departmentName}
                    </Badge>
                    {divisionNames.map((divName, idx) => (
                         <Badge key={idx} variant="outline" className={cn("text-[10px] px-2 py-0.5 h-auto font-bold border rounded-md uppercase tracking-tight", getDivisionStyle(divName))}>
                            {divName}
                        </Badge>
                    ))}
                </div>
                
                <p className="text-[11px] text-slate-400 truncate hover:text-slate-600 transition-colors">{user.email}</p>
            </div>
        </div>
    );
}

export default function ManageUsersPage() {
    const { user: currentUser, isUserLoading } = useUser();
    const { firestore } = useFirebase();
    const { t } = useLanguage();
    
    const [isCreateUserOpen, setCreateUserOpen] = useState(false);
    const [isLoginOpen, setLoginOpen] = useState(false);
    const [isDeleteOpen, setDeleteOpen] = useState(false);
    const [isEditOpen, setEditOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
    const [dialogKey, setDialogKey] = useState(0);

    // Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [roleFilter, setRoleFilter] = useState<string>('all');
    const [departmentFilter, setDepartmentFilter] = useState<string>('all');
    const [divisionFilter, setDivisionFilter] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<string>('all');

    const userProfileRef = useMemoFirebase(() => 
        currentUser && firestore ? doc(firestore, 'users', currentUser.uid) : null,
        [currentUser, firestore]
    );
    const { data: userProfile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef);

    const usersQuery = useMemoFirebase(() => {
        if (!firestore) return null;
        return query(collection(firestore, 'users'), orderBy('name', 'asc'));
    }, [firestore]);
    const { data: allUsers, isLoading: areUsersLoading } = useCollection<UserProfile>(usersQuery);

    const deptsQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'departments'), orderBy('name', 'asc')) : null, [firestore]);
    const { data: departments } = useCollection<Department>(deptsQuery);
    const departmentsMap = useMemo(() => new Map(departments?.map(d => [d.id, d.name])), [departments]);

    const divisionsQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'divisions'), orderBy('name', 'asc')) : null, [firestore]);
    const { data: divisions } = useCollection<Division>(divisionsQuery);
    const divisionsMap = useMemo(() => new Map(divisions?.map(d => [d.id, d.name])), [divisions]);

    const filteredUsers = useMemo(() => {
        if (!allUsers) return [];
        
        let result = [...allUsers];

        // Role filter
        if (roleFilter !== 'all') {
            result = result.filter(u => u.role === roleFilter);
        }
        
        // Department filter
        if (departmentFilter !== 'all') {
            result = result.filter(u => u.departmentId === departmentFilter);
        }

        // Division filter
        if (divisionFilter !== 'all') {
            result = result.filter(u => u.divisionIds && u.divisionIds.includes(divisionFilter));
        }

        // Status filter
        if (statusFilter !== 'all') {
            result = result.filter(u => {
                if (statusFilter === 'Available') return u.status === 'Available' || !u.status;
                return u.status === statusFilter;
            });
        }

        // Search text
        if (searchTerm.trim()) {
            const lowerSearch = searchTerm.toLowerCase().trim();
            result = result.filter(u => 
                (u.name && u.name.toLowerCase().includes(lowerSearch)) || 
                (u.email && u.email.toLowerCase().includes(lowerSearch))
            );
        }

        return result;
    }, [allUsers, roleFilter, departmentFilter, divisionFilter, statusFilter, searchTerm]);

    const handleResetFilters = () => {
        setSearchTerm('');
        setRoleFilter('all');
        setDepartmentFilter('all');
        setDivisionFilter('all');
        setStatusFilter('all');
    };

    const hasActiveFilters = searchTerm.trim() !== '' || roleFilter !== 'all' || departmentFilter !== 'all' || divisionFilter !== 'all' || statusFilter !== 'all';

    const isLoading = isUserLoading || isProfileLoading || areUsersLoading;

    if (isLoading && !allUsers) {
        return (
            <div className="space-y-6">
                <div className="flex justify-between items-center">
                    <Skeleton className="h-10 w-48" />
                    <Skeleton className="h-10 w-32" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 max-w-7xl mx-auto pb-10">
            {isCreateUserOpen && userProfile && (
              <CreateUserDialog 
                key={`create-${dialogKey}`}
                isOpen={isCreateUserOpen} 
                onClose={() => setCreateUserOpen(false)} 
                currentUserProfile={userProfile}
              />
            )}
            {isEditOpen && selectedUser && userProfile && (
                <EditUserDialog
                    key={`edit-${selectedUser.id}-${dialogKey}`}
                    isOpen={isEditOpen}
                    onClose={() => { setEditOpen(false); setSelectedUser(null); }}
                    user={selectedUser}
                    currentUserProfile={userProfile}
                />
            )}
            {isDeleteOpen && selectedUser && (
                <DeleteUserDialog
                    key={`delete-${selectedUser.id}-${dialogKey}`}
                    isOpen={isDeleteOpen}
                    onClose={() => { setDeleteOpen(false); setSelectedUser(null); }}
                    user={selectedUser}
                />
            )}
            {isLoginOpen && selectedUser && (
                <CreateUserLoginDialog
                    key={`login-${selectedUser.id}-${dialogKey}`}
                    isOpen={isLoginOpen}
                    onClose={() => { setLoginOpen(false); setSelectedUser(null); }}
                    user={selectedUser}
                />
            )}

            {/* PAGE HEADER */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 font-headline">Staff Directory</h1>
                    <p className="text-sm text-slate-500 font-medium">
                        {filteredUsers.length} staff members across {departments?.length || 0} departments
                    </p>
                </div>
                <Button 
                    onClick={() => { setDialogKey(k => k + 1); setCreateUserOpen(true); }} 
                    className="bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white rounded-xl h-11 px-6 shadow-md gap-2 transition-all hover:scale-105 active:scale-95 self-start sm:self-auto"
                >
                    <PlusCircle className="h-4 w-4" />
                    {t('addEmployee')}
                </Button>
            </div>

            {/* FILTERS TOOLBAR */}
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    {/* Search */}
                    <div className="relative lg:col-span-1 sm:col-span-2">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                            type="search"
                            placeholder={t('searchUsersPlaceholder')}
                            className="pl-9 h-10 bg-slate-50 border-slate-200 rounded-xl text-xs focus:bg-white transition-colors"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    {/* Role Filter */}
                    <div>
                        <Select value={roleFilter} onValueChange={setRoleFilter}>
                            <SelectTrigger className="h-10 bg-slate-50 border-slate-200 rounded-xl text-xs font-semibold">
                                <SelectValue placeholder={t('allRoles')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('allRoles')}</SelectItem>
                                <SelectItem value="Manager">Manager</SelectItem>
                                <SelectItem value="Employee">Employee</SelectItem>
                                <SelectItem value="Admin">Admin</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Department Filter */}
                    <div>
                        <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                            <SelectTrigger className="h-10 bg-slate-50 border-slate-200 rounded-xl text-xs font-semibold">
                                <SelectValue placeholder={t('filterByDepartment')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('allCategories')}</SelectItem>
                                {departments?.map(dept => (
                                    <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Division Filter */}
                    <div>
                        <Select value={divisionFilter} onValueChange={setDivisionFilter}>
                            <SelectTrigger className="h-10 bg-slate-50 border-slate-200 rounded-xl text-xs font-semibold">
                                <SelectValue placeholder={t('filterByDivision')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('allDivisions')}</SelectItem>
                                {divisions?.map(div => (
                                    <SelectItem key={div.id} value={div.id}>{div.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Status Filter */}
                    <div>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="h-10 bg-slate-50 border-slate-200 rounded-xl text-xs font-semibold">
                                <SelectValue placeholder={t('allAvailability')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('allAvailability')}</SelectItem>
                                <SelectItem value="Available">{t('statusAvailable')}</SelectItem>
                                <SelectItem value="Busy">{t('statusBusy')}</SelectItem>
                                <SelectItem value="Away">{t('statusAway')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Filter Summary & Reset */}
                {hasActiveFilters && (
                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                        <span className="text-slate-500 font-medium">
                            {filteredUsers.length} / {allUsers?.length || 0} {t('systemEmployees')}
                        </span>
                        <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={handleResetFilters} 
                            className="h-7 text-xs font-bold text-slate-500 hover:text-red-600 gap-1.5"
                        >
                            <RotateCcw className="h-3 w-3" />
                            {t('resetFilters')}
                        </Button>
                    </div>
                )}
            </div>

            {/* STAFF GRID */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredUsers.map((user) => {
                    const divNames = (user.divisionIds || []).map(id => divisionsMap.get(id) || id);
                    return (
                        <StaffCard 
                            key={user.id} 
                            user={user} 
                            departmentName={user.departmentId ? departmentsMap.get(user.departmentId) || user.departmentId : 'N/A'}
                            divisionNames={divNames}
                            onEdit={(u) => { setSelectedUser(u); setDialogKey(k => k + 1); setEditOpen(true); }}
                            onDelete={(u) => { setSelectedUser(u); setDialogKey(k => k + 1); setDeleteOpen(true); }}
                            onCreateLogin={(u) => { setSelectedUser(u); setDialogKey(k => k + 1); setLoginOpen(true); }}
                        />
                    );
                })}
            </div>

            {!areUsersLoading && filteredUsers.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed rounded-3xl bg-slate-50/50">
                    <div className="p-4 rounded-full bg-slate-100 mb-4">
                        <Search className="h-8 w-8 text-slate-400" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800">{t('noUsersFound')}</h3>
                    <p className="text-slate-500 max-w-xs mx-auto mt-1 text-sm">
                        Try adjusting your filters or search term to find staff members.
                    </p>
                    {hasActiveFilters && (
                        <Button variant="outline" size="sm" onClick={handleResetFilters} className="mt-4 gap-2">
                            <RotateCcw className="h-3.5 w-3.5" />
                            {t('resetFilters')}
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}

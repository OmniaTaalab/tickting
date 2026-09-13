'use client';

import { useState, useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { UserProfile, Department, Division, Campus } from '@/lib/types';
import { useCollection, useFirebase, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, query, orderBy, doc } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Search, UserPlus, Users2, MoreHorizontal, Pencil, Trash2, Key } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { CreateUserDialog } from '@/app/users/_components/create-user-dialog';
import { EditUserDialog } from '@/app/users/_components/edit-user-dialog';
import { DeleteUserDialog } from '@/app/users/_components/delete-user-dialog';
import { CreateUserLoginDialog } from '@/app/users/_components/create-user-login-dialog';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/hooks/use-language';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function EmployeeManagement() {
    const { firestore } = useFirebase();
    const { user: currentUser } = useUser();
    const { t } = useLanguage();
    const router = useRouter();
    const [searchTerm, setSearchTerm] = useState('');
    
    // Dialog States
    const [isCreateOpen, setCreateOpen] = useState(false);
    const [isEditOpen, setEditOpen] = useState(false);
    const [isDeleteOpen, setDeleteOpen] = useState(false);
    const [isLoginOpen, setLoginOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);

    const userProfileRef = useMemoFirebase(() => 
        currentUser && firestore ? doc(firestore, 'users', currentUser.uid) : null,
        [currentUser, firestore]
    );
    const { data: userProfile } = useDoc<UserProfile>(userProfileRef);

    const usersQuery = useMemoFirebase(() => 
        firestore ? query(collection(firestore, 'users'), orderBy('name', 'asc')) : null,
        [firestore]
    );
    const { data: users, isLoading: areUsersLoading } = useCollection<UserProfile>(usersQuery);

    const deptsQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'departments')) : null, [firestore]);
    const { data: depts } = useCollection<Department>(deptsQuery);
    const deptsMap = useMemo(() => new Map(depts?.map(d => [d.id, d.name])), [depts]);

    const divisionsQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'divisions')) : null, [firestore]);
    const { data: divisions } = useCollection<Division>(divisionsQuery);
    const divisionsMap = useMemo(() => new Map(divisions?.map(d => [d.id, d.name])), [divisions]);

    const campusesQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'campuses')) : null, [firestore]);
    const { data: campuses } = useCollection<Campus>(campusesQuery);
    const campusesMap = useMemo(() => new Map(campuses?.map(c => [c.id, c.name])), [campuses]);

    const filteredUsers = useMemo(() => {
        if (!users || !userProfile) return null;
        let result = [...users];
        
        // If Manager, only show employees in their category
        if (userProfile.role === 'Manager') {
            result = result.filter(u => u.departmentId === userProfile.departmentId);
        }

        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            result = result.filter(u => u.name.toLowerCase().includes(lower) || u.email.toLowerCase().includes(lower));
        }
        return result;
    }, [users, searchTerm, userProfile]);

    const handleEdit = (user: UserProfile) => {
        setSelectedUser(user);
        setEditOpen(true);
    };

    const handleDelete = (user: UserProfile) => {
        setSelectedUser(user);
        setDeleteOpen(true);
    };

    const handleCreateLogin = (user: UserProfile) => {
        setSelectedUser(user);
        setLoginOpen(true);
    };

    return (
        <Card className="border-none shadow-sm bg-white overflow-hidden">
            {/* DIALOGS */}
            {isCreateOpen && userProfile && (
                <CreateUserDialog 
                    isOpen={isCreateOpen} 
                    onClose={() => setCreateOpen(false)} 
                    currentUserProfile={userProfile} 
                />
            )}
            {isEditOpen && selectedUser && userProfile && (
                <EditUserDialog
                    isOpen={isEditOpen}
                    onClose={() => { setEditOpen(false); setSelectedUser(null); }}
                    user={selectedUser}
                    currentUserProfile={userProfile}
                />
            )}
            <DeleteUserDialog
                key={selectedUser?.id || 'none'}
                isOpen={isDeleteOpen}
                onClose={() => { setDeleteOpen(false); setSelectedUser(null); }}
                user={selectedUser}
            />
            {isLoginOpen && selectedUser && (
                <CreateUserLoginDialog
                    isOpen={isLoginOpen}
                    onClose={() => { setLoginOpen(false); setSelectedUser(null); }}
                    user={selectedUser}
                />
            )}

            <CardHeader className="bg-slate-50/50 border-b px-6 py-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="text-start">
                        <CardTitle className="text-xl font-bold flex items-center gap-2">
                            {userProfile?.role === 'Manager' ? t('myCategoryStaff') : t('systemEmployees')}
                            <Badge variant="secondary" className="font-mono text-[10px]">{filteredUsers?.length || 0}</Badge>
                        </CardTitle>
                        <CardDescription>
                            {userProfile?.role === 'Manager' 
                                ? `${t('manageOrg')} ${deptsMap.get(userProfile.departmentId || '') || ''}`
                                : t('manageOrg')}
                        </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="relative max-w-sm">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input 
                                placeholder={t('searchEmployees')} 
                                className="pl-9 h-10 w-[250px] bg-white border-slate-200 focus:ring-indigo-500"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <Button 
                            onClick={() => setCreateOpen(true)} 
                            className="bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white shadow-sm gap-2 font-bold"
                        >
                            <UserPlus className="h-4 w-4" />
                            {t('addEmployee')}
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader className="bg-slate-50/30">
                            <TableRow>
                                <TableHead className="pl-6 py-4 text-start">{t('employee')}</TableHead>
                                <TableHead className="text-start">{t('role')}</TableHead>
                                <TableHead className="text-start">{t('categories')}</TableHead>
                                <TableHead className="text-start">{t('divisions')}</TableHead>
                                <TableHead className="text-start">{t('campuses')}</TableHead>
                                <TableHead className="text-start">{t('accountStatus')}</TableHead>
                                <TableHead className="text-end pr-6">{t('actions')}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {areUsersLoading ? (
                                [...Array(5)].map((_, i) => (
                                    <TableRow key={i}>
                                        <TableCell className="pl-6"><Skeleton className="h-10 w-48" /></TableCell>
                                        <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                                        <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                                        <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                                        <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                                        <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                                        <TableCell className="text-right pr-6"><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                filteredUsers?.map((user) => (
                                    <TableRow 
                                        key={user.id} 
                                        className="group hover:bg-slate-50/50 transition-colors"
                                    >
                                        <TableCell className="pl-6 py-4 text-start">
                                            <div 
                                                className="flex items-center gap-3 cursor-pointer"
                                                onClick={() => router.push(`/users/${user.id}`)}
                                            >
                                                <Avatar className="h-10 w-10 border-2 border-white shadow-sm">
                                                    <AvatarImage src={user.avatarUrl} alt={user.name} />
                                                    <AvatarFallback className="bg-indigo-50 text-indigo-700 font-bold">
                                                        {user.name.charAt(0).toUpperCase()}
                                                    </AvatarFallback>
                                                </Avatar>
                                                <div className="text-start">
                                                    <p className="font-bold text-slate-900 leading-none">{user.name}</p>
                                                    <p className="text-xs text-slate-500 mt-1">{user.email}</p>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-start">
                                            <Badge className={cn(
                                                "font-semibold uppercase text-[10px] tracking-wider",
                                                user.role === 'Admin' ? "bg-purple-100 text-purple-700 border-purple-200" :
                                                user.role === 'Manager' ? "bg-blue-100 text-blue-700 border-blue-200" :
                                                "bg-slate-100 text-slate-700 border-slate-200"
                                            )} variant="outline">
                                                {user.role}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-start">
                                            <span className="text-sm text-slate-600 font-medium">
                                                {user.departmentId ? deptsMap.get(user.departmentId) || user.departmentId : '—'}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-start">
                                            <div className="flex flex-wrap gap-1 max-w-[120px]">
                                                {user.divisionIds && user.divisionIds.length > 0 ? (
                                                    user.divisionIds.map(id => (
                                                        <Badge key={id} variant="secondary" className="bg-slate-50 text-slate-600 border-slate-100 text-[9px] px-1.5 py-0 h-auto font-bold uppercase tracking-tight">
                                                            {divisionsMap.get(id) || id}
                                                        </Badge>
                                                    ))
                                                ) : (
                                                    <span className="text-slate-400 italic text-xs">—</span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-start">
                                            <div className="flex flex-wrap gap-1 max-w-[120px]">
                                                {user.campusIds && user.campusIds.length > 0 ? (
                                                    user.campusIds.map(id => (
                                                        <Badge key={id} variant="outline" className="bg-blue-50/30 text-blue-600 border-blue-100 text-[9px] px-1.5 py-0 h-auto font-bold uppercase tracking-tight">
                                                            {campusesMap.get(id) || id}
                                                        </Badge>
                                                    ))
                                                ) : (
                                                    <span className="text-slate-400 italic text-xs">—</span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-start">
                                            <div className="flex items-center gap-2">
                                                <div className={cn(
                                                    "h-1.5 w-1.5 rounded-full",
                                                    user.authId ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : "bg-slate-300"
                                                )} />
                                                <span className="text-sm font-medium text-slate-600">
                                                    {user.authId ? t('verified') : t('noAccess')}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-end pr-6">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400">
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => handleEdit(user)}>
                                                        <Pencil className="mr-2 h-4 w-4" /> {t('edit')}
                                                    </DropdownMenuItem>
                                                    {!user.authId && (
                                                        <DropdownMenuItem onClick={() => handleCreateLogin(user)}>
                                                            <Key className="mr-2 h-4 w-4" /> {t('createLogin')}
                                                        </DropdownMenuItem>
                                                    )}
                                                    <DropdownMenuItem 
                                                        onClick={() => handleDelete(user)} 
                                                        className="text-destructive focus:text-destructive"
                                                    >
                                                        <Trash2 className="mr-2 h-4 w-4" /> {t('delete')}
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
                {!areUsersLoading && filteredUsers?.length === 0 && (
                    <div className="text-center py-12">
                        <Users2 className="h-12 w-12 text-slate-200 mx-auto mb-3" />
                        <p className="text-slate-500 font-medium">{t('noEmployeesFound')}</p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

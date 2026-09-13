'use client';

import { useEffect, useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
  CardFooter,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2, CheckCheck, XCircle, Circle } from 'lucide-react';
import type { Department, UserProfile, Ticket as TicketType, Campus } from '@/lib/types';
import { setDocumentNonBlocking, useCollection, useDoc, useFirebase, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, query, where } from 'firebase/firestore';
import { updatePassword } from 'firebase/auth';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { StatCard } from '@/components/dashboard/stat-card';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/hooks/use-language';
import { Badge } from '@/components/ui/badge';


const ProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters.'),
  email: z.string().email(),
  role: z.enum(['Admin', 'Employee', 'Manager']),
  departmentId: z.string().optional(),
  password: z.string().min(6, 'Password must be at least 6 characters').optional().or(z.literal('')),
});


export default function ProfilePage() {
    const { user } = useUser();
    const { firestore } = useFirebase();
    const { toast } = useToast();
    const { t } = useLanguage();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const userProfileRef = useMemoFirebase(() =>
        user && firestore ? doc(firestore, 'users', user.uid) : null,
        [user, firestore]
    );
    const { data: userProfile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef);

    const departmentsQuery = useMemoFirebase(() => 
        firestore ? query(collection(firestore, 'departments')) : null,
        [firestore]
    );
    const { data: departments, isLoading: areDepartmentsLoading } = useCollection<Department>(departmentsQuery);

    const campusesQuery = useMemoFirebase(() => 
        firestore ? query(collection(firestore, 'campuses')) : null,
        [firestore]
    );
    const { data: campuses, isLoading: areCampusesLoading } = useCollection<Campus>(campusesQuery);

    const resolvedTicketsQuery = useMemoFirebase(() =>
        user && firestore ? query(collection(firestore, 'tickets'), where('assignedTo.userId', '==', user.uid), where('status', '==', 'Resolved')) : null,
        [user, firestore]
    );
    const { data: resolvedTickets, isLoading: areResolvedTicketsLoading } = useCollection<TicketType>(resolvedTicketsQuery);

    const closedTicketsQuery = useMemoFirebase(() =>
        user && firestore ? query(collection(firestore, 'tickets'), where('assignedTo.userId', '==', user.uid), where('status', '==', 'Closed')) : null,
        [user, firestore]
    );
    const { data: closedTickets, isLoading: areClosedTicketsLoading } = useCollection<TicketType>(closedTicketsQuery);


    const form = useForm<z.infer<typeof ProfileSchema>>({
        resolver: zodResolver(ProfileSchema),
        defaultValues: {
            name: '',
            email: '',
            role: 'Employee',
            departmentId: '',
            password: '',
        }
    });
    
    useEffect(() => {
        if (userProfile) {
            form.reset({
                name: userProfile.name,
                email: userProfile.email,
                role: userProfile.role,
                departmentId: userProfile.departmentId || '',
                password: '',
            });
        } else if (user) {
             form.reset({
                name: user.displayName || '',
                email: user.email || '',
                role: 'Employee',
                departmentId: '',
                password: '',
            });
        }
    }, [userProfile, user, form]);

    const assignedCampusNames = useMemo(() => {
        if (!campuses || !userProfile?.campusIds) return [];
        return userProfile.campusIds
            .map(id => campuses.find(c => c.id === id)?.name)
            .filter((name): name is string => !!name);
    }, [campuses, userProfile?.campusIds]);

    async function onSubmit(values: z.infer<typeof ProfileSchema>) {
        if (!user || !userProfileRef) return;
        setIsSubmitting(true);
        
        try {
            // Update Auth Password if provided
            if (values.password && values.password.length >= 6) {
                await updatePassword(user, values.password);
                toast({
                    title: '✅ ' + t('passwordUpdated'),
                    description: t('passwordUpdated'),
                });
            }

            // Update Firestore Profile
            const updatedProfile: Partial<UserProfile> = {
                name: values.name,
            };

            setDocumentNonBlocking(userProfileRef, updatedProfile, { merge: true });
            toast({
                title: '✅ ' + t('profileUpdated'),
                description: t('profileUpdatedSub'),
            });
            form.setValue('password', ''); // Clear password field
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: error.message || 'Failed to update password. You may need to log out and log in again for security reasons.',
            });
        } finally {
            setIsSubmitting(false);
        }
    }

    const isLoading = isProfileLoading || areDepartmentsLoading || areResolvedTicketsLoading || areClosedTicketsLoading || areCampusesLoading;

    if (isLoading) {
        return (
            <div className="max-w-2xl mx-auto space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                    <Skeleton className="h-28" />
                    <Skeleton className="h-28" />
                </div>
                <Skeleton className="h-[500px] w-full" />
            </div>
        )
    }
    
    const avatarUrl = userProfile?.avatarUrl || null;
    const isAvailable = userProfile?.status === 'Available';

    return (
         <div className="max-w-2xl mx-auto space-y-6">
             <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
                <StatCard title={resolvedTickets?.length === 1 ? t('resolved') : t('resolved')} value={resolvedTickets?.length || 0} icon={<CheckCheck />} />
                <StatCard title={t('closed')} value={closedTickets?.length || 0} icon={<XCircle />} />
            </div>
            <Card>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)}>
                        <CardHeader>
                            <div className="flex items-center gap-4 text-start">
                                <div className="relative">
                                    <Avatar className="h-16 w-16 border">
                                        <AvatarImage src={avatarUrl || ''} />
                                        <AvatarFallback>{userProfile?.name?.charAt(0) || 'U'}</AvatarFallback>
                                    </Avatar>
                                    <div className={cn(
                                        "absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-background shadow-sm",
                                        isAvailable ? "bg-green-500" : "bg-red-500"
                                    )} />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <CardTitle className="text-3xl">{userProfile?.name}</CardTitle>
                                        <div className={cn(
                                            "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                                            isAvailable ? "bg-green-100 text-green-700 border-green-200" : "bg-red-100 text-red-700 border-red-200"
                                        )}>
                                            <Circle className={cn("h-2 w-2 fill-current", isAvailable ? "text-green-500" : "text-red-500")} />
                                            {isAvailable ? t('available') : t('busy')}
                                        </div>
                                    </div>
                                    <CardDescription>View and edit your profile details below.</CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4 pt-4 text-start">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                    <FormLabel>Full Name</FormLabel>
                                    <FormControl>
                                        <Input placeholder="e.g., Jane Doe" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="email"
                                render={({ field }) => (
                                    <FormItem>
                                    <FormLabel>Email</FormLabel>
                                    <FormControl>
                                        <Input type="email" placeholder="e.g., jane.doe@example.com" {...field} disabled className="bg-slate-50" />
                                    </FormControl>
                                    <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="password"
                                render={({ field }) => (
                                    <FormItem>
                                    <FormLabel>{t('newPassword')}</FormLabel>
                                    <FormControl>
                                        <Input type="password" placeholder={t('passwordPlaceholder')} {...field} />
                                    </FormControl>
                                    <FormMessage />
                                    </FormItem>
                                )}
                            />
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                                <FormField
                                    control={form.control}
                                    name="role"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Role</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value} disabled>
                                                <FormControl>
                                                <SelectTrigger className="bg-slate-50 border-slate-200">
                                                    <SelectValue placeholder="Select a role" />
                                                </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    <SelectItem value="Admin">Admin</SelectItem>
                                                    <SelectItem value="Employee">Employee</SelectItem>
                                                    <SelectItem value="Manager">Manager</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="departmentId"
                                    render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Category</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value} disabled>
                                            <FormControl>
                                            <SelectTrigger className="bg-slate-50 border-slate-200">
                                                <SelectValue placeholder="Select a Category" />
                                            </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                            {departments?.map((dept) => (
                                                <SelectItem key={dept.id} value={dept.id}>
                                                {dept.name}
                                                </SelectItem>
                                            ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                    )}
                                />
                            </div>

                            {/* CAMPUSES DISPLAY (READ-ONLY) */}
                            <div className="space-y-2 pt-2">
                                <FormLabel className="text-slate-700 font-semibold">{t('assignedCampuses')}</FormLabel>
                                <div className="flex flex-wrap gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg min-h-[44px]">
                                    {assignedCampusNames.length > 0 ? (
                                        assignedCampusNames.map((name, i) => (
                                            <Badge key={i} variant="secondary" className="bg-white border-slate-200 text-slate-700 font-bold uppercase text-[10px]">
                                                {name}
                                            </Badge>
                                        ))
                                    ) : (
                                        <span className="text-slate-400 italic text-xs">{t('na')}</span>
                                    )}
                                </div>
                                <p className="text-[10px] text-slate-400 italic">
                                    {t('campusContactAdminNote')}
                                </p>
                            </div>

                            <p className="text-[10px] text-slate-400 italic pt-4">
                                * Role, Category, and Campuses can only be changed by a system administrator.
                            </p>
                        </CardContent>
                        <CardFooter className="justify-start">
                            <Button type="submit" disabled={isSubmitting} className="bg-[#1e3a8a] text-white font-bold px-8">
                                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Save Changes
                            </Button>
                        </CardFooter>
                    </form>
                </Form>
            </Card>
        </div>
    )
}

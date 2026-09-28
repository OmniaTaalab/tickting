
'use client';

import { useMemo, useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { useCollection, useFirebase, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, query, where, doc, orderBy } from 'firebase/firestore';
import type { TicketEvent, UserProfile, Department } from '@/lib/types';
import { formatDistanceToNow, isToday, subDays } from 'date-fns';
import { arSA } from 'date-fns/locale';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowRightLeft, Clock, CheckCircle2, UserPlus, ShieldAlert, Check, X, Loader2, ArrowRight, Search, Filter, RotateCcw, Building2, Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { approveRequestAction, rejectRequestAction } from '@/actions/request_actions';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/hooks/use-language';

const getRequestIcon = (type: string) => {
    if (type === 'TICKET_REASSIGN_REQUESTED') return <UserPlus className="h-6 w-6" />;
    return <ArrowRightLeft className="h-6 w-6" />;
};

function ApproveReassignDialog({
    isOpen,
    onClose,
    request,
    actorName
}: {
    isOpen: boolean;
    onClose: () => void;
    request: TicketEvent | null;
    actorName: string;
}) {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const { t } = useLanguage();
    const [selectedUserId, setSelectedUserId] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const departmentId = request?.requestMetadata?.fromDepartmentId;

    const usersQuery = useMemoFirebase(() => 
        firestore && departmentId ? query(
            collection(firestore, 'users'), 
            where('departmentId', '==', departmentId),
            where('role', '==', 'Employee')
        ) : null,
        [firestore, departmentId]
    );
    const { data: categoryStaff, isLoading: isUsersLoading } = useCollection<UserProfile>(usersQuery);

    const availableStaff = useMemo(() => {
        if (!categoryStaff) return [];
        return categoryStaff.filter(u => u.status === 'Available' || !u.status);
    }, [categoryStaff]);

    const handleConfirm = async () => {
        if (!request || !user || !selectedUserId) return;
        setSelectedUserId(''); // reset
        setIsSubmitting(true);
        try {
            const result = await approveRequestAction(request.id, { userId: user.uid, name: actorName }, selectedUserId);
            if (result.success) {
                toast({ title: t('approved'), description: result.message });
                onClose();
            } else {
                toast({ variant: "destructive", title: "Error", description: result.message });
            }
        } catch (err) {
            toast({ variant: "destructive", title: "Error", description: "Failed to process approval." });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('selectNewAssignee')}</DialogTitle>
                    <DialogDescription>
                        {t('chooseAvailableEmployee')}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                    <div className="space-y-2">
                        <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('availableStaff')}</Label>
                        <Select onValueChange={setSelectedUserId} value={selectedUserId}>
                            <SelectTrigger className="h-11">
                                <SelectValue placeholder={isUsersLoading ? t('loadingStaff') : t('selectEmployee')} />
                            </SelectTrigger>
                            <SelectContent>
                                {availableStaff.length > 0 ? (
                                    availableStaff.map((staff) => (
                                        <SelectItem key={staff.id} value={staff.id}>
                                            <div className="flex items-center gap-2">
                                                <div className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]" />
                                                <span className="font-medium">{staff.name}</span>
                                            </div>
                                        </SelectItem>
                                    ))
                                ) : (
                                    <SelectItem value="none" disabled>{t('noAvailableStaffFound')}</SelectItem>
                                )}
                            </SelectContent>
                        </Select>
                    </div>
                    <DialogFooter className="pt-4">
                        <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>{t('cancel')}</Button>
                        <Button 
                            onClick={handleConfirm} 
                            disabled={isSubmitting || !selectedUserId} 
                            className="bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white font-bold px-6"
                        >
                            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : t('confirmApproval')}
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export default function RequestsPage() {
    const { firestore } = useFirebase();
    const { user } = useUser();
    const { toast } = useToast();
    const { t, language } = useLanguage();
    const router = useRouter();
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [reassignRequest, setReassignRequest] = useState<TicketEvent | null>(null);

    // Filter states
    const [searchQuery, setSearchQuery] = useState('');
    const [typeFilter, setTypeFilter] = useState<'all' | 'transfer' | 'reassign'>('all');
    const [departmentFilter, setDepartmentFilter] = useState<string>('all');
    const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7days' | '30days'>('all');

    const deptsQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'departments'), orderBy('name', 'asc')) : null, [firestore]);
    const { data: departments } = useCollection<Department>(deptsQuery);

    const userProfileRef = useMemoFirebase(() => 
        user && firestore ? doc(firestore, 'users', user.uid) : null,
        [user, firestore]
    );
    const { data: userProfile } = useDoc<UserProfile>(userProfileRef);

    const requestsQuery = useMemoFirebase(() => {
        if (!firestore || !user) return null;
        return query(
            collection(firestore, 'ticket-events'),
            where('recipient', '==', user.uid),
            where('eventType', 'in', ['TICKET_TRANSFER_REQUESTED', 'TICKET_REASSIGN_REQUESTED'])
        );
    }, [firestore, user]);

    const { data: requests, isLoading } = useCollection<TicketEvent>(requestsQuery);

    const isWithinDateFilter = (timestamp: any, filter: string) => {
        if (filter === 'all' || !timestamp) return true;
        const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        if (isNaN(d.getTime())) return true;
        if (filter === 'today') return isToday(d);
        if (filter === '7days') return d >= subDays(new Date(), 7);
        if (filter === '30days') return d >= subDays(new Date(), 30);
        return true;
    };

    const { activeRequests, processedRequests } = useMemo(() => {
        if (!requests) return { activeRequests: [], processedRequests: [] };
        
        const sorted = [...requests].sort((a, b) => {
            const timeA = a.timestamp?.toDate()?.getTime() || 0;
            const timeB = b.timestamp?.toDate()?.getTime() || 0;
            return timeB - timeA;
        });

        const seenRequests = new Set();
        const deduplicatedActive: TicketEvent[] = [];

        sorted.forEach(req => {
            const isPending = req.status === 'pending' || !req.status;
            if (isPending) {
                const uniqueKey = req.requestId || `${req.ticketId}_${req.eventType}`;
                if (!seenRequests.has(uniqueKey)) {
                    seenRequests.add(uniqueKey);
                    deduplicatedActive.push(req);
                }
            }
        });

        const filterItem = (req: TicketEvent) => {
            // Type filter
            if (typeFilter === 'transfer' && req.eventType !== 'TICKET_TRANSFER_REQUESTED') return false;
            if (typeFilter === 'reassign' && req.eventType !== 'TICKET_REASSIGN_REQUESTED') return false;

            // Department filter
            if (departmentFilter !== 'all') {
                const fromDept = req.requestMetadata?.fromDepartmentId || req.requestMetadata?.fromDepartmentName;
                const toDept = req.requestMetadata?.toDepartmentId || req.requestMetadata?.toDepartmentName;
                if (fromDept !== departmentFilter && toDept !== departmentFilter) {
                    return false;
                }
            }

            // Date filter
            if (!isWithinDateFilter(req.timestamp, dateFilter)) {
                return false;
            }

            // Search query
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase().trim();
                const ticketId = (req.ticketId || '').toLowerCase();
                const msg = (req.message || '').toLowerCase();
                const reqName = (req.requestMetadata?.requesterName || '').toLowerCase();
                const fromDeptName = (req.requestMetadata?.fromDepartmentName || '').toLowerCase();
                const toDeptName = (req.requestMetadata?.toDepartmentName || '').toLowerCase();

                if (!ticketId.includes(q) && !msg.includes(q) && !reqName.includes(q) && !fromDeptName.includes(q) && !toDeptName.includes(q)) {
                    return false;
                }
            }

            return true;
        };

        return {
            activeRequests: deduplicatedActive.filter(filterItem),
            processedRequests: sorted.filter(r => (r.status === 'approved' || r.status === 'rejected') && filterItem(r))
        };
    }, [requests, typeFilter, departmentFilter, dateFilter, searchQuery]);

    const handleResetFilters = () => {
        setSearchQuery('');
        setTypeFilter('all');
        setDepartmentFilter('all');
        setDateFilter('all');
    };

    const hasActiveFilters = searchQuery.trim() !== '' || typeFilter !== 'all' || departmentFilter !== 'all' || dateFilter !== 'all';

    const getTranslatedDescription = (req: TicketEvent) => {
        const metadata = req.requestMetadata;
        if (!metadata) return req.message;
        
        const requester = metadata.requesterName || 'Staff';
        const ticketNum = req.ticketId.substring(0, 4);

        if (req.eventType === 'TICKET_TRANSFER_REQUESTED') {
            return t('transferReqMsg', { 
                name: requester, 
                id: ticketNum, 
                dept: metadata.toDepartmentName || t('Other') 
            });
        }
        if (req.eventType === 'TICKET_REASSIGN_REQUESTED') {
            return t('reassignReqMsg', { 
                name: requester, 
                id: ticketNum 
            });
        }
        return req.message;
    };

    const handleApprove = async (e: React.MouseEvent, request: TicketEvent) => {
        e.stopPropagation();
        if (!user) return;

        if (request.eventType === 'TICKET_REASSIGN_REQUESTED') {
            setReassignRequest(request);
            return;
        }

        setProcessingId(request.id);
        try {
            const result = await approveRequestAction(request.id, { userId: user.uid, name: userProfile?.name || 'Admin' });
            if (result.success) {
                toast({ title: t('approved'), description: result.message });
            } else {
                toast({ variant: "destructive", title: "Error", description: result.message });
            }
        } catch (err: any) {
            toast({ variant: "destructive", title: "System Error", description: "Could not process request." });
        } finally {
            setProcessingId(null);
        }
    };

    const handleReject = async (e: React.MouseEvent, request: TicketEvent) => {
        e.stopPropagation();
        if (!user) return;
        setProcessingId(request.id);
        try {
            const result = await rejectRequestAction(request.id, { userId: user.uid, name: userProfile?.name || 'Admin' });
            if (result.success) {
                toast({ title: t('rejected'), description: result.message });
            } else {
                toast({ variant: "destructive", title: "Error", description: result.message });
            }
        } catch (err: any) {
            toast({ variant: "destructive", title: "System Error", description: "Could not process request." });
        } finally {
            setProcessingId(null);
        }
    };

    if (isLoading) {
        return (
            <div className="max-w-5xl mx-auto space-y-6">
                <Skeleton className="h-10 w-48" />
                <div className="space-y-4">
                    {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}
                </div>
            </div>
        );
    }

    if (userProfile?.role !== 'Admin' && userProfile?.role !== 'Manager') {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-center">
                <ShieldAlert className="h-16 w-16 text-destructive mb-4 opacity-20" />
                <h2 className="text-2xl font-bold text-slate-900">Access Restricted</h2>
                <p className="text-slate-500 max-w-md mx-auto mt-2">
                    Only system administrators and managers can manage ticket action requests.
                </p>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto space-y-10 pb-20">
            <ApproveReassignDialog 
                isOpen={!!reassignRequest} 
                onClose={() => setReassignRequest(null)} 
                request={reassignRequest}
                actorName={userProfile?.name || 'Admin'}
            />

            <div className="space-y-1">
                <h1 className="text-3xl font-black tracking-tight text-slate-900 font-headline">{t('actionRequests')}</h1>
                <p className="text-slate-500 font-medium">{t('requestsSub')}</p>
            </div>

            {/* Filter Toolbar */}
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                            placeholder={t('searchRequestsPlaceholder')}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 bg-slate-50 border-slate-200 text-sm h-10 rounded-xl focus:bg-white transition-colors"
                        />
                        {searchQuery && (
                            <button 
                                onClick={() => setSearchQuery('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>

                    {/* Request Type */}
                    <div>
                        <Select value={typeFilter} onValueChange={(val: any) => setTypeFilter(val)}>
                            <SelectTrigger className="h-10 bg-slate-50 border-slate-200 rounded-xl text-xs font-semibold">
                                <SelectValue placeholder={t('allRequestTypes')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('allRequestTypes')}</SelectItem>
                                <SelectItem value="transfer">{t('transferRequestsOnly')}</SelectItem>
                                <SelectItem value="reassign">{t('reassignRequestsOnly')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Department */}
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

                    {/* Date Filter */}
                    <div>
                        <Select value={dateFilter} onValueChange={(val: any) => setDateFilter(val)}>
                            <SelectTrigger className="h-10 bg-slate-50 border-slate-200 rounded-xl text-xs font-semibold">
                                <SelectValue placeholder={t('allTime')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('allTime')}</SelectItem>
                                <SelectItem value="today">{t('filterToday')}</SelectItem>
                                <SelectItem value="7days">{t('filterLast7Days')}</SelectItem>
                                <SelectItem value="30days">{t('filterLast30Days')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Reset & Status Summary */}
                {hasActiveFilters && (
                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                        <span className="text-slate-500 font-medium">
                            {activeRequests.length + processedRequests.length} {t('requestsSub')}
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

            <div className="space-y-4">
                <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    {t('activeRequestsLabel')} <Badge variant="secondary" className="bg-blue-100 text-blue-700">{activeRequests.length}</Badge>
                </h2>
                <div className="grid gap-4">
                    {activeRequests.length > 0 ? (
                        activeRequests.map((req) => (
                            <Card 
                                key={req.id} 
                                className="group border-none shadow-sm transition-all hover:shadow-md cursor-pointer overflow-hidden bg-white border-l-4 border-l-blue-600"
                                onClick={() => router.push(`/tickets/${req.ticketId}`)}
                            >
                                <CardContent className="p-6">
                                    <div className="flex flex-col md:flex-row md:items-center gap-6">
                                        <div className="p-3 rounded-2xl bg-blue-50 text-blue-600 shrink-0 self-start md:self-center">
                                            {getRequestIcon(req.eventType)}
                                        </div>
                                        
                                        <div className="flex-1 min-w-0 space-y-3">
                                            <div className="flex items-center justify-between gap-4">
                                                <div className="flex items-center gap-2">
                                                    <h3 className="text-lg font-bold text-slate-900 leading-tight">
                                                        {req.eventType === 'TICKET_REASSIGN_REQUESTED' ? t('reassignRequestedTitle') : t('transferRequestedTitle')}
                                                    </h3>
                                                    <Badge variant="outline" className="text-[9px] font-black uppercase tracking-widest h-5">
                                                        {req.eventType === 'TICKET_REASSIGN_REQUESTED' ? t('reassignment') : t('transfer')}
                                                    </Badge>
                                                </div>
                                                <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                                    <Clock className="h-3 w-3" />
                                                    {req.timestamp ? formatDistanceToNow(req.timestamp.toDate(), { addSuffix: true, locale: language === 'ar' ? arSA : undefined }) : t('justNow')}
                                                </div>
                                            </div>
                                            
                                            <p className="text-sm text-slate-500 font-medium leading-relaxed text-start">
                                                {getTranslatedDescription(req)}
                                            </p>

                                            {req.requestMetadata && (
                                                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100 max-w-fit">
                                                    <div className="text-center">
                                                        <p className="text-[9px] font-bold text-slate-400 uppercase">{t('from')}</p>
                                                        <p className="text-xs font-black text-slate-700">{req.requestMetadata.fromDepartmentName}</p>
                                                    </div>
                                                    <ArrowRight className="h-3 w-3 text-slate-300" />
                                                    <div className="text-center">
                                                        <p className="text-[9px] font-bold text-slate-400 uppercase">{t('to')}</p>
                                                        <p className="text-xs font-black text-blue-600">
                                                            {req.eventType === 'TICKET_TRANSFER_REQUESTED' 
                                                                ? req.requestMetadata.toDepartmentName 
                                                                : t('reassignment')
                                                            }
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            <Button 
                                                size="sm" 
                                                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-9 px-4 gap-2 shadow-sm"
                                                onClick={(e) => handleApprove(e, req)}
                                                disabled={processingId === req.id}
                                            >
                                                {processingId === req.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                                {t('approveBtn')}
                                            </Button>
                                            <Button 
                                                size="sm" 
                                                variant="outline" 
                                                className="border-red-100 text-red-600 hover:bg-red-50 font-bold h-9 px-4 gap-2"
                                                onClick={(e) => handleReject(e, req)}
                                                disabled={processingId === req.id}
                                            >
                                                <X className="h-4 w-4" />
                                                {t('rejectBtn')}
                                            </Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))
                    ) : (
                        <div className="py-12 text-center bg-slate-50/50 rounded-3xl border-2 border-dashed border-slate-200">
                            <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto mb-3" />
                            <h3 className="text-lg font-bold text-slate-800">{t('noActiveRequests')}</h3>
                            <p className="text-slate-500 text-sm">{t('everythingProcessed')}</p>
                        </div>
                    )}
                </div>
            </div>

            {processedRequests.length > 0 && (
                <div className="space-y-4">
                    <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">{t('recentlyProcessed')}</h2>
                    <div className="grid gap-3">
                        {processedRequests.slice(0, 5).map((req) => (
                            <div 
                                key={req.id} 
                                className="flex items-center justify-between p-4 bg-white border border-slate-100 rounded-xl grayscale-[0.5] opacity-70"
                            >
                                <div className="flex items-center gap-4">
                                    <div className={cn("p-2 rounded-lg", req.status === 'approved' ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600")}>
                                        {req.status === 'approved' ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                                    </div>
                                    <div className="text-start">
                                        <p className="text-sm font-bold text-slate-900">{req.eventType === 'TICKET_REASSIGN_REQUESTED' ? t('reassignRequestedTitle') : t('transferRequestedTitle')}</p>
                                        <p className="text-[10px] text-slate-500 font-medium">{t('processedBy')} {req.processedBy || 'Admin'}</p>
                                    </div>
                                </div>
                                <Badge className={cn("text-[9px] font-black uppercase", req.status === 'approved' ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
                                    {req.status === 'approved' ? t('approved') : t('rejected')}
                                </Badge>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

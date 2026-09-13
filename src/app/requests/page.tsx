
'use client';

import { useMemo, useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { useCollection, useFirebase, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, query, where, doc } from 'firebase/firestore';
import type { TicketEvent, UserProfile } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';
import { arSA } from 'date-fns/locale';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowRightLeft, Clock, CheckCircle2, UserPlus, ShieldAlert, Check, X, Loader2, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

        return {
            activeRequests: deduplicatedActive,
            processedRequests: sorted.filter(r => r.status === 'approved' || r.status === 'rejected')
        };
    }, [requests]);

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

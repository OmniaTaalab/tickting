'use client';
import { useParams, useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { TicketStatusBadge } from '@/components/tickets/ticket-status-badge';
import { formatDistanceToNow } from 'date-fns';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
    Check, 
    X, 
    Clock, 
    RefreshCcw, 
    UserPlus, 
    Loader2,
    AlertCircle,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Send,
    Paperclip,
    History,
    Lock,
    Plus,
    Download,
    FileText,
    ImageIcon,
    UserCircle2,
    Trash2,
    Copy,
    Inbox,
    LayoutList,
    ShieldCheck
} from 'lucide-react';
import type { TicketMessage, Ticket, TicketStatus, UserProfile, Department, SLASettings } from '@/lib/types';
import { DEFAULT_SLA_SETTINGS } from '@/lib/types';
import { useDoc, useFirebase, useMemoFirebase, useUser as useAuthUser, setDocumentNonBlocking, useCollection } from '@/firebase';
import { doc, serverTimestamp, collection, query, where, orderBy, deleteField, Timestamp } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Label } from '@/components/ui/label';
import { useActionState, useEffect, useState, useMemo, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { addTicketReplyAction } from '@/actions/ticket_reply';
import { transferTicketToCategoryAction } from '@/actions/ticket_transfer';
import { requestTicketTransferAction } from '@/actions/ticket_request_transfer';
import { requestTicketReassignmentAction } from '@/actions/ticket_request_reassign';
import { reassignTicketAction } from '@/actions/ticket_reassign';
import { deleteTicketMessageAction } from '@/actions/ticket_message_delete';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import Image from 'next/image';
import { useLanguage } from '@/hooks/use-language';
import { calculateWorkingHoursElapsed } from '@/lib/working-hours-utils';

const toDate = (ts: any): Date | null => {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
  if (ts instanceof Date) return isNaN(ts.getTime()) ? null : ts;
  try {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
};

const getInitials = (name: string) => {
    return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .substring(0, 2);
};

const getAvatarTheme = (name: string) => {
    const avatarBgColors = ['bg-slate-50', 'bg-blue-50', 'bg-indigo-50', 'bg-rose-50', 'bg-emerald-50'];
    const avatarTextColors = ['text-slate-400', 'text-blue-400', 'text-indigo-400', 'text-rose-400', 'text-emerald-400'];
    const total = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const index = total % avatarBgColors.length;
    return { bg: avatarBgColors[index], text: avatarTextColors[index] };
};

function AttachmentPreview({ attachment }: { attachment: string | { url: string; name?: string } }) {
    const { t } = useLanguage();
    const url = typeof attachment === "string" ? attachment : attachment.url;
    const name = typeof attachment === "string" ? "Attachment" : attachment.name || "Attachment";
    const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i.test(url);
    return (
      <div className="bg-white border border-slate-100 rounded-xl p-4 flex flex-col gap-3 shadow-sm hover:shadow-md transition-all text-start">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="p-2 bg-slate-50 rounded-lg shrink-0">{isImage ? <ImageIcon className="h-4 w-4 text-blue-600" /> : <FileText className="h-4 w-4 text-rose-600" />}</div>
            <span className="text-xs font-bold text-slate-700 truncate">{name}</span>
          </div>
          <Button asChild variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-[#1e3a8a]"><a href={url} target="_blank" rel="noopener noreferrer"><Download className="h-4 w-4" /></a></Button>
        </div>
        {isImage && <div className="relative aspect-video rounded-lg overflow-hidden border bg-slate-50 group"><Image src={url} alt={name} fill className="object-cover" unoptimized /><a href={url} target="_blank" rel="noopener noreferrer" className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-bold uppercase tracking-widest">{t('viewFullSize')}</a></div>}
      </div>
    );
}

function Message({ 
    message, 
    ticketChannel, 
    ticketCreatorId, 
    ticketId, 
    canDelete,
    parentName,
    isOpeningMessage,
    extraAttachments = []
}: { 
    message: TicketMessage; 
    ticketChannel: string; 
    ticketCreatorId: string; 
    ticketId: string; 
    canDelete: boolean;
    parentName?: string;
    isOpeningMessage?: boolean;
    extraAttachments?: any[];
}) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const isInternal = message.isInternal;
  const isStaffReply = message.author.userId !== ticketCreatorId && !isInternal;
  
  const displayName = (isOpeningMessage && parentName) ? parentName : message.author.name;
  const initials = getInitials(displayName);
  const theme = getAvatarTheme(displayName);
  const msgDate = toDate(message.createdAt);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(t('confirmDeleteMessage'))) return;
    setIsDeleting(true);
    const result = await deleteTicketMessageAction(ticketId, message.id);
    if (!result.success) {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsDeleting(false);
  };

  const allAttachments = useMemo(() => {
    const list = [...(message.attachments || [])];
    if (isOpeningMessage) {
        // Only include extra root attachments if they aren't already represented by URL in message attachments
        extraAttachments.forEach(extra => {
            const extraUrl = typeof extra === 'string' ? extra : extra.url;
            if (!list.includes(extraUrl)) {
                list.push(extra);
            }
        });
    }
    return list;
  }, [message.attachments, extraAttachments, isOpeningMessage]);

  const displayChannel = ticketChannel || 'Email';

  return (
    <div className={cn(
        "flex gap-4 p-5 rounded-2xl border transition-all relative group/msg",
        isInternal ? "bg-amber-50/40 border-amber-100 shadow-sm" : isStaffReply ? "bg-[#E5E7EB] border-slate-200 shadow-sm hover:shadow-md" : "bg-white border-slate-100 shadow-sm hover:shadow-md"
    )}>
      <Avatar className={cn('h-11 w-11 border border-slate-100 shrink-0', theme.bg)}>
          <AvatarFallback className={cn("text-[10px] font-black tracking-tighter uppercase", theme.text)}>{initials}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-[#334155] text-[15px]">{displayName}</span>
            {isInternal ? (
               <span className="px-2 py-0.5 rounded bg-amber-100/50 text-amber-700 text-[9px] font-black uppercase tracking-tight border border-amber-200">{t('internalNote')}</span>
            ) : (
              <span className="px-2 py-0.5 rounded bg-[#f1f5f9] text-[#64748b] text-[9px] font-black border border-slate-200 flex items-center gap-1 uppercase tracking-tight">
                {t(displayChannel) || displayChannel}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-[#94a3b8] font-medium whitespace-nowrap">
                {msgDate ? formatDistanceToNow(msgDate, { addSuffix: true }) : '...'}
            </span>
            {canDelete && (
                <Button 
                    variant="ghost" 
                    size="icon" 
                    disabled={isDeleting}
                    onClick={handleDelete}
                    className="h-7 w-7 text-slate-300 hover:text-red-500 opacity-0 group-hover/msg:opacity-100 transition-opacity"
                >
                    {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
            )}
          </div>
        </div>
        <div className="text-[14px] text-[#475569] font-body leading-relaxed whitespace-pre-wrap mt-1 font-medium text-start break-words">{message.text}</div>
        
        {allAttachments.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                {allAttachments.map((url, i) => (
                    <AttachmentPreview key={i} attachment={url} />
                ))}
            </div>
        )}
      </div>
    </div>
  );
}

const ReplySchema = z.object({ replyText: z.string().min(1, 'Reply cannot be empty.') });

function ReplyArea({ ticket }: { ticket: Ticket }) {
  const { user: currentUser } = useAuthUser();
  const { toast } = useToast();
  const { t, isRTL } = useLanguage();
  const [activeTab, setActiveTab] = useState('reply');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastProcessedRef = useRef<any>(null);

  const [state, dispatch, isPending] = useActionState(addTicketReplyAction, {
    success: false,
    message: null,
    errors: {},
  });

  const form = useForm<z.infer<typeof ReplySchema>>({
    resolver: zodResolver(ReplySchema),
    defaultValues: { replyText: '' },
  });

  useEffect(() => {
    if (state !== lastProcessedRef.current) {
        if (state.success) {
          toast({ title: '✅ Success', description: state.message });
          form.reset();
          setSelectedFiles([]);
        } else if (state.message || state.errors?.form) {
          toast({ variant: 'destructive', title: 'Error', description: state.message || state.errors?.form?.join(', ') });
        }
        lastProcessedRef.current = state;
    }
  }, [state, form, toast]);

  const handleSubmit = async (formData: FormData) => {
    selectedFiles.forEach(file => formData.append('attachments', file));
    dispatch(formData);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setSelectedFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeFile = (idx: number) => setSelectedFiles(prev => prev.filter((_, i) => i !== idx));

  const replierId = currentUser ? currentUser.uid : (ticket.createdBy?.userId || 'Guest');
  const isFinished = ticket.status === 'Resolved' || ticket.status === 'Closed' || ticket.status === 'Duplicate';
  const isCreator = replierId === ticket.createdBy.userId;
  const isInternal = activeTab === 'note';

  if (isFinished && !isCreator && !isInternal) {
      return (
          <div className="bg-slate-50 border border-dashed rounded-xl p-8 text-center flex flex-col items-center gap-3">
              <Lock className="h-8 w-8 text-slate-300" />
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-600">{t('conversationLocked')}</p>
                <p className="text-xs text-slate-400 max-w-sm">{t('lockedSub', { status: ticket.status })}</p>
              </div>
          </div>
      );
  }

  return (
    <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
        <div className={cn("bg-slate-50/50 border-b px-4 flex items-center h-12", isRTL ? "flex-row-reverse" : "flex-row")}>
            <div className={cn("flex gap-4", isRTL ? "order-1" : "order-1")}>
                <button 
                    onClick={() => setActiveTab('reply')}
                    className={cn("px-4 font-bold text-xs h-8 rounded-md transition-all", activeTab === 'reply' ? "bg-[#1e3a8a] text-white shadow-sm" : "text-slate-500 hover:bg-slate-100")}
                >
                    {isFinished && isCreator ? t('startFollowUp') : t('reply')}
                </button>
                {currentUser && (
                    <button 
                        onClick={() => setActiveTab('note')}
                        className={cn("px-4 font-bold text-xs h-8 rounded-md transition-all", activeTab === 'note' ? "bg-slate-200 text-slate-700" : "text-slate-500 hover:bg-slate-100")}
                    >
                        {t('internalNote')}
                    </button>
                )}
            </div>
            <div className={cn("text-[10px] text-slate-400 font-bold uppercase tracking-widest flex items-center gap-1", isRTL ? "me-auto" : "ms-auto")}>
                {isInternal ? t('internalTeamOnly') : t('replyVia', { channel: t(ticket.channel) || ticket.channel })}
            </div>
        </div>
        <CardContent className="p-0">
            <Form {...form}>
                <form action={handleSubmit}>
                    <input type="hidden" name="ticketId" value={ticket.id || ''} />
                    <input type="hidden" name="userId" value={replierId || ''} />
                    <input type="hidden" name="isInternal" value={isInternal ? 'true' : 'false'} />
                    <input type="file" multiple ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                    
                    <FormField
                        control={form.control}
                        name="replyText"
                        render={({ field }) => (
                            <FormItem>
                                <FormControl>
                                    <Textarea 
                                        placeholder={t('writeResponse')} 
                                        className="min-h-[140px] border-none focus-visible:ring-0 text-sm p-5 placeholder:text-slate-300 resize-none bg-white text-start font-body" 
                                        {...field} 
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    {selectedFiles.length > 0 && (
                        <div className="px-5 pb-4 flex flex-wrap gap-2">
                            {selectedFiles.map((f, i) => (
                                <div key={i} className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100 text-[11px] font-bold text-slate-600 animate-in fade-in zoom-in-95">
                                    <FileText className="h-3.5 w-3.5 text-blue-600" />
                                    <span className="truncate max-w-[120px]">{f.name}</span>
                                    <button type="button" onClick={() => removeFile(i)} className="text-slate-400 hover:text-red-500"><X className="h-3 w-3" /></button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className={cn("p-4 border-t bg-slate-50/30 flex items-center justify-between", isRTL && "flex-row-reverse")}>
                        <div className="flex items-center gap-2">
                            <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2 rounded-full hover:bg-slate-100 text-slate-400 transition-colors">
                                <Paperclip className="h-4 w-4" />
                            </button>
                        </div>
                        <Button type="submit" disabled={isPending} className={cn("font-bold px-8 shadow-md rounded-lg h-10 gap-2", isInternal ? "bg-amber-600 hover:bg-amber-700 text-white" : "bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white")}>
                            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : (isInternal ? <Lock className="h-4 w-4" /> : <Send className={cn("h-4 w-4", isRTL && "rotate-180")} />)}
                            {isInternal ? t('saveInternalNote') : t('reply')}
                        </Button>
                    </div>
                </form>
            </Form>
        </CardContent>
    </div>
  );
}

function DetailRow({ label, value, action }: { label: string; value: React.ReactNode; action?: React.ReactNode }) {
    return (
        <div className="flex justify-between items-center py-3 border-b border-slate-50 last:border-0">
            <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-start">{label}</span>
                {action}
            </div>
            <div className="text-sm font-semibold text-slate-700 text-end">{value}</div>
        </div>
    );
}

function TransferCategoryDialog({ isOpen, onClose, ticketId, currentCategory, userRole }: { isOpen: boolean; onClose: () => void; ticketId: string; currentCategory?: string; userRole?: string; }) {
    const { firestore } = useFirebase();
    const { user: actor } = useAuthUser();
    const { toast } = useToast();
    const { t } = useLanguage();
    const lastProcessedRef = useRef<any>(null);
    const isEmployee = userRole === 'Employee';
    const actionToUse = isEmployee ? requestTicketTransferAction : transferTicketToCategoryAction;
    const [state, dispatch, isPending] = useActionState(actionToUse as any, { success: false });
    const categoriesQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'departments')) : null, [firestore]);
    const { data: categories } = useCollection<Department>(categoriesQuery);
    
    useEffect(() => {
        if (state !== lastProcessedRef.current) {
            if (state.success) { toast({ title: t('approved'), description: state.message }); onClose(); }
            else if (state.message) { toast({ variant: "destructive", title: "Error", description: state.message }); }
            lastProcessedRef.current = state;
        }
    }, [state, toast, onClose, t]);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle>{isEmployee ? t('requestTransfer') : t('transferCategory')}</DialogTitle></DialogHeader>
                <form action={dispatch} className="space-y-4 pt-4">
                    <input type="hidden" name="ticketId" value={ticketId || ''} />
                    {actor && <><input type="hidden" name="actorId" value={actor.uid || ''} /><input type="hidden" name="actorName" value={actor.displayName || 'User'} /></>}
                    <div className="space-y-2 text-start">
                        <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('category')}</Label>
                        <Select name="newCategoryId" required>
                            <SelectTrigger><SelectValue placeholder={t('allCategories')} /></SelectTrigger>
                            <SelectContent>{categories?.filter(c => c.id !== currentCategory).map((cat) => (<SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>))}</SelectContent>
                        </Select>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={onClose}>{t('cancel')}</Button>
                        <Button type="submit" disabled={isPending} className="bg-[#1e3a8a] text-white font-bold">
                            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {isEmployee ? t('approveBtn') : t('confirmApproval')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function AssignPersonDialog({ isOpen, onClose, ticketId, categoryId }: { isOpen: boolean; onClose: () => void; ticketId: string; categoryId: string; }) {
    const { firestore } = useFirebase();
    const { user: actor } = useAuthUser();
    const { toast } = useToast();
    const { t } = useLanguage();
    const lastProcessedRef = useRef<any>(null);
    const [state, dispatch, isPending] = useActionState(reassignTicketAction, { success: false });
    
    const usersQuery = useMemoFirebase(() => 
        firestore ? query(collection(firestore, 'users'), where('departmentId', '==', categoryId), where('role', '==', 'Employee')) : null, 
        [firestore, categoryId]
    );
    const { data: categoryStaff } = useCollection<UserProfile>(usersQuery);

    useEffect(() => {
        if (state !== lastProcessedRef.current) {
            if (state.success) { 
                toast({ title: t('approved'), description: state.message }); 
                onClose(); 
            } else if (state.message) { 
                toast({ variant: "destructive", title: "Error", description: state.message }); 
            }
            lastProcessedRef.current = state;
        }
    }, [state, toast, onClose, t]);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle>{t('assignPerson')}</DialogTitle></DialogHeader>
                <form action={dispatch} className="space-y-4 pt-4">
                    <input type="hidden" name="ticketId" value={ticketId || ''} />
                    {actor && <><input type="hidden" name="actorId" value={actor.uid || ''} /><input type="hidden" name="actorName" value={actor.displayName || 'User'} /></>}
                    <div className="space-y-2 text-start">
                        <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('availableStaff')}</Label>
                        <Select name="newAssigneeId" required>
                            <SelectTrigger><SelectValue placeholder={t('selectEmployee')} /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="unassigned">{t('unassigned')}</SelectItem>
                                {categoryStaff?.map((s) => (<SelectItem key={s.id} value={s.id}><div className="flex items-center gap-2"><div className={cn("h-2 w-2 rounded-full", s.status === 'Busy' ? "bg-red-500" : "bg-green-500")} />{s.name}</div></SelectItem>))}
                            </SelectContent>
                        </Select>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={onClose}>{t('cancel')}</Button>
                        <Button type="submit" disabled={isPending} className="bg-[#1e3a8a] text-white font-bold">
                            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {t('confirmApproval')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function ManageTagsDialog({ 
    isOpen, 
    onClose, 
    ticketId, 
    currentTags = [] 
}: { 
    isOpen: boolean; 
    onClose: () => void; 
    ticketId: string; 
    currentTags: string[]; 
}) {
    const { firestore } = useFirebase();
    const { t } = useLanguage();
    const { toast } = useToast();
    const [selectedTags, setSelectedTags] = useState<string[]>(currentTags);
    const [isSaving, setIsSaving] = useState(false);

    const tagsQuery = useMemoFirebase(() => 
        firestore ? query(collection(firestore, 'settings_tags'), orderBy('name', 'asc')) : null, 
        [firestore]
    );
    const { data: predefinedTags } = useCollection<{ name: string }>(tagsQuery);

    const toggleTag = (tagName: string) => {
        setSelectedTags(prev => 
            prev.includes(tagName) ? prev.filter(t => t !== tagName) : [...prev, tagName]
        );
    };

    const handleSave = () => {
        if (!firestore) return;
        setIsSaving(true);
        const ticketRef = doc(firestore, 'tickets', ticketId);
        
        setDocumentNonBlocking(ticketRef, { 
            tags: selectedTags,
            updatedAt: serverTimestamp()
        }, { merge: true });

        toast({ title: t('statusUpdated'), description: t('profileUpdatedSub') });
        setIsSaving(false);
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-start">{t('tags')}</DialogTitle>
                    <DialogDescription className="text-start">{t('tagsDescription')}</DialogDescription>
                </DialogHeader>
                <div className="flex flex-wrap gap-2 py-6">
                    {predefinedTags?.map((tag) => (
                        <Badge 
                            key={tag.id} 
                            variant={selectedTags.includes(tag.name) ? "default" : "outline"}
                            className={cn(
                                "cursor-pointer px-3 py-1.5 text-xs font-bold transition-all rounded-lg",
                                selectedTags.includes(tag.name) ? "bg-[#1e3a8a] text-white border-[#1e3a8a]" : "hover:bg-slate-50 border-slate-200 text-slate-600"
                            )}
                            onClick={() => toggleTag(tag.name)}
                        >
                            #{tag.name}
                        </Badge>
                    ))}
                    {predefinedTags?.length === 0 && (
                        <p className="text-sm text-slate-400 italic py-4">{t('noTagsFound')}</p>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
                    <Button onClick={handleSave} disabled={isSaving} className="bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white font-bold px-8">
                        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : t('saveChanges')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default function TicketDetailPage() {
  const params = useParams();
  const ticketId = params.id as string;
  const { firestore } = useFirebase();
  const { user: currentUser } = useAuthUser();
  const { toast } = useToast();
  const { t, isRTL } = useLanguage();
  const [isTransferOpen, setTransferOpen] = useState(false);
  const [isAssignOpen, setAssignOpen] = useState(false);
  const [isTagsOpen, setTagsOpen] = useState(false);
  const lastProcessedReassignRef = useRef<any>(null);
  
  const [isVerified, setIsVerified] = useState(false);
  const [guestEmail, setGuestEmail] = useState('');
  const [verifyError, setVerifyError] = useState(false);

  const userProfileRef = useMemoFirebase(() => currentUser && firestore ? doc(firestore, 'users', currentUser.uid) : null, [currentUser, firestore]);
  const { data: userProfile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef);
  
  const ticketRef = useMemoFirebase(() => (firestore && ticketId) ? doc(firestore, 'tickets', ticketId) : null, [firestore, ticketId]);
  const { data: ticket, isLoading: isTicketLoading } = useDoc<Ticket>(ticketRef);
  
  const slaRef = useMemoFirebase(() => (firestore ? doc(firestore, 'settings', 'sla') : null), [firestore]);
  const { data: savedSLA } = useDoc<SLASettings>(slaRef);
  const slaSettings = savedSLA || DEFAULT_SLA_SETTINGS;

  const deptsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'departments')) : null), [firestore]);
  const { data: departments } = useCollection<Department>(deptsQuery);
  
  const [reassignRequestState, reassignRequestDispatch, isReassignRequestPending] = useActionState(requestTicketReassignmentAction, { success: false });

  useEffect(() => {
    if (reassignRequestState !== lastProcessedReassignRef.current) {
        if (reassignRequestState.success) toast({ title: t('approved'), description: reassignRequestState.message });
        else if (reassignRequestState.message) toast({ variant: "destructive", title: "Error", description: reassignRequestState.message });
        lastProcessedReassignRef.current = reassignRequestState;
    }
  }, [reassignRequestState, toast, t]);

  const updateTicketStatus = (newStatus: TicketStatus) => {
      if (!ticketRef || !ticket) return;
      
      const updates: Record<string, any> = { status: newStatus, updatedAt: serverTimestamp() };
      
      const isCurrentlyFinished = ticket.status === 'Resolved' || ticket.status === 'Closed' || ticket.status === 'Duplicate';
      const isNewActive = newStatus !== 'Resolved' && newStatus !== 'Closed' && newStatus !== 'Duplicate';
      
      if (isCurrentlyFinished && isNewActive) {
          updates.reopenedCount = (ticket.reopenedCount || 0) + 1;
          updates.lastReopenedAt = serverTimestamp();
      }

      if (newStatus === 'Resolved') updates.resolvedAt = serverTimestamp();
      if (newStatus === 'Closed') updates.closedAt = serverTimestamp();

      // SPECIFIC REQUIREMENT: Clear assigned person if status is manually set to Queue
      if (newStatus === 'Queue') {
          updates.assignedTo = deleteField();
          updates.assignedAt = deleteField();
      }
      
      setDocumentNonBlocking(ticketRef, updates, { merge: true });
      toast({ title: t('statusUpdated'), description: t('statusSetTo', { status: t(newStatus.toLowerCase()) || newStatus }) });
  };

  const handleVerify = () => {
      if (!ticket) return;
      const cleanInput = guestEmail.trim().toLowerCase();
      const parentEmail = (ticket.parentEmail || '').toLowerCase();
      const creatorEmail = (ticket.createdBy?.email || '').toLowerCase();

      if (cleanInput === parentEmail || cleanInput === creatorEmail) {
          setIsVerified(true);
          setVerifyError(false);
      } else {
          setVerifyError(true);
      }
  };

  const slaInfo = useMemo(() => {
    if (!ticket || !slaSettings || !departments) return null;
    
    const start = toDate(ticket.assignedAt || ticket.createdAt);
    const responded = toDate(ticket.firstRespondedAt);
    const isFinished = ['Resolved', 'Closed'].includes(ticket.status);
    const finishedAt = isFinished ? toDate(ticket.resolvedAt || ticket.closedAt) : null;

    if (!start || !ticket.assignedTo) return null;

    const dept = departments.find(d => d.id === ticket.departmentId);
    const hoursLimit = slaSettings[ticket.channel || 'Email']?.[ticket.priority || 'Normal'] || 24;
    
    const now = new Date();
    const compareTime = finishedAt || responded || now;
    const workingHoursElapsed = calculateWorkingHoursElapsed(start, compareTime, dept?.workingHours);

    const isBreached = workingHoursElapsed >= hoursLimit;
    const progress = Math.min(100, Math.max(0, (workingHoursElapsed / hoursLimit) * 100));

    return { 
      progress, 
      status: isBreached ? 'breached' : 'compliant', 
      color: isBreached ? 'bg-red-500' : 'bg-emerald-500', 
      label: isBreached ? t('slaBreached') : t('compliant'), 
      icon: isBreached ? AlertCircle : CheckCircle2 
    };
  }, [ticket, slaSettings, departments, t]);

  const isStaff = userProfile && ['Admin', 'Employee', 'Manager'].includes(userProfile.role);
  const showContent = isStaff || isVerified;

  if (isTicketLoading || isProfileLoading) return <div className="space-y-6"><Skeleton className="h-48 w-full" /><div className="grid md:grid-cols-3 gap-6"><Skeleton className="md:col-span-2 h-[500px]" /><Skeleton className="h-[500px]" /></div></div>;
  if (!ticket) return <div className="p-10 text-center">Ticket Not Found</div>;

  if (!showContent) {
      return (
          <div className="min-h-[70vh] flex items-center justify-center p-4">
              <Card className="w-full max-w-md border-none shadow-2xl overflow-hidden rounded-3xl">
                  <div className="bg-[#1e3a8a] p-10 text-white text-center space-y-3">
                      <div className="bg-white/10 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-white/20">
                          <ShieldCheck className="h-8 w-8 text-white" />
                      </div>
                      <h1 className="text-2xl font-black tracking-tight">{t('guestVerificationTitle')}</h1>
                      <p className="text-blue-100/70 text-sm leading-relaxed">{t('enterParentEmail')}</p>
                  </div>
                  <CardContent className="p-10 space-y-6 text-start">
                      <div className="space-y-2">
                          <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t('parentEmailLabel')}</Label>
                          <Input 
                            type="email" 
                            placeholder="m@example.com" 
                            value={guestEmail}
                            onChange={(e) => setGuestEmail(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
                            className={cn(
                                "h-14 bg-slate-50 border-slate-200 rounded-xl focus:ring-[#1e3a8a] text-lg font-bold text-slate-800",
                                verifyError && "border-red-500 bg-red-50"
                            )}
                          />
                          {verifyError && <p className="text-[11px] text-red-600 font-bold flex items-center gap-1 mt-2 animate-in fade-in slide-in-from-top-1"><AlertCircle className="h-3 w-3" /> {t('invalidGuestEmail')}</p>}
                      </div>
                      <Button 
                        onClick={handleVerify}
                        className="w-full h-14 bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white font-black text-lg rounded-xl shadow-lg transition-all active:scale-95"
                      >
                        {t('verifyBtn')}
                      </Button>
                      <p className="text-center text-[10px] text-slate-400 font-bold uppercase tracking-widest pt-4">{t('ticketId')}: T-{ticket.ticketNumber || ticket.id.substring(0,4)}</p>
                  </CardContent>
              </Card>
          </div>
      );
  }

  const SlaIcon = slaInfo?.icon || AlertCircle;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-20 animate-in fade-in duration-700">
      <TransferCategoryDialog isOpen={isTransferOpen} onClose={() => setTransferOpen(false)} ticketId={ticket.id} currentCategory={ticket.departmentId} userRole={userProfile?.role} />
      <AssignPersonDialog isOpen={isAssignOpen} onClose={() => setAssignOpen(false)} ticketId={ticket.id} categoryId={ticket.departmentId} />
      <ManageTagsDialog isOpen={isTagsOpen} onClose={() => setTagsOpen(false)} ticketId={ticket.id} currentTags={ticket.tags || []} />

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="space-y-4 text-start font-body">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
                  <Link href="/tickets" className="hover:text-primary flex items-center gap-1 transition-colors">{isRTL ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />} {t('ticketsPageTitle')}</Link>
                  <span>/</span><span className="text-slate-900 font-bold uppercase tracking-wider">T-{ticket.ticketNumber || ticket.id.substring(0,4)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                  <div className="px-3 py-1 bg-red-50 text-rose-600 text-[10px] font-bold rounded-md border border-red-100 uppercase tracking-tight">{ticket.divisionName || 'Operations'} — {ticket.departmentName}</div>
              </div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-none break-words">{ticket.title || ticket.subject || 'No Subject'}</h1>
          </div>
          <div className="flex flex-col items-end gap-2">
              <TicketStatusBadge status={ticket.status} />
              {slaInfo ? (
                <div className={cn("flex items-center gap-1 font-black text-[11px] uppercase", slaInfo.status === 'breached' ? "text-red-600" : "text-emerald-600")}><SlaIcon className="h-3.5 w-3.5" /> {slaInfo.label}</div>
              ) : (
                <div className="text-[11px] font-black uppercase text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-100">{t('awaitingAssignment')}</div>
              )}
              <div className="w-48 h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden"><div className={cn("h-full transition-all duration-1000", slaInfo?.color || "bg-slate-200")} style={{ width: `${slaInfo?.progress || 0}%` }} /></div>
          </div>
      </div>

      <div className="grid md:grid-cols-3 gap-8 items-start">
        <div className="md:col-span-2 space-y-8">
          <div className="space-y-4">
            {ticket.messages
              .filter(m => !m.isInternal || isStaff)
              .map((m, index) => (
                <Message 
                    key={m.id} 
                    message={m} 
                    ticketChannel={ticket.channel} 
                    ticketCreatorId={ticket.createdBy.userId} 
                    ticketId={ticket.id}
                    canDelete={currentUser?.uid === m.author.userId || userProfile?.role === 'Admin'}
                    parentName={ticket.parentName}
                    isOpeningMessage={index === 0}
                    extraAttachments={index === 0 ? ticket.attachments : []}
                />
            ))}
          </div>
          <ReplyArea ticket={ticket} />
          <div className="space-y-4 pt-10 text-start">
              <div className="flex items-center gap-2 text-sm font-black text-slate-900 uppercase tracking-widest"><History className="h-4 w-4" /> {t('activityLog')}</div>
              <div className="space-y-4 ps-4 border-s-2 border-slate-100 relative">
                  <div className="absolute -start-[18px] top-1.5 h-3 w-3 rounded-full bg-slate-300 border-2 border-white" />
                  <p className="text-sm font-bold text-slate-800">{t('initialRequestCreatedBy', { name: ticket.createdBy.name })}</p>
                  <p className="text-[10px] text-slate-400 font-medium">{toDate(ticket.createdAt)?.toLocaleString()}</p>
                  
                  <div className="mt-4 pt-4 border-t border-slate-50 space-y-1 opacity-80">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t('parentNameLabel')}: <span className="text-slate-900 normal-case font-black">{ticket.parentName || ticket.createdBy.name}</span></p>
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t('parentEmailLabel')}: <span className="text-slate-900 normal-case font-black">{ticket.parentEmail || ticket.createdBy.email || t('noEmail')}</span></p>
                  </div>
              </div>
          </div>
        </div>

        <div className="md:col-span-1 space-y-6">
          {isStaff && (
            <Card className="border-none shadow-sm overflow-hidden rounded-2xl bg-white">
                <CardHeader className="p-6 pb-2 text-start"><CardTitle className="text-xs font-black text-slate-900 uppercase tracking-widest">{t('actions')}</CardTitle></CardHeader>
                <CardContent className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <Button variant="outline" className="h-10 border-emerald-100 text-emerald-700 text-xs font-bold" onClick={() => updateTicketStatus('Resolved')}><Check className="h-3.5 w-3.5" /> {t('resolve')}</Button>
                        <Button variant="outline" className="h-10 border-slate-100 text-slate-600 text-xs font-bold" onClick={() => updateTicketStatus('Closed')}><X className="h-3.5 w-3.5" /> {t('close')}</Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Button variant="outline" className="h-10 border-blue-100 text-blue-700 text-xs font-bold" onClick={() => updateTicketStatus('Open')}><Inbox className="h-3.5 w-3.5" /> {t('open')}</Button>
                        <Button variant="outline" className="h-10 border-purple-100 text-purple-700 text-xs font-bold" onClick={() => updateTicketStatus('Queue')}><LayoutList className="h-3.5 w-3.5" /> {t('queue')}</Button>
                    </div>
                    <Button variant="outline" className="w-full h-10 border-slate-100 text-slate-800 font-bold text-xs" onClick={() => updateTicketStatus('Duplicate')}><Copy className="h-3.5 w-3.5" /> {t('duplicate')}</Button>
                    <Button variant="outline" className="w-full h-10 border-slate-100 text-slate-800 font-bold text-xs" onClick={() => setTransferOpen(true)}><RefreshCcw className="h-3.5 w-3.5" /> {userProfile?.role === 'Employee' ? t('requestTransfer') : t('transferCategory')}</Button>
                    {userProfile?.role !== 'Employee' ? (
                        <Button variant="outline" className="w-full h-10 border-slate-100 text-slate-800 font-bold text-xs" onClick={() => setAssignOpen(true)}><UserPlus className="h-3.5 w-3.5" /> {t('assignPerson')}</Button>
                    ) : (
                        <form action={reassignRequestDispatch}>
                            <input type="hidden" name="ticketId" value={ticket.id || ''} />
                            <input type="hidden" name="actorId" value={currentUser?.uid || ''} />
                            <input type="hidden" name="actorName" value={userProfile?.name || 'User'} />
                            <Button type="submit" variant="outline" disabled={isReassignRequestPending} className="w-full h-10 border-slate-100 text-slate-800 font-bold text-xs">
                                {isReassignRequestPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                                {t('requestReassignment')}
                            </Button>
                        </form>
                    )}
                </CardContent>
            </Card>
          )}

          <Card className="border-none shadow-sm overflow-hidden rounded-2xl bg-white">
            <CardHeader className="p-6 pb-2 text-start"><CardTitle className="text-xs font-black text-slate-900 uppercase tracking-widest">{t('details')}</CardTitle></CardHeader>
            <CardContent className="p-6 pt-0 space-y-0">
              <DetailRow label={t('ticketId')} value={`T-${ticket.ticketNumber || ticket.id.substring(0, 4)}`} />
              <DetailRow label={t('division')} value={ticket.divisionName || t('na')} />
              <DetailRow label={t('campus')} value={ticket.campusName || t('na')} />
              <DetailRow label={t('grade')} value={ticket.gradeName || t('na')} />
              <DetailRow label={t('category')} value={ticket.departmentName || t('na')} />
              <DetailRow label={t('assignedTo')} value={ticket.assignedTo?.name || t('unassigned')} />
              <DetailRow label={t('channel')} value={t(ticket.channel) || ticket.channel} />
              <DetailRow label={t('priority')} value={<span className="font-bold">{t(ticket.priority.toLowerCase())}</span>} />
              <DetailRow label={t('reopened')} value={<span className="font-bold text-orange-600">{ticket.reopenedCount || 0}</span>} />
              <DetailRow 
                label={t('tags')} 
                action={isStaff && (
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => setTagsOpen(true)}
                        className="h-5 w-5 p-0 hover:bg-blue-50 text-[#1e3a8a] rounded-full"
                    >
                        <Plus className="h-3.5 w-3.5 stroke-[3]" />
                    </Button>
                )}
                value={
                <div className="flex flex-wrap gap-1 justify-end">
                    {ticket.tags && ticket.tags.length > 0 ? (
                        ticket.tags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-[9px] px-1.5 py-0 rounded font-bold uppercase tracking-tight bg-slate-100 text-slate-600 border-0">
                                #{tag}
                            </Badge>
                        ))
                    ) : (
                        <span className="text-slate-300 text-[10px] italic">{t('noTags')}</span>
                    )}
                </div>
              } />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

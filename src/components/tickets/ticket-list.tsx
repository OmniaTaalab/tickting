
'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { TicketStatusBadge } from './ticket-status-badge';
import { TicketPriorityDisplay } from './ticket-priority-display';
import type { Ticket, Department, SLASettings, TicketChannel } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useRouter } from 'next/navigation';
import { useState, memo } from 'react';
import { cn } from '@/lib/utils';
import { TicketActionsToolbar } from './ticket-actions-toolbar';
import { ColumnId } from './ticket-filters';
import { format } from 'date-fns';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Mail, Phone, User, Globe, MessageCircle, LayoutList } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Timestamp } from 'firebase/firestore';
import { useLanguage } from '@/hooks/use-language';
import { calculateWorkingHoursElapsed } from '@/lib/working-hours-utils';

const defaultVisibleColumns: Record<ColumnId, boolean> = {
  id: true,
  details: true,
  date: true,
  assignedTo: true,
  priority: true,
  status: true,
  channel: true,
  division: true,
  campus: true,
  slaStatus: true,
  tags: true,
  lastUpdated: true,
  resolvedAt: false,
  closedAt: false,
  firstResponse: true,
};

interface TicketListProps {
  data: Ticket[] | null;
  isLoading: boolean;
  visibleColumns?: Record<ColumnId, boolean>;
  limit?: number;
  departments: Department[];
  slaSettings: SLASettings;
}

const toDate = (timestamp: Timestamp | string | undefined): Date | null => {
  if (!timestamp) return null;
  if (timestamp instanceof Timestamp) {
    return timestamp.toDate();
  }
  return new Date(timestamp);
};

const formatTicketDate = (ts: any) => {
  const d = toDate(ts);
  if (!d) return null;
  return format(d, 'MMM d, yyyy');
};

const formatTicketTimeOnly = (ts: any) => {
  const d = toDate(ts);
  if (!d) return null;
  return format(d, 'h:mm a');
};

const NotYet = () => {
  const { t } = useLanguage();
  return <span className="text-orange-600 font-semibold italic">{t('notYet')}</span>;
};

const categoryColors: { [key: string]: string } = {
    Marketing: 'text-pink-600',
    'R&D': 'text-purple-600',
    Cyber: 'text-fuchsia-600',
    Sales: 'text-blue-600',
    HR: 'text-orange-600',
    IT: 'text-green-600',
    Finance: 'text-indigo-600',
    Website: 'text-teal-600',
    Web: 'text-teal-600',
    Data: 'text-sky-600',
    Support: 'text-slate-600',
};

const getInitials = (name: string) => {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .substring(0, 2);
};

function ChannelBadge({ channel }: { channel: string }) {
  const { t } = useLanguage();
  const normalizedChannel = channel?.toLowerCase() || '';
  
  const styles: Record<string, { bg: string, text: string, icon: any, label: string }> = {
    'email': { bg: 'bg-[#dbeafe]', text: 'text-[#1e40af]', icon: Mail, label: 'Email' },
    'phone': { bg: 'bg-[#dcfce7]', text: 'text-[#166534]', icon: Phone, label: 'Phone' },
    'walk-in': { bg: 'bg-[#f3e8ff]', text: 'text-[#6b21a8]', icon: User, label: 'Walk-in' },
    'social media': { bg: 'bg-sky-100', text: 'text-sky-700', icon: Globe, label: 'Social Media' },
    'web': { bg: 'bg-amber-100', text: 'text-amber-700', icon: Globe, label: 'Web' },
    'whatsapp': { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: MessageCircle, label: 'WhatsApp' },
    'form': { bg: 'bg-indigo-100', text: 'text-indigo-700', icon: LayoutList, label: 'Form' },
  };

  const config = styles[normalizedChannel] || { bg: 'bg-slate-100', text: 'text-slate-700', icon: MessageCircle, label: channel };
  const Icon = config.icon;

  return (
    <div className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold text-xs tracking-tight whitespace-nowrap", config.bg, config.text)}>
      <Icon className="h-4 w-4 stroke-[2.5]" />
      {t(config.label)}
    </div>
  );
}

function SlaStatusBadge({ ticket, slaSettings, departments }: { ticket: Ticket; slaSettings: SLASettings; departments: Department[] }) {
  const { t } = useLanguage();
  const now = new Date();
  
  // Start from assignedAt for tech-SLA
  const start = toDate(ticket.assignedAt || ticket.createdAt);
  const responded = toDate(ticket.firstRespondedAt);
  
  const isFinished = ['Resolved', 'Closed'].includes(ticket.status);
  const finishedAt = isFinished ? toDate(ticket.resolvedAt || ticket.closedAt) : null;

  if (!start) return null;
  
  if (!ticket.assignedTo) {
    return (
        <span className="text-slate-400 font-bold text-[10px] uppercase tracking-tight italic bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
            {t('awaitingAssignment')}
        </span>
    );
  }

  const dept = departments.find(d => d.id === ticket.departmentId);
  
  // Correct channel normalization for SLA key lookup
  const rawChan = ticket.channel || 'Email';
  let channelKey: TicketChannel = 'Email';
  const lower = rawChan.toLowerCase();
  if (lower.includes('social')) channelKey = 'Social Media';
  else if (lower.includes('walk')) channelKey = 'Walk-in';
  else if (lower === 'website' || lower === 'api') channelKey = 'Web';
  else if (lower === 'whatsapp') channelKey = 'WhatsApp';
  else if (lower === 'form') channelKey = 'Form';
  else if (lower === 'phone') channelKey = 'Phone';
  else channelKey = (rawChan.charAt(0).toUpperCase() + rawChan.slice(1).toLowerCase()) as TicketChannel;

  const priority = ticket.priority || 'Normal';
  const policy = slaSettings[channelKey] || slaSettings['Email'];
  const hoursLimit = policy?.[priority] || 24;

  const compareTime = finishedAt || responded || now;
  const workingHoursElapsed = calculateWorkingHoursElapsed(start, compareTime, dept?.workingHours);

  if (workingHoursElapsed >= hoursLimit) {
    if (finishedAt || responded) {
        return <span className="text-red-600 font-black text-[12px] uppercase tracking-tight">{t('breached')}</span>;
    }
    const overTime = Math.round(workingHoursElapsed - hoursLimit);
    return (
      <span className="text-red-600 font-semibold text-[13px] underline underline-offset-4 decoration-[1.5px] decoration-red-600 whitespace-nowrap">
        {t('breachedAgo').replace('{{hours}}', String(overTime))}
      </span>
    );
  }

  if (finishedAt || responded) {
    return <span className="text-emerald-600 font-bold text-[12px] uppercase tracking-tight">{t('compliant')}</span>;
  }

  const hoursRemaining = Math.max(0, Math.round(hoursLimit - workingHoursElapsed));
  return (
    <span className={cn(
        "font-bold text-[12px] uppercase tracking-tight",
        hoursRemaining <= 2 ? "text-amber-600" : "text-slate-400"
    )}>
      {t('dueIn').replace('{{hours}}', String(hoursRemaining))}
    </span>
  );
}

export const TicketList = memo(function TicketList({
  data: tickets,
  isLoading,
  visibleColumns = defaultVisibleColumns,
  limit,
  departments,
  slaSettings
}: TicketListProps) {
  const router = useRouter();
  const { t } = useLanguage();
  const [selectedTicketIds, setSelectedTicketIds] = useState<string[]>([]);

  const handleRowClick = (ticketId: string) => {
    router.push(`/tickets/${ticketId}`);
  };
  
  const handleSelectTicket = (ticketId: string, checked: boolean) => {
    setSelectedTicketIds((prev) => {
      if (checked) {
        return [...prev, ticketId];
      } else {
        return prev.filter((id) => id !== ticketId);
      }
    });
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked && tickets) {
      setSelectedTicketIds(tickets.map((t) => t.id));
    } else {
      setSelectedTicketIds([]);
    }
  };

  const displayTickets = limit && tickets ? tickets.slice(0, limit) : tickets;
  const numSelected = selectedTicketIds.length;
  const numTickets = displayTickets?.length || 0;


  if (isLoading) {
    return (
      <div className="w-full overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]"><Checkbox /></TableHead>
              {visibleColumns.id && <TableHead className="w-[100px]">{t('idCol')}</TableHead>}
              {visibleColumns.details && <TableHead>{t('detailsCol')}</TableHead>}
              {visibleColumns.date && <><TableHead>{t('dateCreatedCol')}</TableHead><TableHead>{t('timeCreatedCol')}</TableHead></>}
              {visibleColumns.assignedTo && <TableHead>{t('assignedTechCol')}</TableHead>}
              {visibleColumns.priority && <TableHead>{t('priorityCol')}</TableHead>}
              {visibleColumns.status && <TableHead>{t('statusCol')}</TableHead>}
              {visibleColumns.channel && <TableHead>{t('channelCol')}</TableHead>}
              {visibleColumns.division && <TableHead>{t('divisionCol')}</TableHead>}
              {visibleColumns.campus && <TableHead>{t('campusCol')}</TableHead>}
              {visibleColumns.slaStatus && <TableHead>{t('slaStatusCol')}</TableHead>}
              {visibleColumns.tags && <TableHead>{t('tagsCol')}</TableHead>}
              {visibleColumns.lastUpdated && <><TableHead>{t('dateUpdatedCol')}</TableHead><TableHead>{t('timeUpdatedCol')}</TableHead></>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...Array(5)].map((_, i) => (
              <TableRow key={i}>
                <TableCell><Checkbox /></TableCell>
                {visibleColumns.id && <TableCell><Skeleton className="h-5 w-16" /></TableCell>}
                {visibleColumns.details && <TableCell><Skeleton className="h-5 w-48" /><Skeleton className="h-3 w-32 mt-1" /></TableCell>}
                {visibleColumns.date && <><TableCell><Skeleton className="h-5 w-24" /></TableCell><TableCell><Skeleton className="h-5 w-16" /></TableCell></>}
                {visibleColumns.assignedTo && <TableCell><Skeleton className="h-8 w-28" /></TableCell>}
                {visibleColumns.priority && <TableCell><Skeleton className="h-5 w-20" /></TableCell>}
                {visibleColumns.status && <TableCell><Skeleton className="h-6 w-20" /></TableCell>}
                {visibleColumns.channel && <TableCell><Skeleton className="h-8 w-24" /></TableCell>}
                {visibleColumns.division && <TableCell><Skeleton className="h-5 w-24" /></TableCell>}
                {visibleColumns.campus && <TableCell><Skeleton className="h-5 w-24" /></TableCell>}
                {visibleColumns.slaStatus && <TableCell><Skeleton className="h-6 w-24" /></TableCell>}
                {visibleColumns.tags && <TableCell><Skeleton className="h-5 w-20" /></TableCell>}
                {visibleColumns.lastUpdated && <><TableCell><Skeleton className="h-5 w-24" /></TableCell><TableCell><Skeleton className="h-5 w-16" /></TableCell></>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (!displayTickets || displayTickets.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-md border border-dashed p-8">
        <p className="text-muted-foreground">No tickets match the current filters.</p>
      </div>
    );
  }

  return (
    <div className='space-y-4'>
       {numSelected > 0 && (
        <TicketActionsToolbar
          selectedTicketIds={selectedTicketIds}
          onClear={() => setSelectedTicketIds([])}
        />
      )}
      <div className="w-full overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[50px]">
                 <Checkbox
                    onCheckedChange={(checked) => handleSelectAll(!!checked)}
                    checked={
                      numTickets > 0 && numSelected === numTickets
                        ? true
                        : numSelected > 0
                        ? 'indeterminate'
                        : false
                    }
                    aria-label="Select all"
                />
              </TableHead>
              {visibleColumns.id && <TableHead className="w-[100px]">{t('idCol')}</TableHead>}
              {visibleColumns.details && <TableHead>{t('detailsCol')}</TableHead>}
              {visibleColumns.date && (
                <>
                  <TableHead>{t('dateCreatedCol')}</TableHead>
                  <TableHead>{t('timeCreatedCol')}</TableHead>
                </>
              )}
              {visibleColumns.firstResponse && (
                <>
                  <TableHead>{t('dateFirstRespCol')}</TableHead>
                  <TableHead>{t('timeFirstRespCol')}</TableHead>
                </>
              )}
              {visibleColumns.assignedTo && <TableHead>{t('assignedTechCol')}</TableHead>}
              {visibleColumns.priority && <TableHead>{t('priorityCol')}</TableHead>}
              {visibleColumns.status && <TableHead>{t('statusCol')}</TableHead>}
              {visibleColumns.channel && <TableHead>{t('channelCol')}</TableHead>}
              {visibleColumns.division && <TableHead>{t('divisionCol')}</TableHead>}
              {visibleColumns.campus && <TableHead>{t('campusCol')}</TableHead>}
              {visibleColumns.slaStatus && <TableHead>{t('slaStatusCol')}</TableHead>}
              {visibleColumns.tags && <TableHead>{t('tagsCol')}</TableHead>}
              {visibleColumns.resolvedAt && (
                <>
                  <TableHead>{t('dateResolvedCol')}</TableHead>
                  <TableHead>{t('timeResolvedCol')}</TableHead>
                </>
              )}
              {visibleColumns.closedAt && (
                <>
                  <TableHead>{t('dateClosedCol')}</TableHead>
                  <TableHead>{t('timeClosedCol')}</TableHead>
                </>
              )}
              {visibleColumns.lastUpdated && (
                <>
                  <TableHead>{t('dateUpdatedCol')}</TableHead>
                  <TableHead>{t('timeUpdatedCol')}</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayTickets.map((ticket) => {
              
              const resolvedDept = departments?.find(d => d.id === ticket.departmentId);
              const deptName = resolvedDept?.name || ticket.departmentName || 'Uncategorized';
              
              const displayId = ticket.ticketNumber ? `#${ticket.ticketNumber}` : `#${ticket.id.substring(0, 4)}`;
              const displayTitle = ticket.title || ticket.subject || 'No Subject';

              const creatorName = ticket.parentName || ticket.createdBy?.name || t('unassigned');

              return (
                <TableRow key={ticket.id} data-state={selectedTicketIds.includes(ticket.id) && "selected"}>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox 
                          onCheckedChange={(checked) => handleSelectTicket(ticket.id, !!checked)}
                          checked={selectedTicketIds.includes(ticket.id)}
                          aria-label={`Select ticket ${ticket.id}`}
                      />
                  </TableCell>
                  {visibleColumns.id && <TableCell onClick={() => handleRowClick(ticket.id)} className="cursor-pointer font-bold text-primary text-lg whitespace-nowrap min-w-[90px]">
                    {displayId}
                  </TableCell>}
                  {visibleColumns.details && <TableCell onClick={() => handleRowClick(ticket.id)} className="cursor-pointer max-w-[300px]">
                    <div className="font-semibold text-base truncate">
                      {displayTitle}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      <span className={cn(categoryColors[deptName] || 'text-muted-foreground', "font-medium")}>
                          {deptName}
                      </span> | By {creatorName}
                    </div>
                  </TableCell>}
                  {visibleColumns.date && (
                    <>
                      <TableCell onClick={() => handleRowClick(ticket.id)} className="cursor-pointer">
                          <div className="text-sm">{formatTicketDate(ticket.createdAt) || t('na')}</div>
                      </TableCell>
                      <TableCell onClick={() => handleRowClick(ticket.id)} className="cursor-pointer">
                          <div className="text-sm font-medium">{formatTicketTimeOnly(ticket.createdAt) || t('na')}</div>
                      </TableCell>
                    </>
                  )}
                  {visibleColumns.firstResponse && (
                    <>
                      <TableCell onClick={() => handleRowClick(ticket.id)} className="cursor-pointer">
                          <div className="text-sm">{formatTicketDate(ticket.firstRespondedAt) || <NotYet />}</div>
                      </TableCell>
                      <TableCell onClick={() => handleRowClick(ticket.id)} className="cursor-pointer">
                          <div className="text-sm font-medium">{formatTicketTimeOnly(ticket.firstRespondedAt) || <NotYet />}</div>
                      </TableCell>
                    </>
                  )}
                  {visibleColumns.assignedTo && <TableCell onClick={() => handleRowClick(ticket.id)} className="cursor-pointer">
                    {ticket.assignedTo ? (
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={ticket.assignedTo.avatarUrl} alt={ticket.assignedTo.name} />
                          <AvatarFallback className="bg-primary text-primary-foreground text-[10px] font-bold">
                            {getInitials(ticket.assignedTo.name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium whitespace-nowrap">{ticket.assignedTo.name}</span>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground italic ps-10">{t('unassigned')}</span>
                    )}
                  </TableCell>}
                  {visibleColumns.priority && (
                    <TableCell onClick={() => handleRowClick(ticket.id)} className="cursor-pointer">
                      <TicketPriorityDisplay priority={ticket.priority} />
                    </TableCell>
                  )}
                  {visibleColumns.status && <TableCell onClick={() => handleRowClick(ticket.id)} className="cursor-pointer">
                    <TicketStatusBadge status={ticket.status} />
                  </TableCell>}
                  {visibleColumns.channel && <TableCell onClick={() => handleRowClick(ticket.id)} className="cursor-pointer">
                    <ChannelBadge channel={ticket.channel || 'Email'} />
                  </TableCell>}
                  {visibleColumns.division && <TableCell onClick={() => handleRowClick(ticket.id)} className="cursor-pointer font-medium">
                    {ticket.divisionName || t('na')}
                  </TableCell>}
                  {visibleColumns.campus && <TableCell onClick={() => handleRowClick(ticket.id)} className="cursor-pointer font-medium">
                    {ticket.campusName || t('na')}
                  </TableCell>}
                  {visibleColumns.slaStatus && <TableCell onClick={() => handleRowClick(ticket.id)} className="cursor-pointer">
                    <SlaStatusBadge ticket={ticket} slaSettings={slaSettings} departments={departments} />
                  </TableCell>}
                  {visibleColumns.tags && <TableCell onClick={() => handleRowClick(ticket.id)} className="cursor-pointer">
                    <div className="flex flex-wrap gap-1">
                      {ticket.tags && ticket.tags.length > 0 ? (
                        ticket.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0 rounded font-bold uppercase tracking-tight bg-slate-100 text-slate-600 border-0">
                            #{tag}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-slate-300 text-[10px] italic">{t('noTags')}</span>
                      )}
                    </div>
                  </TableCell>}
                  {visibleColumns.resolvedAt && (
                    <>
                      <TableCell onClick={() => handleRowClick(ticket.id)} className="cursor-pointer">
                          <div className="text-sm">{formatTicketDate(ticket.resolvedAt) || <NotYet />}</div>
                      </TableCell>
                      <TableCell onClick={() => handleRowClick(ticket.id)} className="cursor-pointer">
                          <div className="text-sm font-medium">{formatTicketTimeOnly(ticket.resolvedAt) || <NotYet />}</div>
                      </TableCell>
                    </>
                  )}
                  {visibleColumns.closedAt && (
                    <>
                      <TableCell onClick={() => handleRowClick(ticket.id)} className="cursor-pointer">
                          <div className="text-sm">{formatTicketDate(ticket.closedAt) || <NotYet />}</div>
                      </TableCell>
                      <TableCell onClick={() => handleRowClick(ticket.id) } className="cursor-pointer">
                          <div className="text-sm font-medium">{formatTicketTimeOnly(ticket.closedAt) || <NotYet />}</div>
                      </TableCell>
                    </>
                  )}
                  {visibleColumns.lastUpdated && (
                    <>
                      <TableCell onClick={() => handleRowClick(ticket.id)} className="cursor-pointer">
                          <div className="text-sm">{formatTicketDate(ticket.updatedAt) || t('na')}</div>
                      </TableCell>
                      <TableCell onClick={() => handleRowClick(ticket.id)} className="cursor-pointer">
                          <div className="text-sm font-medium">{formatTicketTimeOnly(ticket.updatedAt) || t('na')}</div>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
});

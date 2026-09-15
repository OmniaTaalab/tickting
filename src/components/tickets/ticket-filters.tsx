
'use client';

import { useState, useEffect } from 'react';
import type { Department, TicketStatus, Ticket, TicketChannel } from '@/lib/types';
import { Button } from '../ui/button';
import { ListFilter, Download, Calendar as CalendarIcon, Search, X, RotateCcw } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { Input } from '../ui/input';
import { useLanguage } from '@/hooks/use-language';

export type ColumnId = 'id' | 'details' | 'date' | 'assignedTo' | 'priority' | 'status' | 'channel' | 'division' | 'campus' | 'slaStatus' | 'lastUpdated' | 'resolvedAt' | 'closedAt' | 'firstResponse' | 'tags';
export type SLAFilterValue = 'all' | 'breached' | 'at-risk';

const CHANNEL_OPTIONS: TicketChannel[] = ['Phone', 'Walk-in', 'Social Media', 'Email', 'Web', 'Form'];

interface TicketFiltersProps {
  onFilterChange: (filters: {
    search?: string;
    departmentId?: string;
    status?: TicketStatus | '';
    channel?: TicketChannel | '';
    sla?: SLAFilterValue;
    dateRange?: DateRange | undefined;
  }) => void;
  values: {
    search: string;
    departmentId: string;
    status: TicketStatus | '';
    channel: TicketChannel | '';
    sla: SLAFilterValue;
    dateRange: DateRange | undefined;
  };
  showDepartmentFilter: boolean;
  departments?: Department[];
  visibleColumns: Record<ColumnId, boolean>;
  onVisibleColumnsChange: React.Dispatch<React.SetStateAction<Record<ColumnId, boolean>>>;
  data: Ticket[];
  statusCounts?: {
    all: number;
    Open: number;
    'In Progress': number;
    Resolved: number;
    Closed: number;
    Queue: number;
    Duplicate: number;
    Waiting: number;
  };
}

const toDate = (timestamp: any): Date | null => {
  if (!timestamp) return null;
  if (typeof timestamp.toDate === 'function') return timestamp.toDate();
  if (typeof timestamp.seconds === 'number') return new Date(timestamp.seconds * 1000);
  if (typeof timestamp._seconds === 'number') return new Date(typeof timestamp._seconds === 'number' ? timestamp._seconds * 1000 : 0);
  if (timestamp instanceof Date) return timestamp;
  try {
    const d = new Date(timestamp);
    return isNaN(d.getTime()) ? null : d;
  } catch (e) {
    return null;
  }
};

const CAIRO_TIMEZONE = 'Africa/Cairo';

const formatDatePart = (date: Date | null, type: 'date' | 'time'): string => {
  if (!date) return 'N/A';
  if (type === 'date') {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: CAIRO_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: CAIRO_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
};

export function TicketFilters({ 
  onFilterChange, 
  showDepartmentFilter, 
  values,
  departments = [], 
  visibleColumns, 
  onVisibleColumnsChange,
  data,
  statusCounts
}: TicketFiltersProps) {
  const { t } = useLanguage();
  
  const columnNames: Record<ColumnId, string> = {
    id: t('idCol'),
    details: t('detailsCol'),
    date: t('dateCreatedCol'),
    assignedTo: t('assignedTechCol'),
    priority: t('priorityCol'),
    status: t('statusCol'),
    channel: t('channelCol'),
    division: t('divisionCol'),
    campus: t('campusCol'),
    slaStatus: t('slaStatusCol'),
    tags: t('tagsCol'),
    lastUpdated: t('dateUpdatedCol'),
    resolvedAt: t('dateResolvedCol'),
    closedAt: t('dateClosedCol'),
    firstResponse: t('dateFirstRespCol'),
  };

  const [localSearch, setLocalSearch] = useState(values.search);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (localSearch !== values.search) {
        onFilterChange({ search: localSearch });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [localSearch, values.search, onFilterChange]);

  useEffect(() => {
    setLocalSearch(values.search);
  }, [values.search]);

  const handleExport = () => {
    if (!data || data.length === 0) return;

    const exportData = data.map(t => {
      const created = toDate(t.createdAt);
      const updated = toDate(t.updatedAt);
      const resolved = toDate(t.resolvedAt);
      const closed = toDate(t.closedAt);
      const firstResp = toDate(t.firstRespondedAt);
      
      return {
        'Ticket ID': t.ticketNumber || t.id.substring(0, 4),
        'Created Date': formatDatePart(created, 'date'),
        'Created Time': formatDatePart(created, 'time'),
        'Last update Date': formatDatePart(updated, 'date'),
        'Last update Time': formatDatePart(updated, 'time'),
        'Resolved Time': formatDatePart(resolved, 'time'),
        'Resolved Date': formatDatePart(resolved, 'date'),
        'Closed Time': formatDatePart(closed, 'time'),
        'Closed Date': formatDatePart(closed, 'date'),
        'First Response Date': formatDatePart(firstResp, 'date'),
        'First Response Time': formatDatePart(firstResp, 'time'),
        'Subject': t.subject,
        'Category': t.departmentName || 'N/A',
        'Division': t.divisionName || 'N/A',
        'Campus': t.campusName || 'N/A',
        'Channel': t.channel || 'N/A',
        'Status': t.status,
        'Priority': t.priority,
        'Assigned Tech': t.assignedTo?.name || 'Unassigned',
        'Created By': t.createdBy?.name || 'Unknown',
        'Tags': t.tags?.join(', ') || '',
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Tickets Report");

    XLSX.writeFile(workbook, `Tickets_Report_${format(new Date(), 'yyyy-MM-dd_HHmm')}.xlsx`);
  };

  const hasActiveFilters = Boolean(
    localSearch ||
    values.search ||
    values.departmentId ||
    values.status ||
    values.channel ||
    (values.sla && values.sla !== 'all') ||
    values.dateRange?.from
  );

  const handleClearFilters = () => {
    setLocalSearch('');
    try {
      sessionStorage.removeItem('nis_tickets_filter_state_v2');
      localStorage.removeItem('nis_tickets_filter_state_v2');
      sessionStorage.removeItem('nis_tickets_filter_state');
      localStorage.removeItem('nis_tickets_filter_state');
    } catch (e) {}
    onFilterChange({
      search: '',
      departmentId: '',
      status: '',
      channel: '',
      sla: 'all',
      dateRange: undefined,
    });
  };
  
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-slate-100/50 border p-3">
      <div className="flex flex-col xl:flex-row items-center justify-between gap-3">
        <div className="flex flex-col md:flex-row items-center gap-3 w-full xl:w-auto">
          <div className="relative w-full md:w-[280px]">
            <Search className="absolute ps-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder={t('searchPlaceholder')}
              className="ps-9 h-10 border-slate-200 bg-white/80 focus:bg-white transition-all rounded-xl shadow-sm font-medium"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
            />
            {localSearch && (
              <button 
                onClick={() => setLocalSearch('')}
                className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <Tabs 
            value={values.status || 'all'} 
            onValueChange={(val) => onFilterChange({ status: val === 'all' ? '' : (val as TicketStatus) })} 
            className="w-full md:w-auto"
          >
            <TabsList className="bg-slate-200/50 p-1 border h-10 items-stretch gap-1 overflow-x-auto overflow-y-hidden">
              {[
                { id: 'all', label: t('total'), count: statusCounts?.all },
                { id: 'Open', label: t('open'), count: statusCounts?.Open },
                { id: 'In Progress', label: t('inProgress'), count: statusCounts?.['In Progress'] },
                { id: 'Waiting', label: t('waiting'), count: statusCounts?.Waiting },
                { id: 'Resolved', label: t('resolved'), count: statusCounts?.Resolved },
                ...(statusCounts?.Closed ? [{ id: 'Closed', label: t('closed'), count: statusCounts?.Closed }] : []),
                { id: 'Queue', label: t('queue'), count: statusCounts?.Queue },
                { id: 'Duplicate', label: t('duplicate'), count: statusCounts?.Duplicate },
              ].map((tab) => (
                <TabsTrigger 
                  key={tab.id}
                  value={tab.id} 
                  className="px-3 text-[10px] font-black uppercase tracking-tight data-[state=active]:bg-[#1e3a8a] data-[state=active]:text-white transition-all flex items-center gap-2 whitespace-nowrap"
                >
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className={cn(
                      "px-1.5 py-0.5 rounded-full text-[9px] min-w-[18px] text-center",
                      values.status === tab.id || (tab.id === 'all' && !values.status)
                        ? "bg-white/20 text-white"
                        : "bg-slate-300 text-slate-600"
                    )}>
                      {tab.count}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        
        <div className="flex flex-wrap items-center justify-center xl:justify-end gap-2 w-full xl:w-auto">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={"outline"}
                className={cn(
                  "w-full sm:w-auto min-w-[200px] justify-start text-left font-bold h-10 bg-white border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm rounded-xl",
                  !values.dateRange?.from && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="me-2 h-4 w-4 text-slate-400" />
                {values.dateRange?.from ? (
                  values.dateRange.to ? (
                    <>
                      {format(new Date(values.dateRange.from), "LLL dd, y")} -{" "}
                      {format(new Date(values.dateRange.to), "LLL dd, y")}
                    </>
                  ) : (
                    format(new Date(values.dateRange.from), "LLL dd, y")
                  )
                ) : (
                  <span>{t('anyDate')}</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={values.dateRange?.from ? new Date(values.dateRange.from) : undefined}
                selected={values.dateRange?.from ? {
                  from: new Date(values.dateRange.from),
                  to: values.dateRange.to ? new Date(values.dateRange.to) : undefined,
                } : undefined}
                onSelect={(val) => onFilterChange({ dateRange: val })}
                numberOfMonths={2}
              />
              <div className="p-2 border-t bg-slate-50 flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => onFilterChange({ dateRange: undefined })} className="text-xs font-bold text-slate-600">
                  {t('cancel')}
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          <Select value={values.sla} onValueChange={(value) => onFilterChange({ sla: value as SLAFilterValue })}>
            <SelectTrigger className="w-full sm:w-[130px] bg-white h-10 border-slate-200 rounded-xl shadow-sm font-bold text-xs uppercase tracking-tight">
              <SelectValue placeholder={t('allSLA')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allSLA')}</SelectItem>
              <SelectItem value="breached" className="text-red-600 font-bold">{t('slaBreached')}</SelectItem>
              <SelectItem value="at-risk" className="text-amber-600 font-bold">{t('slaAtRisk')}</SelectItem>
            </SelectContent>
          </Select>

          <Select value={values.channel || 'all'} onValueChange={(value) => onFilterChange({ channel: value === 'all' ? '' : (value as TicketChannel) })}>
            <SelectTrigger className="w-full sm:w-[130px] bg-white h-10 border-slate-200 rounded-xl shadow-sm font-bold text-xs uppercase tracking-tight">
              <SelectValue placeholder={t('allChannels')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allChannels')}</SelectItem>
              {CHANNEL_OPTIONS.map((c) => (
                <SelectItem key={c} value={c}>{t(c)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {showDepartmentFilter && (
            <Select value={values.departmentId || 'all'} onValueChange={(value) => onFilterChange({ departmentId: value === 'all' ? '' : value })} disabled={!departments.length}>
              <SelectTrigger className="w-full sm:w-[150px] bg-white h-10 border-slate-200 rounded-xl shadow-sm font-bold text-xs uppercase tracking-tight">
                <SelectValue placeholder={t('allCategories')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allCategories')}</SelectItem>
                {departments?.map((dept) => <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          <Button 
            variant="outline" 
            size="sm" 
            className="h-10 rounded-xl gap-2 font-bold text-xs uppercase tracking-tight border-slate-200 bg-white hover:bg-slate-50 shadow-sm" 
            onClick={handleExport} 
            disabled={!data || data.length === 0}
          >
            <Download className="h-4 w-4 text-slate-500" />
            <span className="hidden md:inline">{t('export')}</span>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-10 rounded-xl font-bold text-xs uppercase tracking-tight border-slate-200 bg-white shadow-sm">
                <ListFilter className="me-2 h-4 w-4 text-slate-500" />
                {t('columns')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px]">
              <DropdownMenuLabel className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('toggleVisibility')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {Object.keys(columnNames).map((columnId) => (
                <DropdownMenuCheckboxItem
                  key={columnId}
                  checked={visibleColumns[columnId as ColumnId]}
                  onCheckedChange={(value) => onVisibleColumnsChange((prev) => ({ ...prev, [columnId]: !!value }))}
                  className="text-xs font-medium"
                >
                  {columnNames[columnId as ColumnId]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {hasActiveFilters && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearFilters}
              className="h-10 rounded-xl gap-1.5 font-bold text-xs uppercase tracking-tight border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700 shadow-sm transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>{t('clearFilters')}</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

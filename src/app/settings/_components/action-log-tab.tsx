'use client';

import { useState, useMemo } from 'react';
import { useFirebase, useCollection, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, query, orderBy, limit, doc } from 'firebase/firestore';
import type { SystemLog, UserProfile } from '@/lib/types';
import { useLanguage } from '@/hooks/use-language';
import { format, isToday, subDays, formatDistanceToNow } from 'date-fns';
import { 
  History, 
  Search, 
  Download, 
  Filter, 
  ShieldAlert, 
  CheckCircle2, 
  Ticket, 
  UserCheck, 
  Settings2, 
  Clock, 
  ArrowRightLeft, 
  FileText, 
  Eye, 
  Copy, 
  Check, 
  RefreshCw,
  Tag,
  Building2,
  Lock,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export function ActionLogTab() {
  const { firestore } = useFirebase();
  const { user } = useUser();
  const { t, isRTL } = useLanguage();
  const { toast } = useToast();

  // User Profile check for Admin verification
  const userProfileRef = useMemoFirebase(
    () => (firestore && user ? doc(firestore, 'users', user.uid) : null),
    [firestore, user]
  );
  const { data: userProfile, isLoading: profileLoading } = useDoc<UserProfile>(userProfileRef);

  // Filter and Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [dateFilter, setDateFilter] = useState('ALL');
  const [selectedLog, setSelectedLog] = useState<SystemLog | null>(null);
  const [copied, setCopied] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;

  // Real-time Firestore query for system-logs
  const logsQuery = useMemoFirebase(
    () => (firestore ? query(collection(firestore, 'system-logs'), orderBy('timestamp', 'desc'), limit(400)) : null),
    [firestore]
  );
  const { data: rawLogs, isLoading: logsLoading } = useCollection<SystemLog>(logsQuery);

  // Admin access validation
  const isAdmin = userProfile?.role === 'Admin';

  // Format timestamp helper
  const parseLogDate = (timestamp: any): Date | null => {
    if (!timestamp) return null;
    if (typeof timestamp.toDate === 'function') return timestamp.toDate();
    if (timestamp.seconds) return new Date(timestamp.seconds * 1000);
    const d = new Date(timestamp);
    return isNaN(d.getTime()) ? null : d;
  };

  // Categorize events
  const getEventCategory = (eventType: string = '') => {
    const type = eventType.toUpperCase();
    if (type.startsWith('TICKET_') || type.includes('REPLY') || type.includes('NOTE')) return 'TICKETS';
    if (type.startsWith('USER_') || type.startsWith('AUTH_')) return 'USERS';
    if (type.startsWith('SLA_') || type.startsWith('AFTER_HOURS_') || type.startsWith('WORKING_HOURS_')) return 'SLA';
    if (type.startsWith('REQUEST_') || type.includes('TRANSFER') || type.includes('REASSIGN')) return 'REQUESTS';
    if (
      type.startsWith('DEPARTMENT_') || 
      type.startsWith('CAMPUS_') || 
      type.startsWith('SCHOOL_') || 
      type.startsWith('DIVISION_') || 
      type.startsWith('GRADE_') || 
      type.startsWith('SUBJECT_') || 
      type.startsWith('TAG_')
    ) return 'ORGANIZATION';
    return 'OTHER';
  };

  // Get icon and color badge for event type
  const getEventBadge = (eventType: string = '') => {
    const category = getEventCategory(eventType);
    switch (category) {
      case 'TICKETS':
        return {
          icon: <Ticket className="h-3.5 w-3.5 text-blue-600" />,
          bg: 'bg-blue-50 text-blue-700 border-blue-200',
          label: eventType.replace('TICKET_', '').replace(/_/g, ' ')
        };
      case 'USERS':
        return {
          icon: <UserCheck className="h-3.5 w-3.5 text-emerald-600" />,
          bg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          label: eventType.replace('USER_', '').replace(/_/g, ' ')
        };
      case 'ORGANIZATION':
        return {
          icon: <Building2 className="h-3.5 w-3.5 text-purple-600" />,
          bg: 'bg-purple-50 text-purple-700 border-purple-200',
          label: eventType.replace(/_/g, ' ')
        };
      case 'SLA':
        return {
          icon: <Clock className="h-3.5 w-3.5 text-amber-600" />,
          bg: 'bg-amber-50 text-amber-700 border-amber-200',
          label: eventType.replace(/_/g, ' ')
        };
      case 'REQUESTS':
        return {
          icon: <ArrowRightLeft className="h-3.5 w-3.5 text-sky-600" />,
          bg: 'bg-sky-50 text-sky-700 border-sky-200',
          label: eventType.replace(/_/g, ' ')
        };
      default:
        return {
          icon: <History className="h-3.5 w-3.5 text-slate-600" />,
          bg: 'bg-slate-100 text-slate-700 border-slate-200',
          label: eventType.replace(/_/g, ' ')
        };
    }
  };

  // Helper to get actor display name
  const getActorName = (log: SystemLog) => {
    if (log.actor?.name) return log.actor.name;
    if (log.userName) return log.userName;
    if (log.userEmail) return log.userEmail;
    return 'System';
  };

  // Filtering logs
  const filteredLogs = useMemo(() => {
    if (!rawLogs) return [];
    
    return rawLogs.filter((log) => {
      // Category filter
      if (categoryFilter !== 'ALL') {
        const cat = getEventCategory(log.eventType);
        if (cat !== categoryFilter) return false;
      }

      // Date filter
      const date = parseLogDate(log.timestamp);
      if (dateFilter === 'TODAY' && date && !isToday(date)) return false;
      if (dateFilter === 'WEEK' && date && date < subDays(new Date(), 7)) return false;
      if (dateFilter === 'MONTH' && date && date < subDays(new Date(), 30)) return false;

      // Text Search
      if (searchQuery.trim()) {
        const queryLower = searchQuery.toLowerCase().trim();
        const actor = getActorName(log).toLowerCase();
        const message = (log.message || '').toLowerCase();
        const type = (log.eventType || '').toLowerCase();
        const detailsStr = JSON.stringify(log.details || {}).toLowerCase();
        
        return (
          actor.includes(queryLower) ||
          message.includes(queryLower) ||
          type.includes(queryLower) ||
          detailsStr.includes(queryLower)
        );
      }

      return true;
    });
  }, [rawLogs, categoryFilter, dateFilter, searchQuery]);

  // Pagination calculation
  const totalPages = Math.ceil(filteredLogs.length / itemsPerPage) || 1;
  const paginatedLogs = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredLogs.slice(start, start + itemsPerPage);
  }, [filteredLogs, currentPage, itemsPerPage]);

  // Statistics calculation
  const stats = useMemo(() => {
    if (!rawLogs) return { total: 0, today: 0, tickets: 0, org: 0 };
    let todayCount = 0;
    let ticketCount = 0;
    let orgCount = 0;

    rawLogs.forEach((log) => {
      const date = parseLogDate(log.timestamp);
      if (date && isToday(date)) todayCount++;
      const cat = getEventCategory(log.eventType);
      if (cat === 'TICKETS') ticketCount++;
      if (cat === 'ORGANIZATION' || cat === 'USERS') orgCount++;
    });

    return {
      total: rawLogs.length,
      today: todayCount,
      tickets: ticketCount,
      org: orgCount,
    };
  }, [rawLogs]);

  // Export to CSV
  const exportToCSV = () => {
    if (!filteredLogs.length) return;
    
    const headers = ['Timestamp', 'Event Type', 'Actor', 'Message', 'Details'];
    const rows = filteredLogs.map((log) => {
      const date = parseLogDate(log.timestamp);
      const formattedDate = date ? format(date, 'yyyy-MM-dd HH:mm:ss') : '';
      const actor = getActorName(log);
      const message = `"${(log.message || '').replace(/"/g, '""')}"`;
      const details = `"${JSON.stringify(log.details || {}).replace(/"/g, '""')}"`;
      return [formattedDate, log.eventType, `"${actor}"`, message, details].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `system_action_log_${format(new Date(), 'yyyyMMdd_HHmm')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: 'Export Complete', description: `${filteredLogs.length} events exported successfully.` });
  };

  const copyDetailsJSON = () => {
    if (!selectedLog) return;
    navigator.clipboard.writeText(JSON.stringify(selectedLog, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: 'Copied to clipboard' });
  };

  // Helper to render message with clickable ticket links
  const renderMessageWithLinks = (message: string, details?: Record<string, any>) => {
    if (!message) return null;

    // Check if details has ticketId
    const ticketId = details?.ticketId;
    
    // Pattern to match #1234 or #12345
    const ticketRegex = /(#\d+)/g;
    const parts = message.split(ticketRegex);

    return (
      <span className="text-slate-800 text-sm font-medium">
        {parts.map((part, index) => {
          if (ticketRegex.test(part) && ticketId) {
            return (
              <Link 
                key={index} 
                href={`/tickets/${ticketId}`}
                className="font-bold text-blue-600 hover:text-blue-800 hover:underline mx-0.5 inline-flex items-center gap-0.5 bg-blue-50 px-1 py-0.2 rounded"
              >
                {part}
              </Link>
            );
          }
          return <span key={index}>{part}</span>;
        })}
      </span>
    );
  };

  // If role loading
  if (profileLoading) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-8 w-64 bg-slate-200 animate-pulse rounded" />
        <div className="h-32 bg-slate-100 animate-pulse rounded-lg" />
      </div>
    );
  }

  // Access check: Only Admins can view Action Log
  if (!isAdmin) {
    return (
      <Card className="border-red-200 bg-red-50/50 shadow-sm">
        <CardContent className="flex flex-col items-center justify-center p-12 text-center space-y-4">
          <div className="h-16 w-16 rounded-full bg-red-100 flex items-center justify-center text-red-600 shadow-sm">
            <Lock className="h-8 w-8" />
          </div>
          <div className="space-y-1 max-w-md">
            <h3 className="text-xl font-bold text-slate-900">{t('actionLog')}</h3>
            <p className="text-sm text-slate-600">
              Access to the Action Log is strictly restricted to Administrators. It maintains the full system audit trail and sensitive administrative records.
            </p>
          </div>
          <Badge variant="destructive" className="px-3 py-1 font-semibold uppercase text-xs">
            Admin Access Required
          </Badge>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      {/* Top Banner / Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 p-6 rounded-xl text-white shadow-md">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
              <History className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              {t('actionLog')}
              <Badge className="bg-amber-500/20 text-amber-300 border-amber-400/30 text-[10px] uppercase font-bold tracking-wider">
                {t('adminOnlyBadge')}
              </Badge>
            </h2>
          </div>
          <p className="text-sm text-slate-300 max-w-2xl font-normal leading-relaxed">
            {t('actionLogDesc')}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <Button 
            onClick={exportToCSV}
            variant="outline" 
            size="sm" 
            className="bg-white/10 hover:bg-white/20 text-white border-white/20 font-semibold gap-1.5 shadow-sm"
          >
            <Download className="h-4 w-4" />
            {t('exportLogs')}
          </Button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-slate-200/80 shadow-xs bg-white">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <History className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{t('totalActions')}</p>
              <h4 className="text-2xl font-bold text-slate-900">{stats.total}</h4>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-xs bg-white">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{t('actionsToday')}</p>
              <h4 className="text-2xl font-bold text-slate-900">{stats.today}</h4>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-xs bg-white">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <Ticket className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{t('ticketEvents')}</p>
              <h4 className="text-2xl font-bold text-slate-900">{stats.tickets}</h4>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-xs bg-white">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
              <Settings2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{t('orgEvents')}</p>
              <h4 className="text-2xl font-bold text-slate-900">{stats.org}</h4>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Controls */}
      <Card className="border-slate-200 shadow-xs bg-white">
        <CardContent className="p-4">
          <div className="flex flex-col lg:flex-row gap-3 items-center justify-between">
            {/* Search Input */}
            <div className="relative w-full lg:w-96">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder={t('searchLogs')}
                className="ps-9 bg-slate-50/50 border-slate-200 focus:bg-white transition-all text-sm"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 font-bold"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Category and Date Dropdowns */}
            <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
              <Select
                value={categoryFilter}
                onValueChange={(val) => {
                  setCategoryFilter(val);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="w-full sm:w-44 bg-slate-50/50 text-xs font-semibold">
                  <Filter className="h-3.5 w-3.5 me-1.5 text-slate-500" />
                  <SelectValue placeholder={t('allEvents')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t('allEvents')}</SelectItem>
                  <SelectItem value="TICKETS">{t('ticketEvents')}</SelectItem>
                  <SelectItem value="USERS">{t('userEvents')}</SelectItem>
                  <SelectItem value="ORGANIZATION">{t('orgEvents')}</SelectItem>
                  <SelectItem value="SLA">{t('slaEvents')}</SelectItem>
                  <SelectItem value="REQUESTS">Requests & Transfers</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={dateFilter}
                onValueChange={(val) => {
                  setDateFilter(val);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="w-full sm:w-36 bg-slate-50/50 text-xs font-semibold">
                  <Clock className="h-3.5 w-3.5 me-1.5 text-slate-500" />
                  <SelectValue placeholder={t('dateFilter')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t('allTime')}</SelectItem>
                  <SelectItem value="TODAY">{t('today')}</SelectItem>
                  <SelectItem value="WEEK">{t('past7Days')}</SelectItem>
                  <SelectItem value="MONTH">{t('past30Days')}</SelectItem>
                </SelectContent>
              </Select>

              {(searchQuery || categoryFilter !== 'ALL' || dateFilter !== 'ALL') && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchQuery('');
                    setCategoryFilter('ALL');
                    setDateFilter('ALL');
                    setCurrentPage(1);
                  }}
                  className="text-xs text-slate-600 hover:text-slate-900 font-semibold"
                >
                  Reset
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Activity Feed Table / List */}
      <Card className="border-slate-200 shadow-xs overflow-hidden bg-white">
        <CardHeader className="bg-slate-50/70 border-b border-slate-200 py-3 px-4 flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold text-xs uppercase tracking-wider text-slate-700">
              Audit Stream ({filteredLogs.length})
            </span>
            <div className="flex items-center gap-1.5 ms-2 text-[11px] text-emerald-600 font-medium">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              Live Sync
            </div>
          </div>

          <div className="text-xs text-slate-500">
            Page {currentPage} of {totalPages}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {logsLoading ? (
            <div className="divide-y divide-slate-100">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="p-4 flex items-center justify-between gap-4 animate-pulse">
                  <div className="flex items-center gap-3 w-1/3">
                    <div className="h-9 w-9 rounded-full bg-slate-200" />
                    <div className="space-y-1.5 flex-1">
                      <div className="h-3 w-28 bg-slate-200 rounded" />
                      <div className="h-2.5 w-16 bg-slate-100 rounded" />
                    </div>
                  </div>
                  <div className="h-3 w-1/2 bg-slate-100 rounded" />
                  <div className="h-6 w-20 bg-slate-200 rounded" />
                </div>
              ))}
            </div>
          ) : paginatedLogs.length === 0 ? (
            <div className="text-center py-16 px-4 space-y-3">
              <div className="h-12 w-12 rounded-full bg-slate-100 mx-auto flex items-center justify-center text-slate-400">
                <History className="h-6 w-6" />
              </div>
              <p className="font-semibold text-slate-700">{t('noLogsFound')}</p>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                No system events matched your search query or selected category filters.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {paginatedLogs.map((log) => {
                const logDate = parseLogDate(log.timestamp);
                const badgeInfo = getEventBadge(log.eventType);
                const actorName = getActorName(log);

                return (
                  <div 
                    key={log.id} 
                    className="p-4 hover:bg-slate-50/80 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3 group"
                  >
                    {/* Left: Actor and Time */}
                    <div className="flex items-start md:items-center gap-3 min-w-[220px]">
                      <div className="h-9 w-9 rounded-full bg-slate-800 text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-xs uppercase">
                        {actorName.substring(0, 2)}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900 text-xs flex items-center gap-1.5">
                          <span>{actorName}</span>
                          {log.actor?.userId && (
                            <span className="text-[10px] text-slate-400 font-mono">
                              ({log.actor.userId.substring(0, 6)})
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                          <Clock className="h-3 w-3 text-slate-400" />
                          <span>{logDate ? format(logDate, 'MMM d, h:mm a') : 'Just now'}</span>
                          {logDate && (
                            <span className="text-slate-400 text-[10px]">
                              • {formatDistanceToNow(logDate, { addSuffix: true })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Middle: Event Badge and Message */}
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider",
                          badgeInfo.bg
                        )}>
                          {badgeInfo.icon}
                          {badgeInfo.label}
                        </span>
                      </div>
                      <div className="pt-0.5">
                        {renderMessageWithLinks(log.message, log.details)}
                      </div>
                    </div>

                    {/* Right: Inspect Details Button */}
                    <div className="flex items-center justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedLog(log)}
                        className="text-xs text-slate-500 hover:text-indigo-600 hover:bg-indigo-50/70 font-semibold gap-1 px-2.5 h-8"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>Details</span>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
            <p className="text-xs text-slate-500 font-medium">
              Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filteredLogs.length)} of {filteredLogs.length} events
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                className="h-8 px-2.5 text-xs font-semibold"
              >
                <ChevronLeft className="h-3.5 w-3.5 me-1" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                className="h-8 px-2.5 text-xs font-semibold"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5 ms-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Details Inspector Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
          {selectedLog && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between gap-2">
                  <DialogTitle className="text-base font-bold flex items-center gap-2">
                    <History className="h-5 w-5 text-indigo-600" />
                    {t('eventDetails')}
                  </DialogTitle>
                  <Badge variant="outline" className="font-mono text-xs">
                    ID: {selectedLog.id}
                  </Badge>
                </div>
                <DialogDescription className="text-xs text-slate-500">
                  Full system audit snapshot and event parameters.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 pt-2">
                {/* Meta summary card */}
                <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 text-xs space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-slate-500 font-medium">Event Type:</span>
                      <p className="font-bold text-slate-900">{selectedLog.eventType}</p>
                    </div>
                    <div>
                      <span className="text-slate-500 font-medium">Actor:</span>
                      <p className="font-bold text-slate-900">{getActorName(selectedLog)}</p>
                    </div>
                    <div>
                      <span className="text-slate-500 font-medium">Timestamp:</span>
                      <p className="font-semibold text-slate-700">
                        {parseLogDate(selectedLog.timestamp) ? format(parseLogDate(selectedLog.timestamp)!, 'yyyy-MM-dd HH:mm:ss') : 'Unknown'}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500 font-medium">Category:</span>
                      <p className="font-semibold text-indigo-700">{getEventCategory(selectedLog.eventType)}</p>
                    </div>
                  </div>
                  <div className="pt-1 border-t border-slate-200">
                    <span className="text-slate-500 font-medium">Description:</span>
                    <p className="font-medium text-slate-900 mt-0.5">{selectedLog.message}</p>
                  </div>
                </div>

                {/* Raw JSON Payload */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Event Metadata (JSON)
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={copyDetailsJSON}
                      className="h-7 text-xs font-semibold text-slate-600 gap-1"
                    >
                      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? 'Copied' : 'Copy JSON'}
                    </Button>
                  </div>
                  <pre className="p-3 bg-slate-950 text-slate-100 rounded-lg text-[11px] font-mono overflow-x-auto max-h-60 border border-slate-800">
                    {JSON.stringify(selectedLog, null, 2)}
                  </pre>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

'use client';

import { useState, useMemo } from 'react';
import { useFirebase, useCollection, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, query, orderBy, doc } from 'firebase/firestore';
import type {
  TicketTransferRecord,
  UserProfile,
  Department,
  Campus,
  Ticket
} from '@/lib/types';
import { useLanguage } from '@/hooks/use-language';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, ArrowRight, Calendar, Building2, School, User2, FilterX, RotateCcw, Route, Ticket as TicketIcon } from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const toDate = (ts: any): Date | null => {
  if (!ts) return null;
  if (typeof ts?.toDate === 'function') return ts.toDate();
  try {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  } catch (e) {
    return null;
  }
};

export default function TrackHistoryPage() {
  const { firestore } = useFirebase();
  const { user } = useUser();
  const { t, isRTL } = useLanguage();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFromDept, setSelectedFromDept] = useState<string>('all');
  const [selectedToDept, setSelectedToDept] = useState<string>('all');
  const [selectedCampus, setSelectedCampus] = useState<string>('all');
  const [dateRange, setDateRange] = useState<'all' | 'today' | 'week' | 'month'>('all');

  const userProfileRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, 'users', user.uid) : null),
    [user, firestore]
  );
  const { data: userProfile } = useDoc<UserProfile>(userProfileRef);

  const transfersQuery = useMemoFirebase(
    () => (firestore ? query(collection(firestore, 'ticket-transfers'), orderBy('transferredAt', 'desc')) : null),
    [firestore]
  );
  const { data: directTransfers, isLoading: isTransfersLoading } = useCollection<TicketTransferRecord>(transfersQuery);

  const ticketsQuery = useMemoFirebase(
    () => (firestore ? query(collection(firestore, 'tickets')) : null),
    [firestore]
  );
  const { data: allTickets } = useCollection<Ticket>(ticketsQuery);

  const ticketsMap = useMemo(() => {
    if (!allTickets) return new Map<string, Ticket>();
    return new Map(allTickets.map(t => [t.id, t]));
  }, [allTickets]);

  const departmentsQuery = useMemoFirebase(
    () => (firestore ? query(collection(firestore, 'departments')) : null),
    [firestore]
  );
  const { data: departments } = useCollection<Department>(departmentsQuery);

  const campusesQuery = useMemoFirebase(
    () => (firestore ? query(collection(firestore, 'campuses')) : null),
    [firestore]
  );
  const { data: campuses } = useCollection<Campus>(campusesQuery);

  // Combine transfers from ticket-transfers collection and tickets.transferHistory
  const allTransfers = useMemo(() => {
    const map = new Map<string, TicketTransferRecord>();

    if (directTransfers) {
      directTransfers.forEach(record => {
        if (record.id) map.set(record.id, record);
      });
    }

    // if (allTickets) {
    //   allTickets.forEach(ticket => {
    //     if (ticket.transferHistory && Array.isArray(ticket.transferHistory)) {
    //       ticket.transferHistory.forEach((record, index) => {
    //         const key = record.id || `${ticket.id}-transfer-${index}`;
    //         if (!map.has(key)) {
    //           map.set(key, {
    //             ...record,
    //             id: key,
    //             ticketId: record.ticketId || ticket.id,
    //             ticketNumber: record.ticketNumber || ticket.ticketNumber,
    //             ticketTitle: record.ticketTitle || ticket.title,
    //             ticketSubject: record.ticketSubject || ticket.subject,
    //             ticketDescription: record.ticketDescription || ticket.description,
    //             campusId: record.campusId || ticket.campusId,
    //             campusName: record.campusName || ticket.campusName,
    //             divisionName: record.divisionName || ticket.divisionName,
    //           });
    //         }
    //       });
    //     }
    //   });
    // }

    const list = Array.from(map.values());
    list.sort((a, b) => {
      const dateA = toDate(a.transferredAt)?.getTime() || 0;
      const dateB = toDate(b.transferredAt)?.getTime() || 0;
      return dateB - dateA;
    });

    return list;
  }, [directTransfers]);

  // Scoped list according to role & department
  const scopedTransfers = useMemo(() => {
    if (!userProfile) return [];

    if (userProfile.role === 'Admin') {
      return allTransfers;
    }

    if (userProfile.role === 'Manager') {
      const myDeptId = userProfile.departmentId;
      const myCampuses = userProfile.campusIds || [];
      return allTransfers.filter(tr => {
        const matchesDept = tr.fromDepartmentId === myDeptId || tr.toDepartmentId === myDeptId;
        const matchesCampus = myCampuses.length === 0 || (tr.campusId && myCampuses.includes(tr.campusId));
        return matchesDept && matchesCampus;
      });
    }

    // Employee: see transfers where they were previous assignee or new assignee, or their campus
    const myUid = user?.uid;
    const myCampuses = userProfile.campusIds || [];
    return allTransfers.filter(tr => {
      const isActor = tr.fromUser?.userId === myUid || tr.toUser?.userId === myUid || tr.requestedBy?.userId === myUid;
      const isCampus = myCampuses.length > 0 && tr.campusId && myCampuses.includes(tr.campusId);
      return isActor || isCampus;
    });
  }, [allTransfers, userProfile, user]);

  // Filtered by UI controls
  const filteredTransfers = useMemo(() => {
    return scopedTransfers.filter(item => {
      const matchingTicket = ticketsMap.get(item.ticketId);
      const effectiveToUser = (item.toUser && item.toUser.name)
        ? item.toUser
        : (matchingTicket && matchingTicket.departmentId === item.toDepartmentId && matchingTicket.assignedTo?.name
            ? {
                userId: matchingTicket.assignedTo.userId,
                name: matchingTicket.assignedTo.name,
                avatarUrl: matchingTicket.assignedTo.avatarUrl || '',
                email: matchingTicket.assignedTo.email || '',
              }
            : null);

      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const numMatch = item.ticketNumber ? String(item.ticketNumber).includes(q) : false;
        const titleMatch = item.ticketTitle?.toLowerCase().includes(q) || false;
        const subjectMatch = item.ticketSubject?.toLowerCase().includes(q) || false;
        const fromDeptMatch = item.fromDepartmentName?.toLowerCase().includes(q) || false;
        const toDeptMatch = item.toDepartmentName?.toLowerCase().includes(q) || false;
        const fromUserMatch = item.fromUser?.name?.toLowerCase().includes(q) || false;
        const toUserMatch = (item.toUser?.name?.toLowerCase().includes(q) || effectiveToUser?.name?.toLowerCase().includes(q)) || false;
        const campusMatch = item.campusName?.toLowerCase().includes(q) || false;

        if (!numMatch && !titleMatch && !subjectMatch && !fromDeptMatch && !toDeptMatch && !fromUserMatch && !toUserMatch && !campusMatch) {
          return false;
        }
      }

      // Department filter
      if (selectedFromDept !== 'all' && item.fromDepartmentId !== selectedFromDept) return false;
      if (selectedToDept !== 'all' && item.toDepartmentId !== selectedToDept) return false;

      // Campus filter
      if (selectedCampus !== 'all' && item.campusId !== selectedCampus) return false;

      // Date range
      if (dateRange !== 'all') {
        const itemDate = toDate(item.transferredAt);
        if (!itemDate) return false;

        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        if (dateRange === 'today') {
          if (itemDate < startOfDay) return false;
        } else if (dateRange === 'week') {
          const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          if (itemDate < sevenDaysAgo) return false;
        } else if (dateRange === 'month') {
          const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          if (itemDate < thirtyDaysAgo) return false;
        }
      }

      return true;
    });
  }, [scopedTransfers, searchQuery, selectedFromDept, selectedToDept, selectedCampus, dateRange]);

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedFromDept('all');
    setSelectedToDept('all');
    setSelectedCampus('all');
    setDateRange('all');
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-5">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-blue-50 text-blue-700">
              <Route className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">
                {t('trackHistory')}
              </h1>
              <p className="text-sm text-slate-500 font-medium">
                {t('trackHistorySub')}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="px-3 py-1 font-semibold text-xs border-slate-300">
            {filteredTransfers.length} {t('records')}
          </Badge>
        </div>
      </div>

      {/* Filter Bar */}
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* Search */}
            <div className="relative lg:col-span-2">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder={t('searchTransfersPlaceholder')}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="ps-9 h-10 border-slate-200"
              />
            </div>

            {/* From Department */}
            <div>
              <Select value={selectedFromDept} onValueChange={setSelectedFromDept}>
                <SelectTrigger className="h-10 border-slate-200">
                  <SelectValue placeholder={t('fromDepartment')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allOriginDepartments')}</SelectItem>
                  {departments?.map(d => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* To Department */}
            <div>
              <Select value={selectedToDept} onValueChange={setSelectedToDept}>
                <SelectTrigger className="h-10 border-slate-200">
                  <SelectValue placeholder={t('toDepartment')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allDestinationDepartments')}</SelectItem>
                  {departments?.map(d => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Campus Filter */}
            <div>
              <Select value={selectedCampus} onValueChange={setSelectedCampus}>
                <SelectTrigger className="h-10 border-slate-200">
                  <SelectValue placeholder={t('allCampuses')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allCampuses')}</SelectItem>
                  {campuses?.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
            {/* Date filter pills */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-semibold text-slate-500 me-1">
                <Calendar className="h-3.5 w-3.5 inline me-1 text-slate-400" />
                {t('filterByDate')}:
              </span>
              {(['all', 'today', 'week', 'month'] as const).map(range => (
                <Button
                  key={range}
                  variant={dateRange === range ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDateRange(range)}
                  className={`h-7 text-xs font-semibold ${
                    dateRange === range ? 'bg-blue-900 text-white' : 'border-slate-200 text-slate-600'
                  }`}
                >
                  {range === 'all' && t('allTime')}
                  {range === 'today' && t('today')}
                  {range === 'week' && t('last7Days')}
                  {range === 'month' && t('last30Days')}
                </Button>
              ))}
            </div>

            {(searchQuery || selectedFromDept !== 'all' || selectedToDept !== 'all' || selectedCampus !== 'all' || dateRange !== 'all') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetFilters}
                className="text-xs text-slate-500 hover:text-slate-800 gap-1.5 h-7 font-semibold"
              >
                <FilterX className="h-3.5 w-3.5" />
                {t('resetFilters')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Transfer List */}
      <div className="space-y-4">
        {isTransfersLoading ? (
          <div className="text-center py-16 text-slate-400 text-sm font-semibold animate-pulse">
            {t('loadingTransfers')}
          </div>
        ) : filteredTransfers.length === 0 ? (
          <Card className="border-dashed border-slate-200 bg-slate-50/50">
            <CardContent className="py-16 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                <Route className="h-6 w-6" />
              </div>
              <h3 className="font-bold text-slate-800 text-lg">{t('noTransfersFound')}</h3>
              <p className="text-sm text-slate-500 max-w-sm mx-auto">
                {t('noTransfersDescription')}
              </p>
              {(searchQuery || selectedFromDept !== 'all' || selectedToDept !== 'all' || selectedCampus !== 'all' || dateRange !== 'all') && (
                <Button variant="outline" size="sm" onClick={handleResetFilters} className="gap-2 mt-2">
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t('clearSearchFilters')}
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          filteredTransfers.map(record => {
            const transferDate = toDate(record.transferredAt);
            const dateStr = transferDate ? format(transferDate, 'MMM d, yyyy • h:mm a') : '—';
            
            const matchingTicket = ticketsMap.get(record.ticketId);
            const effectiveToUser = (record.toUser && record.toUser.name)
              ? record.toUser
              : (matchingTicket && matchingTicket.departmentId === record.toDepartmentId && matchingTicket.assignedTo?.name
                  ? {
                      userId: matchingTicket.assignedTo.userId,
                      name: matchingTicket.assignedTo.name,
                      avatarUrl: matchingTicket.assignedTo.avatarUrl || '',
                      email: matchingTicket.assignedTo.email || '',
                    }
                  : null);

            return (
              <Card
                key={record.id}
                className="overflow-hidden border-slate-200 hover:border-slate-300 hover:shadow-md transition-all duration-200 group"
              >
                <div className="p-5 space-y-4">
                  {/* Top Bar: Ticket info + Transfer Timestamp */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <Link
                        href={`/tickets/${record.ticketId}`}
                        className="inline-flex items-center gap-1.5 font-black text-blue-900 hover:text-blue-700 text-base group-hover:underline"
                      >
                        <TicketIcon className="h-4 w-4 text-blue-600" />
                        #{record.ticketNumber || record.ticketId.slice(0, 6)}
                      </Link>
                      <span className="font-bold text-slate-900 text-sm md:text-base truncate max-w-md">
                        {record.ticketSubject || record.ticketTitle || t('untitledTicket')}
                      </span>
                      {record.campusName && (
                        <Badge variant="secondary" className="bg-slate-100 text-slate-700 font-semibold text-xs gap-1">
                          <School className="h-3 w-3" />
                          {record.campusName}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                      <Calendar className="h-3.5 w-3.5" />
                      <span>{dateStr}</span>
                    </div>
                  </div>

                  {/* Flow View: PAST -> TICKET -> NOW */}
                  <div className="grid grid-cols-1 md:grid-cols-11 gap-3 items-center">
                    {/* PAST (Source) */}
                    <div className="md:col-span-5 p-3.5 rounded-xl bg-slate-50 border border-slate-100 space-y-2">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 text-slate-500" />
                        {t('previousDepartment')}
                      </div>
                      <div className="font-extrabold text-slate-800 text-sm">
                        {record.fromDepartmentName || t('unspecified')}
                      </div>
                      <div className="flex items-center gap-2 pt-1 border-t border-slate-200/60">
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={record.fromUser?.avatarUrl} />
                          <AvatarFallback className="text-[10px] bg-slate-200 text-slate-700 font-bold">
                            {record.fromUser?.name?.charAt(0) || 'U'}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs text-slate-600 font-medium truncate">
                          {record.fromUser?.name || t('unassigned')}
                        </span>
                      </div>
                    </div>

                    {/* Arrow / Trajectory Connector */}
                    <div className="md:col-span-1 flex flex-col items-center justify-center py-1">
                      <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-700 border border-blue-100 flex items-center justify-center shadow-xs">
                        <ArrowRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
                      </div>
                    </div>

                    {/* NOW (Destination) */}
                    <div className="md:col-span-5 p-3.5 rounded-xl bg-blue-50/50 border border-blue-100/80 space-y-2">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-blue-600 flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 text-blue-600" />
                        {t('currentDepartment')}
                      </div>
                      <div className="font-extrabold text-blue-950 text-sm">
                        {record.toDepartmentName || t('unspecified')}
                      </div>
                      <div className="flex items-center gap-2 pt-1 border-t border-blue-200/60">
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={effectiveToUser?.avatarUrl} />
                          <AvatarFallback className="text-[10px] bg-blue-200 text-blue-800 font-bold">
                            {effectiveToUser?.name?.charAt(0) || 'U'}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs text-blue-900 font-semibold truncate">
                          {effectiveToUser?.name || t('unassigned')}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Notes / Requested by footer */}
                  {(record.notes || record.requestedBy?.name || record.approvedBy?.name) && (
                    <div className="pt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 bg-slate-50/70 p-2.5 rounded-lg border border-slate-100">
                      {record.notes && (
                        <div className="italic text-slate-600 truncate max-w-lg">
                          <span className="font-semibold text-slate-700 not-italic">{t('reason')}: </span>
                          &ldquo;{record.notes}&rdquo;
                        </div>
                      )}
                      <div className="flex items-center gap-3 ms-auto text-[11px] font-medium text-slate-400">
                        {record.requestedBy?.name && (
                          <span>{t('requestedBy')}: <strong className="text-slate-600">{record.requestedBy.name}</strong></span>
                        )}
                        {record.approvedBy?.name && (
                          <span>{t('approvedBy')}: <strong className="text-slate-600">{record.approvedBy.name}</strong></span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

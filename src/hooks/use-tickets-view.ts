'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, query, Timestamp, where, type DocumentData } from 'firebase/firestore';
import { useAuth, useFirestore } from '@/firebase';
import { decodeValue } from '@/firebase/firestore/ticket-fast-store';
import type { StatusCounts, TicketsViewFilters } from '@/lib/tickets-view';

/**
 * Server-paged tickets list: asks /api/tickets/view for the rows of the current page plus
 * the totals, and re-asks whenever any ticket changes (tiny Firestore listeners on
 * ticket_summaries changed since the first response's readTime, and on deletion
 * tombstones), so the list stays as live as a full listener would be.
 *
 * Freshness: the hook remembers the newest commit time it has seen (response readTime or a
 * change delivered by its listeners) and sends it as `minReadTime`; the server re-syncs its
 * snapshot until it is at least that fresh, so a refetch can never return data older than
 * what triggered it, on any server instance.
 *
 * Any failure (HTTP error, timeout, listener error) marks the hook `failed` for its
 * lifetime; the page then falls back to its full-load path.
 */

const FETCH_TIMEOUT_MS = 12_000;
const REFETCH_DEBOUNCE_MS = 400;

export type TicketsViewParams = {
  enabled: boolean;
  filters: TicketsViewFilters;
  status: string;
  page: number;
  pageSize: number;
  /** Changes when the viewer's role/department could have changed (the server re-reads them). */
  profileKey: string | null;
};

export type TicketsViewState<T> = {
  rows: T[] | null;
  totalItems: number;
  statusCounts: StatusCounts | null;
  hasDuplicateTicketNumber: boolean;
  /** Assignees present in the role-filtered set (Assigned-To filter options). */
  assigneeOptions: Array<{ id: string; name: string }> | null;
  /** true until the first response has arrived (page shows its skeleton) */
  isLoading: boolean;
  /** true while a newer page/filter/refresh request is in flight (previous rows stay visible) */
  isFetching: boolean;
  failed: boolean;
};

type Payload = {
  v: number;
  readTime: [number, number];
  totalItems: number;
  statusCounts: StatusCounts;
  hasDuplicateTicketNumber: boolean;
  assigneeOptions?: Array<{ id: string; name: string }>;
  rows: [string, unknown][];
  ids?: Array<[string, string | null]> | null;
};

const INITIAL: TicketsViewState<any> = {
  rows: null, totalItems: 0, statusCounts: null, hasDuplicateTicketNumber: false, assigneeOptions: null, isLoading: true, isFetching: false, failed: false,
};
const DISABLED: TicketsViewState<any> = { ...INITIAL, isLoading: false };

function decodeRows<T>(rows: [string, unknown][]): T[] {
  return rows.map(([id, raw]) => ({ ...(decodeValue(raw) as DocumentData), id }) as T);
}

const tsLess = (a: Timestamp, b: Timestamp) =>
  a.seconds < b.seconds || (a.seconds === b.seconds && a.nanoseconds < b.nanoseconds);
const tsOf = (v: unknown): Timestamp | null => (v instanceof Timestamp ? v : null);

export function useTicketsView<T = any>(params: TicketsViewParams): TicketsViewState<T> & {
  /** Identifies the current request (filters/status/page/profile); null when disabled. */
  requestKey: string | null;
  fetchAllRows: () => Promise<T[]>;
  /** Every filtered+sorted ticket for the current filters as [id, assigneeUserId | null]. */
  fetchOrderedIds: () => Promise<Array<[string, string | null]>>;
} {
  const firestore = useFirestore();
  const auth = useAuth();
  const { enabled, filters, status, page, pageSize, profileKey } = params;
  const [state, setState] = useState<TicketsViewState<T>>(INITIAL);
  const [refreshTick, setRefreshTick] = useState(0);
  // readTime of the first response: the live-change listeners watch everything after it.
  const [listenerBase, setListenerBase] = useState<Timestamp | null>(null);
  // Newest commit time observed (responses + listener changes): the freshness floor.
  const minReadTime = useRef<Timestamp | null>(null);
  const failedRef = useRef(false);
  const inFlight = useRef(false);
  const pendingRefetch = useRef(false);

  const requestKey = enabled ? JSON.stringify({ filters, status, page, pageSize, profileKey }) : null;

  const raiseMin = useCallback((ts: Timestamp | null) => {
    if (ts && (!minReadTime.current || tsLess(minReadTime.current, ts))) minReadTime.current = ts;
  }, []);

  const fail = useCallback((reason: unknown) => {
    if (failedRef.current) return;
    console.warn('[tickets-view] falling back to full load:', (reason as any)?.message || reason);
    failedRef.current = true;
    setState(prev => ({ ...prev, isLoading: false, isFetching: false, failed: true }));
  }, []);

  const post = useCallback(
    async (body: object, signal: AbortSignal): Promise<Payload> => {
      const user = auth.currentUser;
      if (!user) throw new Error('no signed-in user');
      const token = await user.getIdToken();
      const mrt = minReadTime.current;
      const res = await fetch('/api/tickets/view', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...body, minReadTime: mrt ? [mrt.seconds, mrt.nanoseconds] : null }),
        cache: 'no-store',
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as Payload;
      if (payload?.v !== 1 || !Array.isArray(payload.rows) || !Array.isArray(payload.readTime)) {
        throw new Error('bad payload');
      }
      raiseMin(new Timestamp(payload.readTime[0], payload.readTime[1]));
      return payload;
    },
    [auth, raiseMin]
  );

  // Going from disabled to enabled (flag on, SLA filter cleared): start from a clean slate so
  // rows of the previous request are never shown under new parameters.
  const prevKey = useRef<string | null>(null);
  useEffect(() => {
    if (prevKey.current === null && requestKey !== null && !failedRef.current) {
      setState(INITIAL);
    }
    prevKey.current = requestKey;
  }, [requestKey]);

  // Fetch the current page whenever the request changes or a ticket changed.
  useEffect(() => {
    if (!requestKey || failedRef.current) return;
    if (inFlight.current) {
      // A request is already running: run one more when it completes (coalesces bursts).
      pendingRefetch.current = true;
      return;
    }
    const { filters: f, status: s, page: p, pageSize: ps } = JSON.parse(requestKey);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let cancelled = false;
    inFlight.current = true;
    setState(prev => (prev.isFetching ? prev : { ...prev, isFetching: true }));
    post({ filters: f, status: s, page: p, pageSize: ps, mode: 'page' }, ctrl.signal)
      .then(payload => {
        if (cancelled) return;
        setListenerBase(prev => prev ?? new Timestamp(payload.readTime[0], payload.readTime[1]));
        setState({
          rows: decodeRows<T>(payload.rows),
          totalItems: payload.totalItems,
          statusCounts: payload.statusCounts,
          hasDuplicateTicketNumber: payload.hasDuplicateTicketNumber,
          assigneeOptions: payload.assigneeOptions ?? [],
          isLoading: false,
          isFetching: false,
          failed: false,
        });
      })
      .catch(err => {
        if (cancelled) return;
        fail(err);
      })
      .finally(() => {
        clearTimeout(timer);
        inFlight.current = false;
        if (pendingRefetch.current && !cancelled) {
          pendingRefetch.current = false;
          setRefreshTick(t => t + 1);
        }
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [requestKey, refreshTick, post, fail]);

  // Live changes: any summary written or deleted after the base readTime -> refetch (debounced).
  // No fromCache guard: nothing but the server writes these collections (rules: write false),
  // so a change served from the SDK's memory cache is a real, already-committed change.
  useEffect(() => {
    if (!enabled || !listenerBase || failedRef.current) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => setRefreshTick(t => t + 1), REFETCH_DEBOUNCE_MS);
    };
    const unsubA = onSnapshot(
      query(collection(firestore, 'ticket_summaries'), where('_summarySyncedAt', '>=', listenerBase)),
      snap => {
        let changed = false;
        for (const ch of snap.docChanges()) {
          if (ch.type === 'removed') continue;
          raiseMin(tsOf(ch.doc.get('_summarySyncedAt')));
          changed = true;
        }
        if (changed) bump();
      },
      fail
    );
    const unsubB = onSnapshot(
      query(collection(firestore, 'ticket_summaries_deleted'), where('deletedAt', '>=', listenerBase)),
      snap => {
        let changed = false;
        for (const ch of snap.docChanges()) {
          if (ch.type === 'removed') continue;
          raiseMin(tsOf(ch.doc.get('deletedAt')));
          changed = true;
        }
        if (changed) bump();
      },
      fail
    );
    return () => {
      if (debounce) clearTimeout(debounce);
      unsubA();
      unsubB();
    };
  }, [enabled, listenerBase, firestore, raiseMin, fail]);

  // Export: all filtered + sorted rows for the current filters (same server code).
  // A failure here also switches the page to its full-load path, where the legacy export works.
  const fetchAllRows = useCallback(async (): Promise<T[]> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    try {
      const payload = await post({ filters, status, page: 1, pageSize: 50, mode: 'all' }, ctrl.signal);
      return decodeRows<T>(payload.rows);
    } catch (err) {
      fail(err);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }, [post, fail, filters, status]);

  const fetchOrderedIds = useCallback(async (): Promise<Array<[string, string | null]>> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const payload = await post({ filters, status, page: 1, pageSize: 50, mode: 'ids' }, ctrl.signal);
      return Array.isArray(payload.ids) ? payload.ids : [];
    } finally {
      clearTimeout(timer);
    }
  }, [post, filters, status]);

  if (!enabled) return { ...(DISABLED as TicketsViewState<T>), requestKey: null, fetchAllRows, fetchOrderedIds };
  return { ...state, requestKey, fetchAllRows, fetchOrderedIds };
}

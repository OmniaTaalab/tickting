'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Timestamp, type DocumentData } from 'firebase/firestore';
import { useAuth } from '@/firebase';
import { decodeValue } from '@/firebase/firestore/ticket-fast-store';
import { TICKETS_CHANGED_EVENT } from '@/lib/tickets-changed';
import type { StatusCounts, TicketsViewFilters } from '@/lib/tickets-view';

/**
 * Server-paged tickets list: asks /api/tickets/view for the rows of the current page plus
 * the totals. The browser downloads one page (50 rows), never the list.
 *
 * Staying up to date — without a Firestore listener of its own (a listener is billed one
 * document read per changed ticket, per open tab, all day):
 *  - a refresh every POLL_INTERVAL_MS while the tab is visible and online;
 *  - an immediate refresh when the tab becomes visible / regains focus / comes back online;
 *  - an immediate refresh when `liveSignal` changes — the page passes the tickets it already
 *    listens to for the sidebar (the viewer's own active tickets), so a ticket assigned to
 *    the viewer or changed in their active set shows up at once;
 *  - an immediate refresh after an action taken on this page (notifyTicketsChanged()).
 * A second refresh follows the last two a few seconds later, because the server's copy of a
 * ticket trails the change by a moment.
 *
 * Freshness: the hook remembers the newest commit time it has seen (a response's readTime or
 * the live signal's) and sends it as `minReadTime`; the server re-syncs its snapshot until it
 * is at least that fresh, so a refresh never returns data older than what triggered it.
 *
 * Failures: the first request for new parameters failing, or MAX_REFRESH_FAILURES refreshes
 * in a row failing, marks the hook `failed` for its lifetime and the page falls back to its
 * full-load path. A single failed background refresh (a network blip, a laptop waking up)
 * just keeps the rows already on screen and tries again on the next refresh.
 */

// A freshly started server instance needs 10-12 s to load its snapshot before the first
// answer; a 12 s limit made those requests fall back to the full-load path (every ticket
// streamed to the browser). Wait long enough for a cold instance instead.
const FETCH_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 20_000;
/** Waking up (focus / visible / online) refreshes only if the last answer is older than this. */
const WAKE_MIN_GAP_MS = 2_000;
const FOLLOW_UP_MS = 3_000;
const MAX_REFRESH_FAILURES = 3;

export type TicketsViewLiveSignal = {
  /** Changes whenever the tickets the page already listens to changed. */
  key: string;
  /** Newest commit time among those tickets, if known. */
  minReadTime: Timestamp | null;
};

export type TicketsViewParams = {
  enabled: boolean;
  filters: TicketsViewFilters;
  status: string;
  page: number;
  pageSize: number;
  /** Changes when the viewer's role/department could have changed (the server re-reads them). */
  profileKey: string | null;
  liveSignal?: TicketsViewLiveSignal | null;
};

export type TicketsViewState<T> = {
  rows: T[] | null;
  totalItems: number;
  statusCounts: StatusCounts | null;
  hasDuplicateTicketNumber: boolean;
  /** Assignees present in the role-filtered set (Assigned-To filter options). */
  assigneeOptions: Array<{ id: string; name: string }> | null;
  /** Fingerprint of the whole filtered + sorted id list (null: server too old to send one). */
  idsVersion: string | null;
  /** true until the first response has arrived (page shows its skeleton) */
  isLoading: boolean;
  /** true while a request for NEW parameters is in flight (previous rows stay visible, dimmed) */
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
  idsVersion?: string;
};

const INITIAL: TicketsViewState<any> = {
  rows: null, totalItems: 0, statusCounts: null, hasDuplicateTicketNumber: false, assigneeOptions: null, idsVersion: null,
  isLoading: true, isFetching: false, failed: false,
};
const DISABLED: TicketsViewState<any> = { ...INITIAL, isLoading: false };

function decodeRows<T>(rows: [string, unknown][]): T[] {
  return rows.map(([id, raw]) => ({ ...(decodeValue(raw) as DocumentData), id }) as T);
}

const tsLess = (a: Timestamp, b: Timestamp) =>
  a.seconds < b.seconds || (a.seconds === b.seconds && a.nanoseconds < b.nanoseconds);

/** Same content on screen: a refresh that changed nothing must not re-render the list. */
function sameView<T>(a: TicketsViewState<T>, b: TicketsViewState<T>): boolean {
  if (!a.rows || !b.rows || a.rows.length !== b.rows.length) return false;
  for (let i = 0; i < a.rows.length; i++) if (a.rows[i] !== b.rows[i]) return false;
  return (
    a.totalItems === b.totalItems &&
    a.hasDuplicateTicketNumber === b.hasDuplicateTicketNumber &&
    a.idsVersion === b.idsVersion &&
    a.isLoading === b.isLoading && a.isFetching === b.isFetching && a.failed === b.failed &&
    JSON.stringify(a.statusCounts) === JSON.stringify(b.statusCounts) &&
    JSON.stringify(a.assigneeOptions) === JSON.stringify(b.assigneeOptions)
  );
}

export function useTicketsView<T = any>(params: TicketsViewParams): TicketsViewState<T> & {
  /** Identifies the current request (filters/status/page/profile); null when disabled. */
  requestKey: string | null;
  fetchAllRows: () => Promise<T[]>;
  /** Every filtered+sorted ticket for the current filters as [id, assigneeUserId | null], with its fingerprint. */
  fetchOrderedIds: () => Promise<{ ids: Array<[string, string | null]>; version: string | null }>;
  /** Ask the server again now (no-op while disabled or failed). */
  refresh: () => void;
} {
  const auth = useAuth();
  const { enabled, filters, status, page, pageSize, profileKey } = params;
  const liveKey = params.liveSignal?.key ?? null;
  const liveMinReadTime = params.liveSignal?.minReadTime ?? null;
  const [state, setState] = useState<TicketsViewState<T>>(INITIAL);

  const requestKey = enabled ? JSON.stringify({ filters, status, page, pageSize, profileKey }) : null;

  // Newest commit time observed (responses + live signal): the freshness floor.
  const minReadTime = useRef<Timestamp | null>(null);
  const failedRef = useRef(false);
  const disposedRef = useRef(false);
  /** What the page wants now. */
  const keyRef = useRef<string | null>(null);
  /** The request whose rows are in `state`. */
  const loadedKeyRef = useRef<string | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);
  /** Requests dropped on purpose (new parameters, unmount): their outcome is ignored. */
  const droppedRef = useRef(new WeakSet<AbortController>());
  const dropInFlight = () => {
    const ctrl = inFlightRef.current;
    if (!ctrl) return;
    droppedRef.current.add(ctrl);
    inFlightRef.current = null;
    ctrl.abort();
  };
  const pendingRef = useRef(false);
  const failuresRef = useRef(0);
  const lastDoneAtRef = useRef(0);
  // Rows of the previous answer, so an unchanged row keeps its object identity.
  const rowCacheRef = useRef<Map<string, { sig: string; row: T }>>(new Map());
  const profileKeyRef = useRef(profileKey);
  profileKeyRef.current = profileKey;

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
        body: JSON.stringify({
          ...body,
          minReadTime: mrt ? [mrt.seconds, mrt.nanoseconds] : null,
          // lets the server notice that its short-lived copy of the viewer's profile is stale
          profileKey: profileKeyRef.current,
        }),
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

  // One request at a time. A trigger that arrives while a request is running asks for one
  // more when it completes; a request for parameters the page no longer wants is discarded.
  const pumpRef = useRef<() => void>(() => {});
  pumpRef.current = () => {
    if (disposedRef.current || failedRef.current) return;
    const key = keyRef.current;
    if (!key) return;
    if (inFlightRef.current) {
      pendingRef.current = true;
      return;
    }
    pendingRef.current = false;
    const { filters: f, status: s, page: p, pageSize: ps } = JSON.parse(key);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    inFlightRef.current = ctrl;
    // Only a request for NEW parameters dims the list; a background refresh is silent.
    if (loadedKeyRef.current !== key) {
      setState(prev => (prev.isFetching ? prev : { ...prev, isFetching: true }));
    }
    post({ filters: f, status: s, page: p, pageSize: ps, mode: 'page' }, ctrl.signal)
      .then(payload => {
        if (droppedRef.current.has(ctrl) || disposedRef.current || keyRef.current !== key) return; // superseded
        failuresRef.current = 0;
        loadedKeyRef.current = key;
        const previous = rowCacheRef.current;
        const nextCache = new Map<string, { sig: string; row: T }>();
        const rows = payload.rows.map(([id, raw]) => {
          const sig = JSON.stringify(raw);
          const hit = previous.get(id);
          const row = hit && hit.sig === sig ? hit.row : ({ ...(decodeValue(raw) as DocumentData), id } as T);
          nextCache.set(id, { sig, row });
          return row;
        });
        rowCacheRef.current = nextCache;
        const next: TicketsViewState<T> = {
          rows,
          totalItems: payload.totalItems,
          statusCounts: payload.statusCounts,
          hasDuplicateTicketNumber: payload.hasDuplicateTicketNumber,
          assigneeOptions: payload.assigneeOptions ?? [],
          idsVersion: typeof payload.idsVersion === 'string' ? payload.idsVersion : null,
          isLoading: false,
          isFetching: false,
          failed: false,
        };
        setState(prev => (sameView(prev, next) ? prev : next));
      })
      .catch(err => {
        if (droppedRef.current.has(ctrl) || disposedRef.current || keyRef.current !== key) return; // dropped on purpose
        failuresRef.current += 1;
        if (loadedKeyRef.current !== key || failuresRef.current >= MAX_REFRESH_FAILURES) {
          fail(err);
        } else {
          console.warn('[tickets-view] refresh failed, keeping the current rows:', (err as any)?.message || err);
        }
      })
      .finally(() => {
        clearTimeout(timer);
        if (inFlightRef.current !== ctrl) return; // replaced by a newer request
        inFlightRef.current = null;
        lastDoneAtRef.current = Date.now();
        if (!disposedRef.current && (pendingRef.current || keyRef.current !== key)) pumpRef.current();
      });
  };

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      dropInFlight();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Going from disabled to enabled (flag on, SLA filter cleared): start from a clean slate so
  // rows of the previous request are never shown under new parameters.
  const prevKey = useRef<string | null>(null);
  useEffect(() => {
    if (prevKey.current === null && requestKey !== null && !failedRef.current) {
      loadedKeyRef.current = null;
      rowCacheRef.current = new Map();
      setState(INITIAL);
    }
    prevKey.current = requestKey;
  }, [requestKey]);

  // New parameters (filters / status tab / page / profile): ask for them right away.
  useEffect(() => {
    keyRef.current = requestKey;
    // whatever is running was for other parameters (or the view was just disabled)
    dropInFlight();
    pendingRef.current = false;
    if (failedRef.current) return;
    if (!requestKey) {
      // Disabled (flag off, SLA filter on): forget the rows now, so that when the view is
      // enabled again not even one frame shows rows that belong to the earlier request.
      loadedKeyRef.current = null;
      rowCacheRef.current = new Map();
      setState(INITIAL);
      return;
    }
    pumpRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  // Timer, wake-up and "this page changed tickets" refreshes.
  useEffect(() => {
    if (!enabled) return;
    const isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
    const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
    let followUp: ReturnType<typeof setTimeout> | null = null;
    const interval = setInterval(() => {
      if (isVisible() && isOnline()) pumpRef.current();
    }, POLL_INTERVAL_MS);
    const onWake = () => {
      if (isVisible() && isOnline() && Date.now() - lastDoneAtRef.current > WAKE_MIN_GAP_MS) pumpRef.current();
    };
    const onTicketsChanged = () => {
      pumpRef.current();
      if (followUp) clearTimeout(followUp);
      followUp = setTimeout(() => pumpRef.current(), FOLLOW_UP_MS);
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('online', onWake);
    window.addEventListener(TICKETS_CHANGED_EVENT, onTicketsChanged);
    return () => {
      clearInterval(interval);
      if (followUp) clearTimeout(followUp);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('online', onWake);
      window.removeEventListener(TICKETS_CHANGED_EVENT, onTicketsChanged);
    };
  }, [enabled]);

  // The tickets the page already listens to changed: refresh now, and once more shortly after.
  const lastLiveKey = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || liveKey === null) return;
    raiseMin(liveMinReadTime);
    if (lastLiveKey.current === null) {
      lastLiveKey.current = liveKey; // first value: the starting state, not a change
      return;
    }
    if (lastLiveKey.current === liveKey) return;
    lastLiveKey.current = liveKey;
    pumpRef.current();
    const timer = setTimeout(() => pumpRef.current(), FOLLOW_UP_MS);
    return () => clearTimeout(timer);
  }, [enabled, liveKey, liveMinReadTime, raiseMin]);

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

  const fetchOrderedIds = useCallback(async (): Promise<{ ids: Array<[string, string | null]>; version: string | null }> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const payload = await post({ filters, status, page: 1, pageSize: 50, mode: 'ids' }, ctrl.signal);
      return {
        ids: Array.isArray(payload.ids) ? payload.ids : [],
        version: typeof payload.idsVersion === 'string' ? payload.idsVersion : null,
      };
    } finally {
      clearTimeout(timer);
    }
  }, [post, filters, status]);

  const refresh = useCallback(() => pumpRef.current(), []);

  if (!enabled) return { ...(DISABLED as TicketsViewState<T>), requestKey: null, fetchAllRows, fetchOrderedIds, refresh };
  return { ...state, requestKey, fetchAllRows, fetchOrderedIds, refresh };
}

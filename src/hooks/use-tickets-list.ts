'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  and,
  collection,
  doc,
  onSnapshot,
  or,
  query,
  where,
  type Firestore,
  type Query,
} from 'firebase/firestore';
import { useAuth, useFirestore, useMemoFirebase, useCollection, useUser } from '@/firebase';
import type { UseCollectionResult } from '@/firebase/firestore/use-collection';
import { ACTIVE_STATUSES, scopeKey, type TicketScope } from '@/lib/ticket-scope';
import { clearTicketKeepAlive, keepTicketQueryAlive } from '@/firebase/firestore/ticket-keepalive';
import { getTicketFastStore, type FastStoreState } from '@/firebase/firestore/ticket-fast-store';

/**
 * Live kill switch: settings/ticketSummaries { enabled: true }.
 * - Missing doc / enabled !== true / any read error  => false (today's exact queries on `tickets`).
 * - Flipping it in the Firestore console switches every open browser immediately.
 * Returns undefined until the first answer arrives (pages show their skeleton meanwhile).
 */
export type TicketFlags = {
  enabled: boolean;
  fastLoad: boolean;
  fastLoadUids: string[];
  /** Server-paged tickets list (/api/tickets/view), everyone or an allowlist of uids. */
  pagedTickets: boolean;
  pagedTicketsUids: string[];
};
const FLAGS_OFF: TicketFlags = { enabled: false, fastLoad: false, fastLoadUids: [], pagedTickets: false, pagedTicketsUids: [] };
const sameFlags = (a: TicketFlags, b: TicketFlags) =>
  a.enabled === b.enabled && a.fastLoad === b.fastLoad && a.fastLoadUids.join('|') === b.fastLoadUids.join('|') &&
  a.pagedTickets === b.pagedTickets && a.pagedTicketsUids.join('|') === b.pagedTicketsUids.join('|');
const uidList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((u: unknown): u is string => typeof u === 'string') : []);
let flagCache: TicketFlags | undefined;
const flagSubscribers = new Set<(v: TicketFlags) => void>();
let flagUnsubscribe: (() => void) | null = null;

function subscribeFlag(firestore: Firestore, cb: (v: TicketFlags) => void): () => void {
  flagSubscribers.add(cb);
  if (!flagUnsubscribe) {
    flagUnsubscribe = onSnapshot(
      doc(firestore, 'settings', 'ticketSummaries'),
      snap => {
        const d = snap.exists() ? snap.data() : undefined;
        const enabled = d?.enabled === true;
        // fastLoad / fastLoadUids (staged rollout allowlist) only apply on top of enabled summaries.
        const next: TicketFlags = {
          enabled,
          fastLoad: enabled && d?.fastLoad === true,
          fastLoadUids: enabled ? uidList(d?.fastLoadUids) : [],
          pagedTickets: enabled && d?.pagedTickets === true,
          pagedTicketsUids: enabled ? uidList(d?.pagedTicketsUids) : [],
        };
        if (!flagCache || !sameFlags(flagCache, next)) {
          const prev = flagCache;
          if (!next.enabled) clearTicketKeepAlive();
          else if (!prev || !sameFlags(prev, next)) {
            // Fast load (re)configured: drop background summary listeners so they don't
            // compete with the fast path; drop fast stores of users who are no longer included.
            clearTicketKeepAlive();
          }
          flagCache = next;
          flagSubscribers.forEach(fn => fn(next));
        }
      },
      () => {
        flagCache = FLAGS_OFF;
        clearTicketKeepAlive();
        flagSubscribers.forEach(fn => fn(FLAGS_OFF));
      }
    );
  }
  return () => {
    flagSubscribers.delete(cb);
  };
}

/**
 * settings/ticketSummaries { enabled, fastLoad, fastLoadUids, pagedTickets, pagedTicketsUids }
 * — all live kill switches. undefined until the first answer arrives.
 */
export function useTicketFlags(): TicketFlags | undefined {
  const firestore = useFirestore();
  const [flags, setFlags] = useState<TicketFlags | undefined>(flagCache);
  useEffect(() => {
    if (flagCache !== undefined) setFlags(flagCache);
    return subscribeFlag(firestore, setFlags);
  }, [firestore]);
  return flags;
}

const NO_FAST_STATE: FastStoreState<any> = { data: null, failed: false };
const noopSubscribe = () => () => {};

const ACTIVE = [...ACTIVE_STATUSES];

function buildSummaryQuery(firestore: Firestore, scope: TicketScope): Query {
  const col = collection(firestore, 'ticket_summaries');
  switch (scope.kind) {
    case 'all':
      return query(col);
    case 'statusIn':
      return query(col, where('status', 'in', ACTIVE));
    case 'deptStatusIn':
      return query(col, and(where('departmentId', '==', scope.dept), where('status', 'in', ACTIVE)));
    case 'assignedStatusIn':
      return query(col, and(where('assignedTo.userId', '==', scope.uid), where('status', 'in', ACTIVE)));
    case 'dept':
      return query(col, where('departmentId', '==', scope.dept));
    case 'assignedOrDept':
      return query(col, or(where('assignedTo.userId', '==', scope.uid), where('departmentId', '==', scope.dept)));
  }
}

const IDLE: UseCollectionResult<any> = { data: null, isLoading: false, error: null };
const WAITING: UseCollectionResult<any> = { data: null, isLoading: true, error: null };

/**
 * Drop-in replacement for the pages' `useCollection(query(collection(firestore, 'tickets')))`.
 *
 * @param scope  null while the page's own gate is not satisfied (same as passing a null
 *               query today). Otherwise the superset scope for this page (see ticket-scope.ts).
 * @param opts.keepAlive  keep this scope's listener for the session (heavy list pages).
 *
 * When the kill switch is OFF this subscribes to exactly the same full `tickets`
 * query as before, so behaviour is identical to the previous release.
 */
export function useTicketsList<T = any>(
  scope: TicketScope | null,
  opts: { keepAlive?: boolean } = {}
): UseCollectionResult<T> {
  const firestore = useFirestore();
  const auth = useAuth();
  const { user } = useUser();
  const flags = useTicketFlags();
  const enabled = flags === undefined ? undefined : flags.enabled;
  const key = scope ? scopeKey(scope) : null;
  const wantKeepAlive = opts.keepAlive === true;
  const uid = user?.uid ?? null;

  // Fast path (flags.fastLoad): one compressed snapshot + incremental live changes.
  const fastForMe = !!(flags?.enabled && uid && (flags.fastLoad || flags.fastLoadUids.includes(uid)));
  const fastStore = useMemo(
    () => (key !== null && scope && uid && fastForMe ? getTicketFastStore(firestore, auth, scope, uid) : null),
    // scope is fully described by its key; flags object identity changes on any flag change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [firestore, auth, key, uid, fastForMe, flags]
  );
  const subscribeFast = useCallback(
    (fn: () => void) => (fastStore ? fastStore.subscribe(fn) : noopSubscribe()),
    [fastStore]
  );
  const getFast = useCallback(() => (fastStore ? fastStore.getState() : NO_FAST_STATE), [fastStore]);
  const fastState = useSyncExternalStore(subscribeFast, getFast, () => NO_FAST_STATE);
  const useFast = fastStore !== null && !fastState.failed;

  // Legacy path: identical to the previous code (full tickets collection).
  const legacyQuery = useMemoFirebase(
    () => (key !== null && enabled === false ? query(collection(firestore, 'tickets')) : null),
    [firestore, key !== null, enabled]
  );
  // Summary path.
  // (also the automatic fallback when the fast path fails)
  const summaryQuery = useMemoFirebase(
    () => (key !== null && scope && enabled === true && !useFast ? buildSummaryQuery(firestore, scope) : null),
    // scope is fully described by its key
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [firestore, key, enabled, useFast]
  );

  const legacy = useCollection<T>(legacyQuery, { reuseUnchangedDocs: true });
  const summaries = useCollection<T>(summaryQuery, { reuseUnchangedDocs: true });

  useEffect(() => {
    if (!wantKeepAlive || !summaryQuery || !key || !uid) return;
    keepTicketQueryAlive(key, summaryQuery, uid);
  }, [wantKeepAlive, summaryQuery, key, uid]);

  if (key === null) return IDLE as UseCollectionResult<T>;
  if (enabled === undefined) return WAITING as UseCollectionResult<T>;
  if (useFast) {
    return fastState.data === null
      ? (WAITING as UseCollectionResult<T>)
      : ({ data: fastState.data, isLoading: false, error: null } as UseCollectionResult<T>);
  }
  const res = enabled ? summaries : legacy;
  // useCollection only flips isLoading=true inside its effect, so in the render where a
  // query is first created it reports {data:null, isLoading:false}. Report that as loading
  // so pages keep their skeleton instead of painting zero counts for a frame.
  if (res.data === null && res.error === null) return { ...res, isLoading: true };
  return res;
}

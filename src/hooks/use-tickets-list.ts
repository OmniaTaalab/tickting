'use client';

import { useEffect, useState } from 'react';
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
import { useFirestore, useMemoFirebase, useCollection, useUser } from '@/firebase';
import type { UseCollectionResult } from '@/firebase/firestore/use-collection';
import { ACTIVE_STATUSES, scopeKey, type TicketScope } from '@/lib/ticket-scope';
import { clearTicketKeepAlive, keepTicketQueryAlive } from '@/firebase/firestore/ticket-keepalive';

/**
 * Live kill switch: settings/ticketSummaries { enabled: true }.
 * - Missing doc / enabled !== true / any read error  => false (today's exact queries on `tickets`).
 * - Flipping it in the Firestore console switches every open browser immediately.
 * Returns undefined until the first answer arrives (pages show their skeleton meanwhile).
 */
let flagCache: boolean | undefined;
const flagSubscribers = new Set<(v: boolean) => void>();
let flagUnsubscribe: (() => void) | null = null;

function subscribeFlag(firestore: Firestore, cb: (v: boolean) => void): () => void {
  flagSubscribers.add(cb);
  if (!flagUnsubscribe) {
    flagUnsubscribe = onSnapshot(
      doc(firestore, 'settings', 'ticketSummaries'),
      snap => {
        flagCache = snap.exists() && snap.data()?.enabled === true;
        if (!flagCache) clearTicketKeepAlive();
        flagSubscribers.forEach(fn => fn(flagCache as boolean));
      },
      () => {
        flagCache = false;
        clearTicketKeepAlive();
        flagSubscribers.forEach(fn => fn(false));
      }
    );
  }
  return () => {
    flagSubscribers.delete(cb);
  };
}

export function useTicketSummariesEnabled(): boolean | undefined {
  const firestore = useFirestore();
  const [enabled, setEnabled] = useState<boolean | undefined>(flagCache);
  useEffect(() => {
    if (flagCache !== undefined) setEnabled(flagCache);
    return subscribeFlag(firestore, setEnabled);
  }, [firestore]);
  return enabled;
}

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
  const { user } = useUser();
  const enabled = useTicketSummariesEnabled();
  const key = scope ? scopeKey(scope) : null;
  const wantKeepAlive = opts.keepAlive === true;

  // Legacy path: identical to the previous code (full tickets collection).
  const legacyQuery = useMemoFirebase(
    () => (key !== null && enabled === false ? query(collection(firestore, 'tickets')) : null),
    [firestore, key !== null, enabled]
  );
  // Summary path.
  const summaryQuery = useMemoFirebase(
    () => (key !== null && scope && enabled === true ? buildSummaryQuery(firestore, scope) : null),
    // scope is fully described by its key
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [firestore, key, enabled]
  );

  const legacy = useCollection<T>(legacyQuery, { reuseUnchangedDocs: true });
  const summaries = useCollection<T>(summaryQuery, { reuseUnchangedDocs: true });

  const uid = user?.uid ?? null;
  useEffect(() => {
    if (!wantKeepAlive || !summaryQuery || !key || !uid) return;
    keepTicketQueryAlive(key, summaryQuery, uid);
  }, [wantKeepAlive, summaryQuery, key, uid]);

  if (key === null) return IDLE as UseCollectionResult<T>;
  if (enabled === undefined) return WAITING as UseCollectionResult<T>;
  const res = enabled ? summaries : legacy;
  // useCollection only flips isLoading=true inside its effect, so in the render where a
  // query is first created it reports {data:null, isLoading:false}. Report that as loading
  // so pages keep their skeleton instead of painting zero counts for a frame.
  if (res.data === null && res.error === null) return { ...res, isLoading: true };
  return res;
}

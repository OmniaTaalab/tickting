'use client';

import { useEffect, useRef, useState } from 'react';
import type { DocumentData } from 'firebase/firestore';
import { useAuth } from '@/firebase';
import { decodeValue } from '@/firebase/firestore/ticket-fast-store';
import { scopeKey, type TicketScope } from '@/lib/ticket-scope';
import type { TicketProjection } from '@/lib/ticket-projections';
import { TICKETS_CHANGED_EVENT } from '@/lib/tickets-changed';

/**
 * A scope's tickets (only the fields of `projection`) taken from the server's in-memory copy
 * of ticket_summaries and asked for again on a timer — no Firestore listener.
 *
 * For counters that need many tickets but only a few fields of each (the sidebar of an
 * admin counts ~5,600 active tickets): a Firestore listener costs one document read per
 * ticket on every tab, plus one per change for as long as the tab is open. This costs
 * none: one compressed response from /api/ticket-summaries (the endpoint the fast-load
 * path already uses), refreshed every POLL_INTERVAL_MS while the tab is visible, when the
 * tab is shown again, and right after an action in this tab (notifyTicketsChanged()).
 *
 * Rows have the same shape a listener gives ({ ...fields, id }, Timestamps decoded), in
 * document-id order. Treat them as immutable.
 *
 * The first load failing, or MAX_REFRESH_FAILURES refreshes in a row failing, reports
 * `failed` for the hook's lifetime: the caller then uses its normal listener instead.
 */

const FETCH_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 60_000;
const WAKE_MIN_GAP_MS = 5_000;
const FOLLOW_UP_MS = 3_000;
const MAX_REFRESH_FAILURES = 3;

export type TicketsPolledState<T> = { data: (T & { id: string })[] | null; failed: boolean };

const EMPTY: TicketsPolledState<any> = { data: null, failed: false };

export function useTicketsPolled<T = any>(
  scope: TicketScope | null,
  projection: TicketProjection
): TicketsPolledState<T> {
  const auth = useAuth();
  const key = scope ? `${scopeKey(scope)}|${projection}` : null;
  const [state, setState] = useState<{ key: string | null } & TicketsPolledState<T>>({ key: null, ...EMPTY });
  // The scope object is rebuilt on every render; the effect below depends on its key only.
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  useEffect(() => {
    if (!key) return;
    let disposed = false;
    let failed = false;
    let loaded = false;
    let failures = 0;
    let inFlight: AbortController | null = null;
    let pending = false;
    let lastDoneAt = 0;
    let followUp: ReturnType<typeof setTimeout> | null = null;

    const load = () => {
      if (disposed || failed) return;
      if (inFlight) {
        pending = true;
        return;
      }
      pending = false;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      inFlight = ctrl;
      (async () => {
        const user = auth.currentUser;
        if (!user) throw new Error('no signed-in user');
        const token = await user.getIdToken();
        const res = await fetch('/api/ticket-summaries', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ scope: scopeRef.current, projection }),
          cache: 'no-store',
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        if (payload?.v !== 1 || !Array.isArray(payload.rows)) throw new Error('bad payload');
        return (payload.rows as [string, unknown][]).map(([id, raw]) => ({ ...(decodeValue(raw) as DocumentData), id }) as T & { id: string });
      })()
        .then(rows => {
          if (disposed) return;
          failures = 0;
          loaded = true;
          setState({ key, data: rows, failed: false });
        })
        .catch(err => {
          if (disposed) return;
          failures += 1;
          if (!loaded || failures >= MAX_REFRESH_FAILURES) {
            failed = true;
            console.warn('[tickets-polled] falling back to the listener:', err?.message || err);
            setState({ key, data: null, failed: true });
          } else {
            console.warn('[tickets-polled] refresh failed, keeping the current rows:', err?.message || err);
          }
        })
        .finally(() => {
          clearTimeout(timer);
          if (inFlight === ctrl) inFlight = null;
          lastDoneAt = Date.now();
          if (!disposed && pending) load();
        });
    };

    const isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
    const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
    const interval = setInterval(() => {
      if (isVisible() && isOnline()) load();
    }, POLL_INTERVAL_MS);
    const onWake = () => {
      if (isVisible() && isOnline() && Date.now() - lastDoneAt > WAKE_MIN_GAP_MS) load();
    };
    const onTicketsChanged = () => {
      load();
      if (followUp) clearTimeout(followUp);
      followUp = setTimeout(load, FOLLOW_UP_MS);
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('online', onWake);
    window.addEventListener(TICKETS_CHANGED_EVENT, onTicketsChanged);
    load();

    return () => {
      disposed = true;
      clearInterval(interval);
      if (followUp) clearTimeout(followUp);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('online', onWake);
      window.removeEventListener(TICKETS_CHANGED_EVENT, onTicketsChanged);
      // AbortController is read through a function so the latest one is aborted
      const running = inFlight as AbortController | null;
      if (running) running.abort();
    };
  }, [auth, key, projection]);

  // Rows of another scope (the key just changed) are never returned.
  if (!key || state.key !== key) return EMPTY as TicketsPolledState<T>;
  return state;
}

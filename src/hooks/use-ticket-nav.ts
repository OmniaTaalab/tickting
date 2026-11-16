'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/firebase';

/**
 * Previous / Next for the ticket page, asked from the server (/api/tickets/nav) instead of
 * loading a list of tickets into the browser to find two neighbours.
 *
 * - `listOrder` set (the ticket was opened from the tickets list): the ids just before and
 *   just after the ticket in that order are sent; the server returns the nearest ones the
 *   viewer can still see. If the ticket is not in that order there is nothing to ask: the
 *   page shows no buttons, exactly as before.
 * - `listOrder` null: the server uses "created date, newest first" over the viewer's tickets.
 *
 * Any failure reports `failed`; the page then falls back to loading its (scoped) list.
 */

const FETCH_TIMEOUT_MS = 30_000;
/** Ids sent on each side of the ticket from the captured list order. */
const NAV_WINDOW = 150;

export type TicketNavState = {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  /** false: the viewer cannot navigate from this ticket (no buttons). */
  visible: boolean;
  prev: string | null;
  next: string | null;
};

const IDLE: TicketNavState = { status: 'idle', visible: false, prev: null, next: null };
const LOADING: TicketNavState = { status: 'loading', visible: false, prev: null, next: null };
const FAILED: TicketNavState = { status: 'failed', visible: false, prev: null, next: null };
const NOT_IN_LIST: TicketNavState = { status: 'ready', visible: false, prev: null, next: null };

export function useTicketNav(params: {
  enabled: boolean;
  ticketId: string;
  /** The order captured by the tickets list, or null when the ticket was opened directly. */
  listOrder: string[] | null;
  /** role|category|campuses as the page sees them (lets the server refresh its cached profile). */
  profileKey: string | null;
}): TicketNavState {
  const auth = useAuth();
  const { enabled, ticketId, listOrder, profileKey } = params;
  const [state, setState] = useState<TicketNavState>(IDLE);

  useEffect(() => {
    if (!enabled || !ticketId) {
      setState(IDLE);
      return;
    }
    let before: string[] | null = null;
    let after: string[] | null = null;
    if (listOrder) {
      const index = listOrder.indexOf(ticketId);
      if (index === -1) {
        setState(NOT_IN_LIST);
        return;
      }
      before = listOrder.slice(Math.max(0, index - NAV_WINDOW), index);
      after = listOrder.slice(index + 1, index + 1 + NAV_WINDOW);
    }

    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    setState(LOADING);
    (async () => {
      const user = auth.currentUser;
      if (!user) throw new Error('no signed-in user');
      const token = await user.getIdToken();
      const res = await fetch('/api/tickets/nav', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ ticketId, before, after, profileKey }),
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      if (payload?.v !== 1 || typeof payload.visible !== 'boolean') throw new Error('bad payload');
      const idOrNull = (x: unknown) => (typeof x === 'string' && x.length > 0 ? x : null);
      return { status: 'ready', visible: payload.visible, prev: idOrNull(payload.prev), next: idOrNull(payload.next) } as TicketNavState;
    })()
      .then(next => {
        if (!cancelled) setState(next);
      })
      .catch(err => {
        if (cancelled) return;
        console.warn('[ticket-nav] falling back to the list:', err?.message || err);
        setState(FAILED);
      })
      .finally(() => clearTimeout(timer));

    return () => {
      cancelled = true;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [auth, enabled, ticketId, listOrder, profileKey]);

  return enabled ? state : IDLE;
}

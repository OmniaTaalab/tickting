'use client';

import { onSnapshot, type Query } from 'firebase/firestore';
import { clearTicketFastStores } from '@/firebase/firestore/ticket-fast-store';

/**
 * Keep-alive registry for heavy ticket-list listeners.
 *
 * Once a list scope has been loaded, one listener on it is kept for the rest of the
 * session so navigating between list pages is served from the Firestore SDK's
 * in-memory cache (the role the sidebar's always-on full-tickets listener used to
 * play). Cleared on sign-out / user change / kill switch off.
 */
const keepAlive = new Map<string, () => void>();
let keepAliveOwner: string | null = null;

/** Stop only the background summary listeners (used when fast load takes over). */
export function clearSummaryKeepAlive() {
  keepAlive.forEach(unsub => unsub());
  keepAlive.clear();
  keepAliveOwner = null;
}

/** Stop everything (sign-out, user switch, kill switch off). */
export function clearTicketKeepAlive() {
  clearSummaryKeepAlive();
  clearTicketFastStores();
}

export function keepTicketQueryAlive(key: string, q: Query, uid: string) {
  if (keepAliveOwner !== uid) {
    // Only this registry's listeners; never dispose fast stores from here (they track
    // their own owner and are cleared on sign-out / flag changes).
    clearSummaryKeepAlive();
    keepAliveOwner = uid;
  }
  if (keepAlive.has(key)) return;
  const unsub = onSnapshot(
    q,
    () => {},
    () => {
      keepAlive.delete(key);
    }
  );
  keepAlive.set(key, unsub);
}

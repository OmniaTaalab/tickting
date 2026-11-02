'use client';

import { onSnapshot, type Query } from 'firebase/firestore';

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

export function clearTicketKeepAlive() {
  keepAlive.forEach(unsub => unsub());
  keepAlive.clear();
  keepAliveOwner = null;
}

export function keepTicketQueryAlive(key: string, q: Query, uid: string) {
  if (keepAliveOwner !== uid) {
    clearTicketKeepAlive();
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

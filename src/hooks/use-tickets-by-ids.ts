'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, documentId, onSnapshot, query, where } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import { useTicketFlags } from '@/hooks/use-tickets-list';

/**
 * Collection for small, fixed ticket queries made by list-type pages (counts, a user's own
 * tickets, a handful of known ids): the lightweight ticket_summaries mirror, or `tickets`
 * itself while the kill switch (settings/ticketSummaries.enabled) is off — the same rule
 * useTicketsList follows. undefined until the switch is known.
 */
export function useTicketListCollectionName(): 'tickets' | 'ticket_summaries' | undefined {
  const flags = useTicketFlags();
  return flags === undefined ? undefined : flags.enabled ? 'ticket_summaries' : 'tickets';
}

/** Firestore allows at most 30 values in an `in` filter. */
const IDS_PER_QUERY = 30;
/** Above this many ids a page should load its list scope instead (see MAX_TICKETS_BY_IDS users). */
export const MAX_TICKETS_BY_IDS = 900;

const SEPARATOR = '\u0001';

/**
 * Live tickets for a known, small set of ids (one listener per 30 ids), keyed by id.
 * For pages that need a few fields of specific tickets — instead of subscribing to every
 * ticket in the system to look a few of them up.
 *
 * @param ids  ticket ids (any order, duplicates allowed), or null to load nothing.
 * Tickets that do not exist are simply absent from the map, as they would be absent from a
 * full list. Treat the returned items as immutable.
 */
export function useTicketsByIds<T = any>(ids: readonly string[] | null): Map<string, T & { id: string }> {
  const firestore = useFirestore();
  const collectionName = useTicketListCollectionName();
  // Canonical key: the effect below depends on the id SET, not on the array's identity.
  const key = useMemo(() => {
    if (!ids) return null;
    const unique = Array.from(new Set(ids.filter(id => typeof id === 'string' && id.length > 0 && !id.includes('/')))).sort();
    return unique.length ? unique.join(SEPARATOR) : null;
  }, [ids]);

  const [chunks, setChunks] = useState<{ key: string | null; rows: Record<number, Array<T & { id: string }>> }>({ key: null, rows: {} });

  useEffect(() => {
    if (!collectionName || !key) return;
    const list = key.split(SEPARATOR);
    const subscriptionKey = `${collectionName}|${key}`;
    const unsubs: Array<() => void> = [];
    for (let start = 0; start < list.length; start += IDS_PER_QUERY) {
      const index = start / IDS_PER_QUERY;
      const chunk = list.slice(start, start + IDS_PER_QUERY);
      unsubs.push(
        onSnapshot(
          query(collection(firestore, collectionName), where(documentId(), 'in', chunk)),
          snap => {
            const rows = snap.docs.map(d => ({ ...(d.data() as T), id: d.id }));
            setChunks(prev => ({
              key: subscriptionKey,
              // rows of a previous id set are dropped as soon as the new set delivers
              rows: { ...(prev.key === subscriptionKey ? prev.rows : {}), [index]: rows },
            }));
          },
          err => console.warn('[tickets-by-ids] listener failed:', err?.message || err)
        )
      );
    }
    return () => unsubs.forEach(unsub => unsub());
  }, [firestore, collectionName, key]);

  return useMemo(() => {
    const map = new Map<string, T & { id: string }>();
    // Only rows that belong to the CURRENT id set / collection.
    if (!collectionName || !key || chunks.key !== `${collectionName}|${key}`) return map;
    for (const rows of Object.values(chunks.rows)) for (const row of rows) map.set(row.id, row);
    return map;
  }, [chunks, collectionName, key]);
}

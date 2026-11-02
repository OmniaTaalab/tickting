'use client';

import {
  collection,
  onSnapshot,
  query,
  Timestamp,
  where,
  type Firestore,
  type DocumentData,
} from 'firebase/firestore';
import type { Auth } from 'firebase/auth';
import {
  compareDocIds,
  inTicketScope,
  scopeKey,
  TIMESTAMP_MARKER,
  type TicketScope,
} from '@/lib/ticket-scope';

/**
 * Fast-load store for one ticket list scope.
 *
 * 1. Fetches the scope's ticket_summaries as ONE gzip response from /api/ticket-summaries
 *    (snapshot "as of readTime"), decoding values exactly as doc.data() would return them.
 * 2. Subscribes only to summaries changed at/after readTime (_summarySyncedAt >= readTime)
 *    and to deletion tombstones (ticket_summaries_deleted.deletedAt >= readTime), applying
 *    them in timestamp order per ticket. Same live behaviour as a normal listener, without
 *    re-streaming every document.
 *
 * Emits arrays of `{...data, id}` in Firestore document-id order — the same shape and order
 * useCollection produces. Unchanged ticket objects keep their identity between emissions.
 * Treat items as immutable.
 *
 * Stores live for the session (navigation between list pages is instant); they are
 * cleared on sign-out / kill switch. Any failure marks the store failed so the caller
 * falls back to the regular Firestore listener path.
 */

const SYNCED_AT_FIELD = '_summarySyncedAt';
const FETCH_TIMEOUT_MS = 12_000;
const READY_TIMEOUT_MS = 20_000;

export type FastStoreState<T> = { data: (T & { id: string })[] | null; failed: boolean };
type Subscriber = () => void;

type TsKey = [number, number];
function tsKeyOf(v: unknown): TsKey | null {
  if (v instanceof Timestamp) return [v.seconds, v.nanoseconds];
  return null;
}
function tsLess(a: TsKey, b: TsKey) {
  return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
}

export function decodeValue(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(decodeValue);
  const keys = Object.keys(v as object);
  if (keys.length === 1 && keys[0] === TIMESTAMP_MARKER) {
    const [s, n] = (v as Record<string, [number, number]>)[TIMESTAMP_MARKER];
    return new Timestamp(s, n);
  }
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = decodeValue((v as Record<string, unknown>)[k]);
  return out;
}

class TicketFastStore {
  private state: FastStoreState<any> = { data: null, failed: false };
  private subscribers = new Set<Subscriber>();
  private byId = new Map<string, any>();
  private lastApplied = new Map<string, TsKey>();
  private ids: string[] = [];
  private unsubs: Array<() => void> = [];
  private disposed = false;

  constructor(
    private firestore: Firestore,
    private auth: Auth,
    private scope: TicketScope
  ) {
    this.load().catch(err => {
      console.warn('[ticket-fast-store] fast load failed, falling back to listener:', err?.message || err);
      this.fail();
    });
  }

  getState() {
    return this.state;
  }

  subscribe(fn: Subscriber) {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  dispose() {
    this.disposed = true;
    this.unsubs.forEach(u => u());
    this.unsubs = [];
  }

  // First emit only after: snapshot body applied AND both delta listeners have delivered
  // a server (non-cache) snapshot, with their changes applied. So the first visible state is
  // never older than a normal listener's first snapshot would be.
  private ready = false;
  private bodyApplied = false;
  private summariesSynced = false;
  private tombstonesSynced = false;
  private buffered: Array<() => void> = [];

  private maybeReady() {
    if (!this.ready && this.bodyApplied && this.summariesSynced && this.tombstonesSynced) {
      this.ready = true;
      this.emit();
    }
  }

  private emit() {
    if (this.disposed || this.state.failed || !this.ready) return;
    this.state = { data: this.ids.map(id => this.byId.get(id)), failed: false };
    this.subscribers.forEach(fn => fn());
  }

  /** Terminal: stop listening and tell subscribers to use the regular listener path. */
  private fail() {
    if (this.disposed || this.state.failed) return;
    this.unsubs.forEach(u => u());
    this.unsubs = [];
    this.state = { data: null, failed: true };
    this.subscribers.forEach(fn => fn());
  }

  private async load() {
    const user = this.auth.currentUser;
    if (!user) throw new Error('no signed-in user');

    // Overall deadline for the first emit; on expiry fall back to the listener path.
    const readyTimer = setTimeout(() => {
      if (!this.ready) {
        console.warn('[ticket-fast-store] not ready in time, falling back');
        this.fail();
      }
    }, READY_TIMEOUT_MS);
    this.unsubs.push(() => clearTimeout(readyTimer));

    const token = await user.getIdToken();
    const ctrl = new AbortController();
    const fetchTimer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch('/api/ticket-summaries', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ scope: this.scope }),
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const header = res.headers.get('x-read-time') || '';
      const m = /^(-?\d+)\.(\d+)$/.exec(header);
      if (!m) throw new Error('missing x-read-time');
      const readTime = new Timestamp(Number(m[1]), Number(m[2]));
      if (this.disposed || this.state.failed) return;

      // Start the delta listeners now (in parallel with the body download).
      this.startDeltas(readTime);

      const payload = await res.json();
      if (
        payload?.v !== 1 || !Array.isArray(payload.rows) || !Array.isArray(payload.readTime) ||
        payload.readTime[0] !== readTime.seconds || payload.readTime[1] !== readTime.nanoseconds
      ) {
        throw new Error('bad payload');
      }
      if (this.disposed || this.state.failed) return;

      for (const [id, raw] of payload.rows as [string, unknown][]) {
        const data = decodeValue(raw) as DocumentData;
        this.byId.set(id, { ...data, id });
        const ts = tsKeyOf(data[SYNCED_AT_FIELD]);
        if (ts) this.lastApplied.set(id, ts);
        this.ids.push(id);
      }
      // Server already sorts; keep the invariant regardless.
      this.ids.sort(compareDocIds);
      this.bodyApplied = true;
      const pending = this.buffered;
      this.buffered = [];
      pending.forEach(apply => apply());
      this.maybeReady();
    } finally {
      clearTimeout(fetchTimer);
    }
  }

  /** Live changes from the snapshot point on; buffered until the snapshot body is applied. */
  private startDeltas(readTime: Timestamp) {
    const run = (apply: () => void) => {
      if (this.bodyApplied) apply();
      else this.buffered.push(apply);
    };
    this.unsubs.push(
      onSnapshot(
        query(collection(this.firestore, 'ticket_summaries'), where(SYNCED_AT_FIELD, '>=', readTime)),
        { includeMetadataChanges: true },
        snap => {
          const changes = snap
            .docChanges()
            .filter(ch => ch.type !== 'removed') // leaving this change-query never means deletion
            .map(ch => ({ id: ch.doc.id, data: ch.doc.data() }));
          run(() => {
            let changed = false;
            for (const { id, data } of changes) {
              const ts = tsKeyOf(data[SYNCED_AT_FIELD]);
              if (!ts) continue;
              const prev = this.lastApplied.get(id);
              if (prev && tsLess(ts, prev)) continue;
              this.lastApplied.set(id, ts);
              if (inTicketScope(this.scope, data)) changed = this.upsert(id, data) || changed;
              else changed = this.remove(id) || changed;
            }
            if (changed) this.emit();
          });
          if (!snap.metadata.fromCache) {
            this.summariesSynced = true;
            run(() => this.maybeReady());
          }
        },
        () => this.fail()
      )
    );
    this.unsubs.push(
      onSnapshot(
        query(collection(this.firestore, 'ticket_summaries_deleted'), where('deletedAt', '>=', readTime)),
        { includeMetadataChanges: true },
        snap => {
          const changes = snap
            .docChanges()
            .filter(ch => ch.type !== 'removed')
            .map(ch => ({ id: ch.doc.id, ts: tsKeyOf(ch.doc.data().deletedAt) }));
          run(() => {
            let changed = false;
            for (const { id, ts } of changes) {
              if (!ts) continue;
              const prev = this.lastApplied.get(id);
              if (prev && tsLess(ts, prev)) continue;
              this.lastApplied.set(id, ts);
              changed = this.remove(id) || changed;
            }
            if (changed) this.emit();
          });
          if (!snap.metadata.fromCache) {
            this.tombstonesSynced = true;
            run(() => this.maybeReady());
          }
        },
        () => this.fail()
      )
    );
  }

  private upsert(id: string, data: DocumentData): boolean {
    const exists = this.byId.has(id);
    this.byId.set(id, { ...data, id });
    if (!exists) {
      // insert keeping document-id order
      let lo = 0;
      let hi = this.ids.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (compareDocIds(this.ids[mid], id) < 0) lo = mid + 1;
        else hi = mid;
      }
      this.ids.splice(lo, 0, id);
    }
    return true;
  }

  private remove(id: string): boolean {
    if (!this.byId.has(id)) return false;
    this.byId.delete(id);
    const idx = this.ids.indexOf(id);
    if (idx >= 0) this.ids.splice(idx, 1);
    return true;
  }
}

const stores = new Map<string, TicketFastStore>();
let storesOwner: string | null = null;

export function getTicketFastStore(firestore: Firestore, auth: Auth, scope: TicketScope, uid: string) {
  if (storesOwner !== uid) {
    clearTicketFastStores();
    storesOwner = uid;
  }
  const key = scopeKey(scope);
  let store = stores.get(key);
  if (!store) {
    store = new TicketFastStore(firestore, auth, scope);
    stores.set(key, store);
  }
  return store;
}

export function clearTicketFastStores() {
  stores.forEach(s => s.dispose());
  stores.clear();
  storesOwner = null;
}

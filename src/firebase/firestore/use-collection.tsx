'use client';

import { useState, useEffect } from 'react';
import {
  Query,
  onSnapshot,
  DocumentData,
  FirestoreError,
  QuerySnapshot,
  CollectionReference,
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

export type WithId<T> = T & { id: string };

export interface UseCollectionResult<T> {
  data: WithId<T>[] | null;
  isLoading: boolean;
  error: FirestoreError | FirestorePermissionError | null;
}

export interface InternalQuery extends Query<DocumentData> {
  _query: {
    path: {
      canonicalString(): string;
      toString(): string;
    };
  };
}

/**
 * React hook to subscribe to a Firestore collection or query in real-time.
 * Keeps last valid data even when Firestore temporarily denies access (prevents flicker).
 */
export interface UseCollectionOptions {
  /**
   * PERF (opt-in): on each snapshot, only re-convert documents that Firestore
   * reports as added/modified/removed; unchanged documents reuse the object
   * produced by the previous snapshot. The returned array is still a new array
   * every snapshot, with the same contents and order as without this option.
   * Callers MUST treat returned items as immutable (never mutate them in place).
   */
  reuseUnchangedDocs?: boolean;
}

export function useCollection<T = any>(
  memoizedTargetRefOrQuery:
    | ((CollectionReference<DocumentData> | Query<DocumentData>) & {
        __memo?: boolean;
      })
    | null
    | undefined,
  options?: UseCollectionOptions
): UseCollectionResult<T> {
  type ResultItemType = WithId<T>;
  const [data, setData] = useState<ResultItemType[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] =
    useState<FirestoreError | FirestorePermissionError | null>(null);
  // Primitive only — never put the options object itself in effect deps.
  const reuseUnchangedDocs = options?.reuseUnchangedDocs === true;

  useEffect(() => {
    if (!memoizedTargetRefOrQuery) {
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    // Safety check for memoization
    if (!memoizedTargetRefOrQuery.__memo) {
      throw new Error(
        `${memoizedTargetRefOrQuery} was not properly memoized using useMemoFirebase`
      );
    }

    setIsLoading(true);
    setError(null);

    // Per-subscription cache (resets whenever the query changes / effect re-runs).
    let prevByPath = new Map<string, ResultItemType>();

    const unsubscribe = onSnapshot(
      memoizedTargetRefOrQuery,
      (snapshot: QuerySnapshot<DocumentData>) => {
        let results: ResultItemType[];
        if (!reuseUnchangedDocs) {
          results = snapshot.docs.map((doc) => ({
            ...(doc.data() as T),
            id: doc.id,
          }));
        } else {
          const changed = new Set<string>();
          for (const change of snapshot.docChanges()) {
            changed.add(change.doc.ref.path);
          }
          const nextByPath = new Map<string, ResultItemType>();
          results = snapshot.docs.map((doc) => {
            const path = doc.ref.path;
            const prev = changed.has(path) ? undefined : prevByPath.get(path);
            const item =
              prev ?? ({ ...(doc.data() as T), id: doc.id } as ResultItemType);
            nextByPath.set(path, item);
            return item;
          });
          prevByPath = nextByPath;
        }

        // ✅ تحديث البيانات الجديدة بشكل آمن
        setData(results);
        setIsLoading(false);
        setError(null);
      },
      (firestoreError: FirestoreError) => {
        // 🔍 Extract path safely for better debugging
        let path = '(unknown-path)';
        try {
          path =
            memoizedTargetRefOrQuery.type === 'collection'
              ? (memoizedTargetRefOrQuery as CollectionReference).path
              : (
                  memoizedTargetRefOrQuery as unknown as InternalQuery
                )._query.path.canonicalString();
        } catch (err) {
          console.warn('Failed to extract Firestore path:', err);
        }

        // 🔒 Create contextual error
        const contextualError = new FirestorePermissionError({
          operation: 'list',
          path,
        });

        // ❌ لا تمسح البيانات القديمة لو في permission error
        if (firestoreError.code === 'permission-denied') {
          console.warn(
            `[Firestore] Permission denied on ${path}. Keeping previous data.`
          );
          errorEmitter.emit('permission-error', contextualError);
        } else {
          console.error('[Firestore Error]', firestoreError);
        }

        // نحافظ على البيانات السابقة بدل null
        setError(contextualError);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [memoizedTargetRefOrQuery, reuseUnchangedDocs]);

  return { data, isLoading, error };
}
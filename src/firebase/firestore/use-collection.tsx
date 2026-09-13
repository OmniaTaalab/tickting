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
export function useCollection<T = any>(
  memoizedTargetRefOrQuery:
    | ((CollectionReference<DocumentData> | Query<DocumentData>) & {
        __memo?: boolean;
      })
    | null
    | undefined
): UseCollectionResult<T> {
  type ResultItemType = WithId<T>;
  const [data, setData] = useState<ResultItemType[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] =
    useState<FirestoreError | FirestorePermissionError | null>(null);

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

    const unsubscribe = onSnapshot(
      memoizedTargetRefOrQuery,
      (snapshot: QuerySnapshot<DocumentData>) => {
        const results: ResultItemType[] = snapshot.docs.map((doc) => ({
          ...(doc.data() as T),
          id: doc.id,
        }));

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
  }, [memoizedTargetRefOrQuery]);

  return { data, isLoading, error };
}
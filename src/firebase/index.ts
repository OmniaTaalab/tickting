'use client';

import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  type Auth,
} from 'firebase/auth';
import { initializeFirestore, getFirestore, Firestore } from 'firebase/firestore';

const FIRESTORE_DB_ID = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || '(default)';

// IMPORTANT: DO NOT MODIFY THIS FUNCTION
export function initializeFirebase() {
  if (getApps().length === 0) {
    // Important! initializeApp() is called with the config because this is not
    // a production App Hosting environment.
    const firebaseApp = initializeApp(firebaseConfig);

    // Explicitly initialize Firestore with auto-detect long-polling to prevent connection timeouts
    // in proxied or restricted network environments like Firebase Studio.
    const firestore = initializeFirestore(firebaseApp, {
      experimentalAutoDetectLongPolling: true,
    }, FIRESTORE_DB_ID);

    return getSdks(firebaseApp, firestore);
  } else {
    // If already initialized, return the SDKs with the already initialized App
    const app = getApp();
    return getSdks(app, getFirestore(app, FIRESTORE_DB_ID));
  }
}

export function getSdks(firebaseApp: FirebaseApp, firestore: Firestore) {
  // PERF: getAuth() also registers the popup/redirect resolver, which on mobile
  // browsers, Safari and iOS makes auth startup WAIT for gapi + a hidden auth iframe
  // before the first onAuthStateChanged. This app never uses popup/redirect sign-in
  // (email/password + custom token only), so initialize auth with the exact same
  // persistence list getAuth() uses, minus the resolver. If auth was already
  // initialized elsewhere, fall back to getAuth() — identical to previous behavior.
  let auth: Auth;
  try {
    auth = initializeAuth(firebaseApp, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
    });
  } catch {
    auth = getAuth(firebaseApp);
  }

  return {
    firebaseApp,
    auth,
    firestore
  };
}

export * from './provider';
export * from './client-provider';
export * from './firestore/use-collection';
export * from './firestore/use-doc';
export * from './non-blocking-updates';
export * from './non-blocking-login';
export * from './errors';
export * from './error-emitter';

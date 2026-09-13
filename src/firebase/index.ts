'use client';

import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, getFirestore, Firestore } from 'firebase/firestore';

// IMPORTANT: DO NOT MODIFY THIS FUNCTION
export function initializeFirebase() {
  if (getApps().length === 0) {
    // Important! initializeApp() is called with the config because this is not
    // a production App Hosting environment.
    const firebaseApp = initializeApp(firebaseConfig);
    
    // Explicitly initialize Firestore with long-polling to prevent connection timeouts
    // in proxied or restricted network environments like Firebase Studio.
    const firestore = initializeFirestore(firebaseApp, {
      experimentalAutoDetectLongPolling: true,
      forceLongPolling: true, // Forcing long polling for better stability in workstation environments
    });

    return getSdks(firebaseApp, firestore);
  } else {
    // If already initialized, return the SDKs with the already initialized App
    const app = getApp();
    return getSdks(app, getFirestore(app));
  }
}

export function getSdks(firebaseApp: FirebaseApp, firestore: Firestore) {
  const auth = getAuth(firebaseApp);

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

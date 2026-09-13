'use client';

import React, { useMemo, useState, useEffect, type ReactNode } from 'react';
import { FirebaseProvider } from '@/firebase/provider';
import { initializeFirebase } from '@/firebase';

interface FirebaseClientProviderProps {
  children: ReactNode;
}

// This internal component holds the client-only logic.
function ClientOnlyFirebaseProvider({ children }: { children: ReactNode }) {
  const firebaseServices = useMemo(() => {
    return initializeFirebase();
  }, []);

  return (
    <FirebaseProvider
      firebaseApp={firebaseServices.firebaseApp}
      auth={firebaseServices.auth}
      firestore={firebaseServices.firestore}
    >
      {children}
    </FirebaseProvider>
  );
}

export function FirebaseClientProvider({ children }: FirebaseClientProviderProps) {
  const [isClient, setIsClient] = useState(false);

  // When the component mounts on the client, set the state to true.
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Only render the provider on the client-side.
  // This prevents the useMemo hook inside from running on the server.
  if (!isClient) {
    return null; // or a loading component
  }

  return <ClientOnlyFirebaseProvider>{children}</ClientOnlyFirebaseProvider>;
}

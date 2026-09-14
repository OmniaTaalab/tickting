'use client';

import { useEffect, useState, useRef } from 'react';
import { useUser, useFirebase } from '@/firebase';
import { useRouter, usePathname } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { CompleteProfileDialog } from './complete-profile-dialog';
import { toggleUserStatusAction } from '@/actions/status_actions';

// URLs that can be accessed without authentication
const PUBLIC_PATHS = ['/login', '/tickets/new'];

export function AuthInitializer({ children }: { children: React.ReactNode }) {
  const { user, isUserLoading } = useUser();
  const { firestore } = useFirebase();
  const router = useRouter();
  const pathname = usePathname();
  const [isAuthResolved, setIsAuthResolved] = useState(false);
  const [showCompleteProfile, setShowCompleteProfile] = useState(false);
  const hasSetAvailable = useRef(false);

  useEffect(() => {
    if (isUserLoading) {
      return; // Wait for Firebase to determine auth state.
    }

    const isPublicPath = PUBLIC_PATHS.includes(pathname);
    const isGatedTicketPath = pathname.startsWith('/tickets/');
    
     // Root path should redirect to dashboard if logged in, or login if not.
    if (pathname === '/') {
      if (user) {
        router.replace('/dashboard');
      } else {
        router.replace('/login');
      }
      return; 
    }

    if (user) {
      // User is logged in.
      const checkProfileAndSetStatus = async () => {
        if (!firestore) return;
        const userDoc = await getDoc(doc(firestore, 'users', user.uid));
        
        if (!userDoc.exists()) {
          setShowCompleteProfile(true);
        } else {
          // LOGIN LOGIC: Set user to AVAILABLE automatically when they first load the app while logged in
          if (!hasSetAvailable.current) {
            try {
              // We only set them to available once per app mount to respect their choice if they manually toggle to busy later
              const result = await toggleUserStatusAction(user.uid, 'Available');
              if (result && !result.success) {
                console.warn("Auto-status update note:", result.message);
              }
              hasSetAvailable.current = true;
            } catch (e) {
              console.warn("Auto-status update not available:", e);
            }
          }

          if (pathname === '/login') {
            router.replace('/dashboard');
          } else {
            setIsAuthResolved(true);
          }
        }
      };
      checkProfileAndSetStatus();
    } else {
      // User is not logged in.
      if (!isPublicPath && !isGatedTicketPath) {
        router.replace('/login');
      } else {
        setIsAuthResolved(true);
      }
      // Reset ref if logged out
      hasSetAvailable.current = false;
    }
  }, [user, isUserLoading, pathname, router, firestore]);

  const handleProfileComplete = () => {
    setShowCompleteProfile(false);
    setIsAuthResolved(true);
    router.replace('/dashboard');
  };
  
  const isPublicPath = PUBLIC_PATHS.includes(pathname) || pathname.startsWith('/tickets/');

  // Show nothing while resolving auth on a protected route or the root path.
  if ((!isAuthResolved && !isPublicPath) || (pathname === '/')) {
    return null;
  }
  
  return (
    <>
      {showCompleteProfile && user && (
        <CompleteProfileDialog
          user={user}
          onProfileComplete={handleProfileComplete}
        />
      )}
      {(isAuthResolved && !showCompleteProfile) && children}
    </>
  );
}
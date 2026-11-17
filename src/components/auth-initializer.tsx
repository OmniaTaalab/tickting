'use client';

import { useEffect, useState, useRef } from 'react';
import { useUser, useFirebase, useAuth } from '@/firebase';
import { useRouter, usePathname } from 'next/navigation';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { CompleteProfileDialog } from './complete-profile-dialog';
import { toggleUserStatusAction } from '@/actions/status_actions';

// URLs that can be accessed without authentication
const PUBLIC_PATHS = ['/login', '/tickets/new'];

// PERF: every page load used to show nothing until one Firestore read (users/{uid}) had come
// back, and only then started loading the page's own data. The same check still runs on every
// load and on every navigation, with the same consequences (not registered / deactivated ->
// signed out and sent to the login page). But when this browser passed it recently for the
// same account, the page is shown right away and the check runs alongside the page's data
// instead of in front of it. A first visit, another account, or a check older than
// VERIFIED_MAX_AGE_MS waits for the check exactly as before.
const VERIFIED_KEY = 'nis_profile_verified_v1';
const VERIFIED_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function wasRecentlyVerified(uid: string): boolean {
  try {
    const raw = window.localStorage.getItem(VERIFIED_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw) as { uid?: unknown; at?: unknown };
    return saved?.uid === uid && typeof saved.at === 'number' && Date.now() - saved.at >= 0 && Date.now() - saved.at < VERIFIED_MAX_AGE_MS;
  } catch {
    return false;
  }
}

function rememberVerified(uid: string): void {
  try {
    window.localStorage.setItem(VERIFIED_KEY, JSON.stringify({ uid, at: Date.now() }));
  } catch {
    // storage unavailable: the next load simply waits for the check
  }
}

function forgetVerified(): void {
  try {
    window.localStorage.removeItem(VERIFIED_KEY);
  } catch {
    // nothing to forget
  }
}

export function AuthInitializer({ children }: { children: React.ReactNode }) {
  const { user, isUserLoading } = useUser();
  const { firestore } = useFirebase();
  const auth = useAuth();
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
        
        let userDoc = await getDoc(doc(firestore, 'users', user.uid));
        let userData: any = userDoc.exists() ? userDoc.data() : null;

        // If not found by uid, check by email
        if (!userData && user.email) {
          try {
            const rawEmail = user.email.trim();
            const lowerEmail = rawEmail.toLowerCase();
            const q = query(collection(firestore, 'users'), where('email', '==', rawEmail));
            const snap = await getDocs(q);
            if (!snap.empty) {
              userData = snap.docs[0].data();
            } else {
              const qLower = query(collection(firestore, 'users'), where('email', '==', lowerEmail));
              const snapLower = await getDocs(qLower);
              if (!snapLower.empty) {
                userData = snapLower.docs[0].data();
              }
            }
          } catch (err) {
            console.warn('Profile search by email warning:', err);
          }
        }

        // If user is not registered in the system
        if (!userData) {
          forgetVerified();
          if (auth) {
            await signOut(auth);
          }
          router.replace('/login?error=not-registered');
          return;
        }

        // If user is inactive / deactivated
        const isInactive =
          userData.isActive === false ||
          userData.disabled === true ||
          userData.isDeactivated === true ||
          userData.status === 'Inactive' ||
          userData.status === 'Disabled';

        if (isInactive) {
          forgetVerified();
          if (auth) {
            await signOut(auth);
          }
          router.replace('/login?error=inactive');
          return;
        }

        // If a new user doesn't have any status field at all, initialize it once
        if (!userData?.status && !hasSetAvailable.current) {
          try {
            await toggleUserStatusAction(user.uid, 'Available');
            hasSetAvailable.current = true;
          } catch (e) {
            console.warn("Initial status setup note:", e);
          }
        }

        rememberVerified(user.uid);
        if (pathname === '/login') {
          router.replace('/dashboard');
        } else {
          setIsAuthResolved(true);
        }
      };
      // Passed recently in this browser for this account: show the page now (see VERIFIED_KEY).
      if (pathname !== '/login' && wasRecentlyVerified(user.uid)) {
        setIsAuthResolved(true);
      }
      checkProfileAndSetStatus();
    } else {
      // User is not logged in.
      forgetVerified();
      if (!isPublicPath && !isGatedTicketPath) {
        router.replace('/login');
      } else {
        setIsAuthResolved(true);
      }
      // Reset ref if logged out
      hasSetAvailable.current = false;
    }
  }, [user, isUserLoading, pathname, router, firestore, auth]);

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
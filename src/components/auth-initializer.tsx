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

        if (pathname === '/login') {
          router.replace('/dashboard');
        } else {
          setIsAuthResolved(true);
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
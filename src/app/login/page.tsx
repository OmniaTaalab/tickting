'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/firebase';
import { Logo } from '@/components/icons';
import { useToast } from '@/hooks/use-toast';
import { Loader2, WifiOff, AlertCircle } from 'lucide-react';
import {
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { verifyGoogleUserAction } from '@/actions/auth_google';

const EMAIL_LOGIN_TIMEOUT_MS = 15000; // 15 seconds
const GOOGLE_LOGIN_TIMEOUT_MS = 25000; // 25 seconds

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
        fill="#EA4335"
      />
    </svg>
  );
}

function LoginForm() {
  const auth = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isEmailSubmitting, setIsEmailSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isProcessing = isEmailSubmitting || isGoogleSubmitting;
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clear pending timeouts on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Monitor network connection (navigator.onLine and window events)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsOffline(!navigator.onLine);
    }

    const handleOnline = () => {
      setIsOffline(false);
      // Remove offline error if present
      setErrorMessage((prev) =>
        prev === 'No internet connection. Please check your connection and try again.'
          ? null
          : prev
      );
    };

    const handleOffline = () => {
      setIsOffline(true);
      setErrorMessage('No internet connection. Please check your connection and try again.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Read query parameters if redirected from AuthInitializer
  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam === 'not-registered') {
      const msg = 'This Google account is not registered in the system. Please contact your administrator.';
      setErrorMessage(msg);
      toast({
        variant: 'destructive',
        title: 'Access Denied',
        description: msg,
      });
    } else if (errorParam === 'inactive') {
      const msg = 'Your account is inactive. Please contact your administrator.';
      setErrorMessage(msg);
      toast({
        variant: 'destructive',
        title: 'Account Inactive',
        description: msg,
      });
    }
  }, [searchParams, toast]);

  // Execute promise with a timeout to catch slow/stalled networks
  const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      timeoutRef.current = setTimeout(() => {
        const err: any = new Error('TIMEOUT');
        err.code = 'custom/slow-connection';
        reject(err);
      }, ms);

      promise
        .then((res) => {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          resolve(res);
        })
        .catch((err) => {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          reject(err);
        });
    });
  };

  // Convert Firebase error codes into clean, user-friendly messages without exposing internal details
  const getFriendlyErrorMessage = (error: any): string => {
    const code = error?.code || '';

    if (code === 'custom/slow-connection' || error?.message === 'TIMEOUT') {
      return 'Your internet connection appears to be slow. Please check your connection and try again.';
    }

    switch (code) {
      case 'auth/network-request-failed':
        return 'No internet connection. Please check your connection and try again.';
      case 'auth/user-disabled':
        return 'Your account is inactive. Please contact your administrator.';
      case 'auth/invalid-email':
        return 'The email address you entered is invalid.';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'Invalid email or password. Please verify your credentials and try again.';
      case 'auth/too-many-requests':
        return 'Access temporarily disabled due to too many failed attempts. Please try again later.';
      case 'auth/popup-closed-by-user':
      case 'auth/cancelled-popup-request':
        return 'Sign-in was cancelled. Please try again.';
      case 'auth/popup-blocked':
        return 'Pop-up was blocked by your browser. Please allow pop-ups for this site and try again.';
      case 'auth/unauthorized-domain':
        return 'This domain is not authorized for Google Sign-In. Please contact your administrator.';
      case 'auth/account-exists-with-different-credential':
        return 'An account already exists with this email address. Please sign in with your email and password.';
      default:
        return 'An unexpected error occurred during sign-in. Please try again.';
    }
  };

  // Handle standard Email & Password Sign-in
  const handleEmailAuthAction = async () => {
    // Prevent duplicate clicks
    if (isProcessing) return;

    // Check offline status
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const offlineMsg = 'No internet connection. Please check your connection and try again.';
      setErrorMessage(offlineMsg);
      toast({
        variant: 'destructive',
        title: 'Offline',
        description: offlineMsg,
      });
      return;
    }

    if (!email.trim() || !password) {
      const msg = 'Please enter both your email and password.';
      setErrorMessage(msg);
      toast({
        variant: 'destructive',
        title: 'Missing Information',
        description: msg,
      });
      return;
    }

    setIsEmailSubmitting(true);
    setErrorMessage(null);

    try {
      if (!auth) {
        throw new Error('AUTH_UNAVAILABLE');
      }

      await withTimeout(
        signInWithEmailAndPassword(auth, email.trim(), password),
        EMAIL_LOGIN_TIMEOUT_MS
      );

      // On successful auth, AuthInitializer redirects to /dashboard
      router.replace('/dashboard');
    } catch (error: any) {
      const friendlyMsg = getFriendlyErrorMessage(error);
      setErrorMessage(friendlyMsg);
      toast({
        variant: 'destructive',
        title: 'Sign In Failed',
        description: friendlyMsg,
      });
      // Notice: email is preserved so the user can easily retry!
    } finally {
      setIsEmailSubmitting(false);
    }
  };

  // Handle Sign in with Google
  const handleGoogleSignIn = async () => {
    // Prevent duplicate clicks
    if (isProcessing) return;

    // Check offline status
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const offlineMsg = 'No internet connection. Please check your connection and try again.';
      setErrorMessage(offlineMsg);
      toast({
        variant: 'destructive',
        title: 'Offline',
        description: offlineMsg,
      });
      return;
    }

    setIsGoogleSubmitting(true);
    setErrorMessage(null);

    try {
      if (!auth) {
        throw new Error('AUTH_UNAVAILABLE');
      }

      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });

      // Step 1: Authenticate with Firebase Google Auth (with timeout protection)
      const userCredential = await withTimeout(
        signInWithPopup(auth, provider),
        GOOGLE_LOGIN_TIMEOUT_MS
      );

      const googleUser = userCredential.user;
      const googleEmail = googleUser.email?.trim();

      if (!googleEmail) {
        await signOut(auth);
        const msg = 'Unable to retrieve email from this Google account. Please contact your administrator.';
        setErrorMessage(msg);
        toast({
          variant: 'destructive',
          title: 'Sign In Failed',
          description: msg,
        });
        return;
      }

      // Step 2: Validate against Firestore employee/users records
      // Google Sign-In must NOT automatically create a new user profile
      const validation = await verifyGoogleUserAction({
        email: googleEmail,
        googleUid: googleUser.uid,
      });

      if (!validation.success) {
        // Sign user out immediately
        await signOut(auth);

        if (validation.status === 'NOT_REGISTERED') {
          const msg = 'This Google account is not registered in the system. Please contact your administrator.';
          setErrorMessage(msg);
          toast({
            variant: 'destructive',
            title: 'Access Denied',
            description: msg,
          });
          return;
        }

        if (validation.status === 'INACTIVE') {
          const msg = 'Your account is inactive. Please contact your administrator.';
          setErrorMessage(msg);
          toast({
            variant: 'destructive',
            title: 'Account Inactive',
            description: msg,
          });
          return;
        }

        // Generic / server error
        setErrorMessage(validation.message);
        toast({
          variant: 'destructive',
          title: 'Sign In Failed',
          description: validation.message,
        });
        return;
      }

      // Step 3: User is verified and active! Redirect to system dashboard
      toast({
        title: 'Welcome Back',
        description: `Signed in as ${validation.userProfile?.name || googleEmail}`,
      });

      router.replace('/dashboard');
    } catch (error: any) {
      // Ensure user is signed out if error occurs mid-process
      if (auth && auth.currentUser) {
        await signOut(auth).catch(() => {});
      }

      const friendlyMsg = getFriendlyErrorMessage(error);
      setErrorMessage(friendlyMsg);
      toast({
        variant: 'destructive',
        title: 'Google Sign In Failed',
        description: friendlyMsg,
      });
    } finally {
      setIsGoogleSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50/60 p-4 font-sans">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6">
          <Logo />
        </div>

        <Card className="border-slate-100 shadow-sm rounded-2xl bg-white overflow-hidden">
          <CardHeader className="space-y-1.5 pb-4">
            <CardTitle className="text-xl font-black text-slate-900 tracking-tight">
              Welcome Back
            </CardTitle>
            <CardDescription className="text-xs font-medium text-slate-500">
              Enter your credentials to access your account.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Offline Warning Banner */}
            {isOffline && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800 flex items-start gap-2.5 shadow-2xs">
                <WifiOff className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                <span className="leading-relaxed">
                  No internet connection. Please check your connection and try again.
                </span>
              </div>
            )}

            {/* Error Message Banner */}
            {errorMessage && !isOffline && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700 flex items-start gap-2.5 shadow-2xs">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
                <span className="leading-relaxed">{errorMessage}</span>
              </div>
            )}

            {/* Email & Password Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleEmailAuthAction();
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="email-login" className="text-xs font-bold text-slate-700">
                  Email
                </Label>
                <Input
                  id="email-login"
                  type="email"
                  placeholder="name@nis-egypt.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isProcessing}
                  className="h-10 text-xs rounded-xl border-slate-200 focus-visible:ring-primary"
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password-login" className="text-xs font-bold text-slate-700">
                  Password
                </Label>
                <Input
                  id="password-login"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isProcessing}
                  className="h-10 text-xs rounded-xl border-slate-200 focus-visible:ring-primary"
                  autoComplete="current-password"
                />
              </div>

              <Button
                type="submit"
                className="w-full h-10 rounded-xl bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white font-bold text-xs shadow-xs transition-all cursor-pointer"
                disabled={isProcessing || isOffline}
              >
                {isEmailSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    <span>Signing In...</span>
                  </>
                ) : (
                  'Sign In'
                )}
              </Button>
            </form>

            {/* Or continue with divider */}
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-[11px] uppercase tracking-wider">
                <span className="bg-white px-3 text-slate-400 font-bold">
                  Or continue with
                </span>
              </div>
            </div>

            {/* Sign in with Google Button */}
            <Button
              type="button"
              variant="outline"
              className="w-full h-11 border-slate-200 hover:bg-slate-50 font-bold text-slate-700 rounded-xl flex items-center justify-center gap-2.5 transition-all cursor-pointer shadow-2xs hover:border-slate-300"
              onClick={handleGoogleSignIn}
              disabled={isProcessing || isOffline}
            >
              {isGoogleSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-slate-600" />
                  <span className="text-xs">Signing in with Google...</span>
                </>
              ) : (
                <>
                  <GoogleIcon className="h-4 w-4 shrink-0" />
                  <span className="text-xs">Sign in with Google</span>
                </>
              )}
            </Button>
          </CardContent>

          <CardFooter className="pt-0 pb-6 px-6 justify-center">
            <p className="text-[11px] text-slate-400 font-medium text-center">
              Parent Care CRM Support System
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50/60 p-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Script from 'next/script';
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
  signInWithCustomToken,
} from 'firebase/auth';
import { verifyGoogleUserAction } from '@/actions/auth_google';

const EMAIL_LOGIN_TIMEOUT_MS = 15000; // 15 seconds
const GOOGLE_LOGIN_TIMEOUT_MS = 25000; // 25 seconds
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID;

interface GoogleCredentialResponse { credential?: string; }
declare global {
  interface Window {
    google?: { accounts: { id: {
      initialize: (config: {client_id: string; callback: (response: GoogleCredentialResponse) => void; auto_select?: boolean}) => void;
      renderButton: (element: HTMLElement, options: {theme: string; size: string; text: string; width: number}) => void;
    } } };
  }
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
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [googleScriptReady, setGoogleScriptReady] = useState(false);

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

      // Do not redirect before the app's AuthInitializer confirms authorization.
      // AuthInitializer is responsible for routing an approved user to /dashboard.

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

  // Google Identity Services supplies a Google ID token without Firebase Auth sign-in.
  // Server validates the token and membership before a Firebase custom token is issued.
  const handleGoogleCredential = async (response: GoogleCredentialResponse) => {
    if (isProcessing || !response.credential) return;
    setIsGoogleSubmitting(true);
    setErrorMessage(null);
    try {
      if (!auth) throw new Error('AUTH_UNAVAILABLE');
      const validation = await withTimeout(
        verifyGoogleUserAction({ googleIdToken: response.credential }),
        GOOGLE_LOGIN_TIMEOUT_MS
      );
      if (!validation.success || !validation.customToken) {
        const message = validation.message || 'Google sign-in was denied.';
        setErrorMessage(message);
        toast({ variant: 'destructive', title: 'Access Denied', description: message });
        return;
      }
      // No Firebase account is created until AFTER Firestore authorization succeeds.
      await withTimeout(signInWithCustomToken(auth, validation.customToken), GOOGLE_LOGIN_TIMEOUT_MS);
      toast({ title: 'Welcome Back', description: `Signed in as ${validation.userProfile?.name || 'employee'}` });
      router.replace('/dashboard');
    } catch (error: any) {
      const message = getFriendlyErrorMessage(error);
      setErrorMessage(message);
      toast({ variant: 'destructive', title: 'Google Sign In Failed', description: message });
    } finally {
      setIsGoogleSubmitting(false);
    }
  };

  // Do not call Firebase signInWithPopup here: it creates Auth users prematurely.
  // GIS renders Google's supported sign-in button; its pop-up provides the ID token.
  useEffect(() => {
    if (!googleScriptReady || !window.google || !googleButtonRef.current || !GOOGLE_CLIENT_ID) return;
    const target = googleButtonRef.current;
    target.replaceChildren();
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredential,
      auto_select: false,
    });
    window.google.accounts.id.renderButton(target, {
      theme: 'outline', size: 'large', text: 'signin_with', width: 300,
    });
    // Current callback is refreshed when state changes, ensuring loading is accurate.
  }, [googleScriptReady, auth, isProcessing]);

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

            {/* Google Identity Services official button */}
            <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive"
              onReady={() => setGoogleScriptReady(true)} />
            <div className="flex flex-col items-center gap-2">
              {isGoogleSubmitting && <span className="text-xs">Signing in with Google...</span>}
              {!GOOGLE_CLIENT_ID && <span className="text-xs text-red-600">Missing Google OAuth Client ID configuration.</span>}
              <div ref={googleButtonRef} aria-label="Sign in with Google" />
            </div>
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

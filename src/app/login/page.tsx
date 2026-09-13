'use client';

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
import {
  initiateEmailSignIn,
} from '@/firebase/non-blocking-login';
import { Logo } from '@/components/icons';
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';

export default function LoginPage() {
  const auth = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const getFriendlyErrorMessage = (error: any) => {
    const code = error.code;
    switch (code) {
      case 'auth/invalid-email':
        return 'عنوان البريد الإلكتروني الذي أدخلته غير صحيح أو بتنسيق خاطئ.';
      case 'auth/user-disabled':
        return 'هذا الحساب تم تعطيله من قبل الإدارة.';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'البريد الإلكتروني أو كلمة المرور غير صحيحة. يرجى التأكد من البيانات والمحاولة مرة أخرى.';
      case 'auth/too-many-requests':
        return 'تم حظر الدخول مؤقتاً بسبب محاولات كثيرة خاطئة. يرجى المحاولة لاحقاً.';
      case 'auth/network-request-failed':
        return 'فشل الاتصال بالإنترنت. تأكد من اتصالك وحاول مجدداً.';
      default:
        return 'حدث خطأ غير متوقع أثناء تسجيل الدخول. يرجى المحاولة لاحقاً.';
    }
  };

  const handleAuthAction = async () => {
    if (!email || !password) {
      toast({
        variant: 'destructive',
        title: 'بيانات ناقصة',
        description: 'يرجى إدخال البريد الإلكتروني وكلمة المرور.',
      });
      return;
    }
    setIsSubmitting(true);
    try {
      await initiateEmailSignIn(auth, email, password);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'فشل تسجيل الدخول',
        description: getFriendlyErrorMessage(error),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-4">
            <Logo />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Welcome Back</CardTitle>
            <CardDescription>
              Enter your credentials to access your account.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email-login">Email</Label>
              <Input
                id="email-login"
                type="email"
                placeholder="m@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password-login">Password</Label>
              <Input
                id="password-login"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button
              className="w-full"
              onClick={() => handleAuthAction()}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Signing In...' : 'Sign In'}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

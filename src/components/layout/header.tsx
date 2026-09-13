'use client';

import { LogOut, PlusCircle, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useAuth, useUser, useFirebase, useMemoFirebase, useDoc } from '@/firebase';
import { signOut } from 'firebase/auth';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { doc } from 'firebase/firestore';
import type { UserProfile } from '@/lib/types';
import { toggleUserStatusAction } from '@/actions/status_actions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar';
import { Skeleton } from '../ui/skeleton';
import { NotificationBell } from '../notifications';
import { UserStatusToggle } from '../user-status-toggle';
import { LanguageToggle } from '../language-toggle';
import { useLanguage } from '@/hooks/use-language';

function UserMenu() {
  const { user, isUserLoading } = useUser();
  const { firestore } = useFirebase();
  const auth = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const { t } = useLanguage();

  const userProfileRef = useMemoFirebase(() =>
    user && firestore ? doc(firestore, 'users', user.uid) : null,
    [user, firestore]
  );
  const { data: userProfile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef);

  const handleSignOut = async () => {
    try {
      // Set status to Busy before signing out to prevent assignments
      if (user) {
        await toggleUserStatusAction(user.uid, 'Busy');
      }
      await signOut(auth);
      toast({
        title: t('signOut'),
        description: 'You have been successfully signed out.',
      });
      router.replace('/login');
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Sign Out Error',
        description: error.message || 'An error occurred during sign-out.',
      });
    }
  };

  if (isUserLoading || isProfileLoading) {
    return <Skeleton className="h-8 w-8 rounded-full" />;
  }

  if (!user) {
    return null;
  }

  const displayName = userProfile?.name || user.displayName || 'No Name';
  const avatarUrl = userProfile?.avatarUrl || user.photoURL || undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full">
          <Avatar className="h-8 w-8">
            <AvatarImage src={avatarUrl} alt={displayName} />
            <AvatarFallback>
              {displayName.charAt(0) || user.email?.charAt(0) || 'U'}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{displayName}</p>
            <p className="text-xs leading-none text-muted-foreground">
              {user.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <User className="mr-2 h-4 w-4" />
            <span>{t('profile')}</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut className="mr-2 h-4 w-4" />
          <span>{t('signOut')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Header() {
  const { user } = useUser();
  const { t } = useLanguage();

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b bg-background/80 px-4 backdrop-blur-sm lg:px-6">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="md:hidden" />
      </div>
      <div className="flex flex-1 items-center justify-end gap-4">
        <Button asChild className="bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white transition-colors">
          <Link href="/tickets/new">
            <PlusCircle className="mr-2 h-4 w-4" />
            {t('newTicket')}
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          {user && (
            <>
              <UserStatusToggle />
              <NotificationBell />
            </>
          )}
          <LanguageToggle />
        </div>
        <UserMenu />
      </div>
    </header>
  );
}
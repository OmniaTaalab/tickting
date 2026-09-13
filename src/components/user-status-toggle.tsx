
'use client';

import { useState, useEffect, useTransition } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useFirebase, useUser, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import type { UserProfile, UserStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { toggleUserStatusAction } from '@/actions/status_actions';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/hooks/use-language';

export function UserStatusToggle() {
  const { firestore } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [isPending, startTransition] = useTransition();

  const userProfileRef = useMemoFirebase(() =>
    user && firestore ? doc(firestore, 'users', user.uid) : null,
    [user, firestore]
  );
  const { data: userProfile, isLoading } = useDoc<UserProfile>(userProfileRef);

  const [currentStatus, setCurrentStatus] = useState<UserStatus>('Available');

  useEffect(() => {
    if (userProfile?.status) {
      setCurrentStatus(userProfile.status);
    }
  }, [userProfile]);

  const handleToggle = (checked: boolean) => {
    if (!user) return;
    const newStatus: UserStatus = checked ? 'Available' : 'Busy';
    
    // Optimistic UI update
    const previousStatus = currentStatus;
    setCurrentStatus(newStatus);

    startTransition(async () => {
      const result = await toggleUserStatusAction(user.uid, newStatus);
      if (!result?.success) {
        setCurrentStatus(previousStatus);
        toast({
          variant: 'destructive',
          title: 'Update Failed',
          description: result?.message || 'Could not update status.',
        });
      }
    });
  };

  if (isLoading) {
    return <div className="flex items-center justify-center w-8 h-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  }

  const isAvailable = currentStatus === 'Available';

  return (
    <div className={cn(
        "flex items-center justify-between gap-4 px-4 py-2 rounded-full border bg-white shadow-sm transition-all hover:shadow-md min-w-[165px]"
    )}>
      <div className="flex items-center gap-2.5 min-w-0">
        <div className={cn(
          "h-2.5 w-2.5 rounded-full shrink-0",
          isPending ? "animate-spin border-t-transparent border-2 border-primary bg-transparent" : "animate-pulse",
          !isPending && (isAvailable ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.6)]" : "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.6)]")
        )} />
        <Label 
            htmlFor="user-status" 
            className="text-[10px] font-black uppercase tracking-widest cursor-pointer select-none text-slate-700 whitespace-nowrap truncate"
        >
          {isAvailable ? t('available') : t('busy')}
        </Label>
      </div>
      <Switch
        id="user-status"
        checked={isAvailable}
        onCheckedChange={handleToggle}
        disabled={isPending}
        className="data-[state=checked]:bg-green-500 data-[state=unchecked]:bg-red-500 shrink-0"
      />
    </div>
  );
}

'use client';

import { Loader2 } from 'lucide-react';
import { Logo } from '@/components/icons';

/**
 * The root page is just a placeholder. 
 * AuthInitializer in layout.tsx handles redirects to /login or /dashboard.
 */
export default function RootPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="flex flex-col items-center gap-4 animate-pulse">
          <Logo className="mb-4" />
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Loading NIS CRM...</p>
      </div>
    </div>
  );
}

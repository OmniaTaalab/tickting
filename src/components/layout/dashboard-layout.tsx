'use client';

import { usePathname } from 'next/navigation';
import { SidebarProvider, Sidebar, SidebarInset } from '@/components/ui/sidebar';
import { SidebarNav } from '@/components/layout/sidebar-nav';
import { Header } from '@/components/layout/header';
import { useUser } from '@/firebase';
import { Skeleton } from '../ui/skeleton';
import { useLanguage } from '@/hooks/use-language';

function FullScreenLoader() {
  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-[250px]" />
          <Skeleton className="h-4 w-[200px]" />
        </div>
      </div>
    </div>
  );
}


export function DashboardLayout({ children }: { children: React.ReactNode }) {
    const { isUserLoading } = useUser();
    const pathname = usePathname();
    const { isRTL } = useLanguage();

    if (isUserLoading) {
        return <FullScreenLoader />;
    }

    if (pathname === '/login' || pathname === '/') {
        return <>{children}</>;
    }
    
    const showSidebar = pathname !== '/tickets/new';


  return (
    <SidebarProvider>
      {showSidebar && (
        <Sidebar 
          variant="sidebar" 
          collapsible="icon" 
          side={isRTL ? "right" : "left"}
        >
          <SidebarNav />
        </Sidebar>
      )}
      <SidebarInset>
        <Header />
        <main className="p-4 lg:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}

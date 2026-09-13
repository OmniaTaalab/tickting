import type { Metadata } from 'next';
import { Toaster } from '@/components/ui/toaster';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import './globals.css';
import { FirebaseClientProvider } from '@/firebase';
import { AuthInitializer } from '@/components/auth-initializer';
import { LanguageProvider } from '@/hooks/use-language';

export const metadata: Metadata = {
  title: 'NIS CRM Support',
  description: 'Parent Care CRM & Support System',
  manifest: '/site.webmanifest',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased">
        <LanguageProvider>
          <FirebaseClientProvider>
            <AuthInitializer>
              <DashboardLayout>{children}</DashboardLayout>
            </AuthInitializer>
          </FirebaseClientProvider>
        </LanguageProvider>
        <Toaster />
      </body>
    </html>
  );
}

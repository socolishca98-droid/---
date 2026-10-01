import type { Metadata } from "next";
import "./globals.css";
import { Toaster as SonnerToaster } from "sonner";
import { AuthProvider } from "@/lib/auth-context";
import { SidebarProvider } from "@/lib/sidebar-context";
import { CsrfProvider } from "@/components/csrf-provider";
import { LiveBackground } from "@/components/visual/live-background";
import { PageTransition } from "@/components/visual/page-transition";
import { WelcomeSplash } from "@/components/visual/welcome-splash";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { OwnerViewBanner } from "@/components/owner-view-banner";

export const metadata: Metadata = {
  title: "Loginex TMS — Система управления грузоперевозками",
  description:
    "Loginex TMS: управление грузоперевозками, мониторинг автопарка, координация рейсов и мобильное приложение водителя",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        {/* Живой фон (задача 9): декоративный слой под содержимым,
            в контуре водителя и на печати не рендерится */}
        <LiveBackground />

        <CsrfProvider>
          <AuthProvider>
            <SidebarProvider>
              {/* Подтверждения — свои диалоги, а не системные окна браузера */}
              <ConfirmProvider>
                {/* Плавный вход в раздел вместо мгновенной подмены экрана */}
                <PageTransition>{children}</PageTransition>
                {/* Приветствие после входа: показывается один раз на сессию,
                    в том числе на полноэкранном дашборде с картой */}
                <WelcomeSplash />
                {/* Режим владельца: баннер виден, пока владелец внутри чужой организации */}
                <OwnerViewBanner />
              </ConfirmProvider>
            </SidebarProvider>
          </AuthProvider>
        </CsrfProvider>
        <SonnerToaster richColors position="top-right" />
      </body>
    </html>
  );
}

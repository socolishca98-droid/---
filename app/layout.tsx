import type { Metadata } from "next"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { AuthProvider } from "@/lib/auth-context"
import { SidebarProvider } from "@/lib/sidebar-context"
import { CsrfProvider } from "@/components/csrf-provider"
import { LiveBackground } from "@/components/visual/live-background"
import { PageTransition } from "@/components/visual/page-transition"
import { ConfirmProvider } from "@/components/ui/confirm-dialog"

export const metadata: Metadata = {
  title: "Loginex TMS — Система управления грузоперевозками",
  description: "Loginex TMS: управление грузоперевозками, мониторинг автопарка, координация рейсов и мобильное приложение водителя",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
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
              </ConfirmProvider>
            </SidebarProvider>
          </AuthProvider>
        </CsrfProvider>
        <Toaster />
        <SonnerToaster richColors position="top-right" />
      </body>
    </html>
  )
}
import type { Metadata } from "next"
import "./globals.css"
import { Toaster as SonnerToaster } from "sonner"
import { AuthProvider } from "@/lib/auth-context"
import { SidebarProvider } from "@/lib/sidebar-context"
import { CsrfProvider } from "@/components/csrf-provider"
import { LiveBackground } from "@/components/visual/live-background"
import { PageTransition } from "@/components/visual/page-transition"
import { WelcomeSplash } from "@/components/visual/welcome-splash"
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
                {/* Приветствие после входа: показывается один раз на сессию,
                    в том числе на полноэкранном дашборде с картой */}
                <WelcomeSplash />
              </ConfirmProvider>
            </SidebarProvider>
          </AuthProvider>
        </CsrfProvider>
        {/* Уведомления — «прозрачное стекло» iOS: размытая подложка,
            лёгкая световая рамка, мягкая тень, крупное скругление.
            Позиция сверху по центру — как баннер-уведомление на iPhone. */}
        <SonnerToaster
          richColors
          position="top-center"
          toastOptions={{
            classNames: {
              toast:
                "!rounded-2xl !border !border-white/15 !bg-white/10 !backdrop-blur-xl !backdrop-saturate-150 !shadow-[0_8px_32px_rgba(0,0,0,0.36)] !ring-1 !ring-inset !ring-white/10 !text-[13px] !font-medium",
              title: "!text-[13px] !font-semibold",
              description: "!text-[11.5px] !opacity-75",
              actionButton:
                "!rounded-full !border-white/15 !bg-white/15 !backdrop-blur-sm !text-[12px]",
              cancelButton: "!rounded-full !border-white/15 !bg-white/10",
              closeButton: "!rounded-full !border-white/10 !bg-white/10",
              success:
                "!border-emerald-400/30 !bg-emerald-950/45 !text-emerald-50",
              error: "!border-red-400/30 !bg-red-950/45 !text-red-50",
              warning: "!border-amber-400/30 !bg-amber-950/45 !text-amber-50",
              info: "!border-white/15 !bg-white/10 !text-foreground",
            },
          }}
        />
      </body>
    </html>
  )
}
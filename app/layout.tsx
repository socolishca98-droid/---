import type { Metadata } from "next"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { AuthProvider } from "@/lib/auth-context"
import { SidebarProvider } from "@/lib/sidebar-context"
import { CsrfProvider } from "@/components/csrf-provider"

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
        <CsrfProvider>
          <AuthProvider>
            <SidebarProvider>{children}</SidebarProvider>
          </AuthProvider>
        </CsrfProvider>
        <Toaster />
        <SonnerToaster richColors position="top-right" />
      </body>
    </html>
  )
}
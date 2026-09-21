import type { Metadata } from "next"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
import { AuthProvider } from "@/lib/auth-context"
import { SidebarProvider } from "@/lib/sidebar-context"
import { PRODUCT_NAME } from "@/lib/auth/constants"

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} — система управления грузоперевозками`,
  description:
    "Заказы, маршруты, автопарк и водители в одном контуре: от заявки до отчёта по рейсу",
  applicationName: PRODUCT_NAME,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <AuthProvider>
          <SidebarProvider>
            {children}
          </SidebarProvider>
        </AuthProvider>
        {/* Два тостера подключены исторически: часть страниц использует sonner,
            часть — radix-useToast. Задача 3 сведёт их к одной системе,
            пока работают оба, чтобы сообщения не терялись. */}
        <Toaster />
        <SonnerToaster position="top-right" richColors />
      </body>
    </html>
  )
}

// app/lm/layout.tsx
//
// Оболочка мобильной панели логиста.
//
// Отдельный контур, а не адаптив десктопных страниц: на телефоне нужны другие
// экраны (крупные карточки, нижняя навигация, действия в один тап), и смешивать
// это с таблицами и боковым меню десктопа — значит испортить оба варианта.
// Данные те же самые: контур работает через те же /api/* и ту же штабную сессию.

import type { Metadata, Viewport } from "next"

import { LogistBottomNav } from "@/components/logist-mobile/bottom-nav"

export const metadata: Metadata = {
  title: "Логистика · мобильная панель",
  description: "Мобильная панель логиста: заказы, рейсы, водители",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Логистика",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0b0b0e",
}

export default function LogistMobileLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-[#0b0b0e] text-white">
      <div className="mx-auto max-w-md">
        {/* Отступ снизу — под фиксированную навигацию плюс «безопасная зона» */}
        <div className="pb-[calc(72px+env(safe-area-inset-bottom))]">{children}</div>
      </div>

      <LogistBottomNav />
    </div>
  )
}

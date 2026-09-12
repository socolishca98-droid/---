import type { Metadata, Viewport } from "next"

export const metadata: Metadata = {
  title: "Водитель | АИ Логистика",
  description: "Мобильное приложение водителя",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "АИ Логистика",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#09090b",
}

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-[#09090b] text-white flex justify-center">
      <div className="w-full max-w-md mx-auto relative">
        {children}
      </div>
    </div>
  )
}
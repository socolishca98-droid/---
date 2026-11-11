import type { Metadata, Viewport } from "next"
import { cookies, headers } from "next/headers"

import { AccountSwitchBanner } from "@/components/account-switch-banner"
import { DRIVER_COOKIE, IMPERSONATION_COOKIE, STAFF_COOKIE } from "@/lib/auth/constants"
import { driverSessionFromCookies } from "@/lib/auth/session"
import { prisma } from "@/lib/prisma"

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

/**
 * и37: серверная запись состояния запроса к кабинету и входу водителя.
 * Жалоба с прода воспроизводится только там и только на телефоне владельца;
 * локально путь зелёный в Chromium и WebKit. Датчик пишет в журнал, ЧТО
 * реально прислал браузер в момент захода на /m и /m/login — по этим
 * записям причина находится без догадок. Убирается после разбора.
 */
async function logMDiagnostic() {
  try {
    const h = await headers()
    const full = h.get("x-loginex-path") ?? ""
    const pure = full.split("?")[0]
    if (pure !== "/m" && pure !== "/m/login") return
    const store = await cookies()
    const names = [STAFF_COOKIE, IMPERSONATION_COOKIE, DRIVER_COOKIE, "loginex_csrf"].filter(
      (name) => Boolean(store.get(name)?.value),
    )
    const alive = Boolean(await driverSessionFromCookies(store))
    await prisma.auditLog.create({
      data: {
        actorId: "diagnostic",
        action: "diag_m_layout",
        targetType: "diagnostic",
        metadata: JSON.stringify({
          path: full,
          cookies: names,
          driverAlive: alive,
          ua: (h.get("user-agent") ?? "").slice(0, 120),
          ref: h.get("referer") ?? null,
        }),
      },
    })
  } catch {
    // датчик не имеет права ломать страницу — ни при каких условиях
  }
}

export default async function MobileLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await logMDiagnostic()
  return (
    <div className="min-h-screen bg-[#09090b] text-white flex justify-center">
      <div className="w-full max-w-md mx-auto relative">
        {/* Уведомление владельцу: он смотрит приложение водителя, а не свой кабинет */}
        <AccountSwitchBanner className="sticky top-0 z-50" sessionKind="driver" />
        {children}
      </div>
    </div>
  )
}
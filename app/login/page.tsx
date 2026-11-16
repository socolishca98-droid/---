/**
 * /login — экран входа сотрудника.
 *
 * Серверный компонент: читает ?next= и передаёт его в форму, чтобы после входа
 * вернуть человека на ту страницу, с которой его развернул middleware.
 * middleware отдельно следит, чтобы уже вошедший пользователь сюда не попадал.
 *
 * и54: датчик diag_login — как и50 на входе водителя. Вечер 16.11 показал
 * слепое пятно: владелец дважды входил сюда по паролю (журнал это видел как
 * «login byPassword»), но сам РЕНДЕР страницы входа нигде не фиксировался —
 * нельзя было доказать, что он действительно видел эту форму, а не «призрак»
 * другого экрана. Теперь журнал видит каждый заход: с какими cookie, с каким
 * исходом (will — куда страница отправит человека). Убирается после разбора.
 */

import { redirect } from "next/navigation"
import { cookies, headers } from "next/headers"
import { LoginForm } from "@/components/login-form"
import type { Metadata } from "next"
import { PRODUCT_NAME, STAFF_COOKIE, DRIVER_COOKIE } from "@/lib/auth/constants"
import { isOwnerEmail } from "@/lib/auth/owner"
import { staffSessionFromCookies } from "@/lib/auth/session"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: `Вход · ${PRODUCT_NAME}`,
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const params = await searchParams
  const next = params?.next

  // Уже вошедший сотрудник не должен видеть форму входа
  const cookieStore = await cookies()
  let session: Awaited<ReturnType<typeof staffSessionFromCookies>> = null
  try {
    // и33: проверяем сессию ЦЕЛИКОМ — подпись, живую строку в базе и
    // активную учётку (как API). Раньше смотрели только подпись: человек
    // с отозванной сессией улетал с входа в кабинет, там его встречал
    // 401 — и по кругу, без возможности войти заново.
    session = await staffSessionFromCookies(cookieStore)
  } catch {
    // AUTH_SECRET не задан или токен битый — показываем форму входа
  }

  const home = session
    ? isOwnerEmail(session.user.email)
      ? "/owner"
      : session.user.role === "logist"
        ? "/lm"
        : "/dashboard"
    : null
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null

  // и54: журнал видит заход ДО redirect() — иначе уходящие со входа
  // невидимы, и разбор жалоб упирается в догадки (см. и50 для /m/login)
  try {
    const h = await headers()
    const names = [STAFF_COOKIE, "loginex_owner_session", DRIVER_COOKIE, "loginex_csrf"].filter(
      (name) => Boolean(cookieStore.get(name)?.value),
    )
    await prisma.auditLog.create({
      data: {
        actorId: "diagnostic",
        action: "diag_login",
        targetType: "diagnostic",
        metadata: JSON.stringify({
          cookies: names,
          staffAlive: session !== null,
          will: session ? (safeNext ?? home) : "form",
          dest: h.get("sec-fetch-dest") ?? null,
          mode: h.get("sec-fetch-mode") ?? null,
          rsc: h.get("rsc") ?? null,
          ua: (h.get("user-agent") ?? "").slice(0, 200),
          ref: h.get("referer") ?? null,
        }),
      },
    })
  } catch {
    // датчик не имеет права ломать вход
  }

  if (session) redirect(safeNext ?? home!)

  return <LoginForm nextPath={next} />
}

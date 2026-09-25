/**
 * / — точка входа.
 *
 * Серверный компонент: смотрит на подписанный сессионный токен в httpOnly-cookie
 * и отправляет пользователя в его контур. Неавторизованный — на /login.
 * middleware делает то же самое раньше (это страховка и единое поведение,
 * если middleware отключён или путь не попал в matcher).
 */

import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { DRIVER_COOKIE, STAFF_COOKIE } from "@/lib/auth/constants"
import { verifySessionToken } from "@/lib/auth/token"

export const dynamic = "force-dynamic"

export default async function HomePage() {
  const cookieStore = await cookies()

  try {
    const staff = await verifySessionToken(cookieStore.get(STAFF_COOKIE)?.value)
    if (staff && staff.kind === "staff") redirect("/dashboard")

    const driver = await verifySessionToken(cookieStore.get(DRIVER_COOKIE)?.value)
    if (driver && driver.kind === "driver") redirect("/m")
  } catch {
    // Нет AUTH_SECRET или токен не читается — отправляем на вход,
    // а настоящий ответ даст сервер авторизации
  }

  redirect("/login")
}

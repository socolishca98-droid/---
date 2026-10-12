// lib/auth/impersonation.ts
//
// «Вход как»: владелец платформы открывает любой аккаунт, не зная пароля.
//
// Как это устроено:
//   1. Владелец входит своим паролем — как обычно, обычная сессия.
//   2. На странице администрирования он нажимает «Войти» у нужного аккаунта.
//   3. Сервер выпускает НОВУЮ сессию для этого аккаунта и кладёт её в обычную
//      cookie сотрудника или водителя. Свою сессию он при этом не теряет:
//      её токен сохраняется в отдельной httpOnly-cookie IMPERSONATION_COOKIE.
//   4. На экране сверху висит полоса «Вы вошли как …» с кнопкой «Вернуться» —
//      она возвращает собственную сессию владельца на место.
//
// Права: и «вход как», и «вернуться» требуют действующей сессии владельца
// (lib/auth/owner.ts). Чужой сотрудник эти адреса получить не может.

import "server-only"
import type { NextRequest } from "next/server"

import { IMPERSONATION_COOKIE, STAFF_COOKIE } from "@/lib/auth/constants"
import { verifySessionToken } from "@/lib/auth/token"
import { isOwnerEmail } from "@/lib/auth/owner"

export interface ActingOwner {
  /** id владельца, который смотрит чужой аккаунт */
  userId: string
  /** его email — показываем в полосе «Вы вошли как» */
  email: string | null
  /** его имя */
  name: string | null
  /** его собственный токен: им же и возвращаемся */
  token: string
}

/**
 * Сессия владельца, сохранённая при входе в чужой аккаунт.
 * null — если «вход как» не выполнялся или токен уже недействителен.
 */
export async function loadActingOwner(request: NextRequest): Promise<ActingOwner | null> {
  const token = request.cookies.get(IMPERSONATION_COOKIE)?.value
  if (!token) return null
  // Без основной сессии «вход как» уже не действует: остался только хвост cookie
  if (!request.cookies.get(STAFF_COOKIE)?.value) return null

  const payload = await verifySessionToken(token)
  if (!payload || payload.kind !== "staff") return null

  // Токен подписан нами, но владельца всё равно проверяем по email в базе:
  // так смена OWNER_EMAIL сразу закрывает доступ прежнему владельцу.
  const { prisma } = await import("@/lib/prisma")
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, name: true, status: true },
  })
  if (!user || user.status !== "active") return null
  if (!isOwnerEmail(user.email)) return null

  return { userId: user.id, email: user.email, name: user.name, token }
}

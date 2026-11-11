// app/m/login/page.tsx
//
// Вход водителя: телефон + пароль. Сервер проверяет пароль и выдаёт подписанный
// httpOnly-cookie (POST /api/m/login). Никаких «организации на глаз» и никакого
// driverId в localStorage — сессию хранит сервер.
//
// Оформление: тот же 3D-мир «Ночной рейс», что и у входа логиста (просьба
// владельца: «всё интегрировано в 3D, больше объёма, перемещаемся в
// пространстве»). Камера едет сквозь ночь по дороге водителя — ворота с его
// разделами («Мои рейсы», «Маршрут», «Документы»…) пролетают мимо, ракурс —
// пальцем или ГИРОСКОПОМ (наклоняй телефон). Форма — объект мира: парящая
// плита на ближайшей глубине, дорога течёт позади неё.
//
// и33: страница стала серверным компонентом. Причина — жалоба владельца:
// открыв чужой водительский аккаунт и потеряв его сессию (например, защита
// хостинга перехватила запросы), он оставался на этом красивом экране
// без пути назад: его почта в поле «Телефон» не работает, а полоса
// «Вы вошли как» исчезает вместе с умершей сессией. Cookie — httpOnly,
// увидеть её может только сервер: он и рисует кнопку возврата в панель.

import { cookies } from "next/headers"

import { redirect } from "next/navigation"

import { DriverLoginForm } from "@/components/driver-login-form"
import { actingOwnerFromCookies } from "@/lib/auth/impersonation"
import { STAFF_COOKIE, DRIVER_COOKIE } from "@/lib/auth/constants"
import { verifySessionToken } from "@/lib/auth/token"
import { isOwnerEmail } from "@/lib/auth/owner"
import { driverSessionFromCookies } from "@/lib/auth/session"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export default async function DriverLoginPage() {
  // Живая водительская сессия — сразу в кабинет, без формы (и33: раньше
  // это делал edge-proxy по одной подписи токена — и человек с отозванной
  // в базе сессией бесконечно летал между /m и /m/login. Теперь проверка
  // серверная, по базе — как у API).
  try {
    const alive = await driverSessionFromCookies(await cookies())
    if (alive) redirect("/m")
  } catch {
    // база недоступна — покажем форму: вход всё равно проверит сервер
  }

  // Владелец на входе водителя: показываем путь назад в его панель.
  // impersonation — чужой аккаунт умер, вернёмся через /api/admin/return;
  // own — своя сессия жива, достаточно перейти в /owner.
  let owner: { name: string | null; mode: "impersonation" | "own" } | null = null
  try {
    const store = await cookies()
    const acting = await actingOwnerFromCookies(store)
    if (acting) {
      owner = { name: acting.name, mode: "impersonation" }
    } else {
      const staff = await verifySessionToken(store.get(STAFF_COOKIE)?.value)
      if (staff && staff.kind === "staff") {
        const user = await prisma.user.findUnique({
          where: { id: staff.sub },
          select: { email: true, name: true, status: true },
        })
        if (user && user.status === "active" && isOwnerEmail(user.email)) {
          owner = { name: user.name, mode: "own" }
        }
      }
    }
  } catch {
    // AUTH_SECRET не задан или база недоступна — обычный вход водителя
  }

  // и35: сервер видит httpOnly-cookie — клиент не видит. Есть ли cookie
  // водителя в ЭТОМ запросе, знает только сервер; это разделяет «cookie
  // не дошла до сервера» (браузер или приложение её не прислали) и
  // «cookie есть, но сессия мертва». Показывается только владельцу.
  let driverCookie: "present" | "none" = "none"
  try {
    const store = await cookies()
    driverCookie = store.get(DRIVER_COOKIE)?.value ? "present" : "none"
  } catch {
    // остаётся "none" — диагностика не должна ломать страницу входа
  }

  return <DriverLoginForm owner={owner} diagnostic={{ driverCookie }} />
}

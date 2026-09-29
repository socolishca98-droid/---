// app/api/onboarding/route.ts
//
// Приветственный инструктаж при первом входе:
//   GET  — показывать ли инструктаж (onboardedAt пустой) и кто вошёл
//   POST — отметить, что пользователь прошёл инструктаж
//
// Онбординг хранится на учётке входа (User.onboardedAt), а не в localStorage:
// он отмечается один раз на человека и не всплывает снова на новом устройстве.

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireAnySession } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const auth = await requireAnySession(request)
  if (!auth.ok) return auth.response
  const session = auth.value

  const userId = session.kind === "staff" ? session.user.id : session.userId
  // org-audit: manual — читается сама учётка входа (id из проверенной сессии),
  // а не данные организации
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, onboardedAt: true },
  })
  if (!user) {
    return NextResponse.json({ success: false, error: "Пользователь не найден" }, { status: 404 })
  }

  return NextResponse.json({
    success: true,
    show: user.onboardedAt === null,
    role: user.role,
    name: user.name,
    organizationName:
      session.kind === "staff"
        ? session.user.organizationName
        : session.driver.organizationName,
  })
}

export async function POST(request: NextRequest) {
  const auth = await requireAnySession(request)
  if (!auth.ok) return auth.response
  const session = auth.value

  const userId = session.kind === "staff" ? session.user.id : session.userId
  // org-audit: manual — обновляется сама учётка входа (id из проверенной сессии)
  await prisma.user.update({
    where: { id: userId },
    data: { onboardedAt: new Date() },
  })

  return NextResponse.json({ success: true })
}

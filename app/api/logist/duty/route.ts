// app/api/logist/duty/route.ts
//
// Дежурный логист: GET — что он видит сейчас, POST — «посмотреть биржу».
//
// GET ничего не сканирует: экран должен открываться мгновенно и показывать
// то, что уже накоплено, плюс честный ответ «пора смотреть или нет».
// POST запускает сбор (как кнопка «Собрать»), обновляет память «что уже
// показывали» и возвращает ленту нового.

import { NextRequest, NextResponse } from "next/server"
import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization } from "@/lib/org"
import { getDutyState, runDuty } from "@/lib/logist-mobile/duty-service"
import { captureRouteError } from "@/lib/sentry"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error
  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  try {
    const state = await getDutyState(org.organizationId)
    return NextResponse.json({ success: true, ...state })
  } catch (error) {
    captureRouteError("api/logist/duty", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Дежурный недоступен",
      },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error
  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  try {
    const body = (await request.json().catch(() => ({}))) as {
      force?: boolean
      scan?: boolean
    }
    const result = await runDuty(org.organizationId, {
      force: Boolean(body.force),
      scan: body.scan !== false,
    })
    const state = await getDutyState(org.organizationId)
    return NextResponse.json({ success: true, result, ...state })
  } catch (error) {
    captureRouteError("api/logist/duty", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Не удалось посмотреть биржу",
      },
      { status: 500 },
    )
  }
}

// app/api/m/shift/route.ts
//
// Смена водителя: начать, переключить статус, завершить.
//
// Раньше здесь была неприятная поломка: экран водителя отправлял
// { action: "status", status: "loading" }, а обработчик знал только «начать
// смену» и отвечал success, ничего не меняя. Кнопки «Погрузка», «Выгрузка»,
// «Отдых» лишь подсвечивались на экране — время не учитывалось, аналитики не
// существовало. Теперь каждое действие доходит до журнала ShiftEvent, итоги
// по группам пересчитываются из журнала, а отдых дополнительно пишется в
// рейс (по нему считаются нормы).
//
// Вся логика — в lib/shift/service.ts, здесь только транспорт и авторизация.

import { NextRequest, NextResponse } from "next/server"

import { requireDriver } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { prisma } from "@/lib/prisma"
import {
  changeShiftStatus,
  closeShift,
  getActiveOrderForDriver,
  getShiftSnapshot,
} from "@/lib/shift/service"
import { SELECTABLE_SHIFT_STATUSES } from "@/lib/shift/timeline"

export const dynamic = "force-dynamic"

/** Ответ экрана водителя: смена + итоги + нормы отдыха + активный заказ. */
function snapshotPayload(snapshot: Awaited<ReturnType<typeof getShiftSnapshot>>) {
  if (!snapshot) {
    return NextResponse.json({ success: false, error: "Смена не начата" }, { status: 400 })
  }

  return NextResponse.json({
    success: true,
    shift: snapshot.shift,
    // Секунды в текущем статусе — экран тикает их сам, не дожидаясь опроса
    statusSeconds: snapshot.statusSeconds,
    totals: snapshot.totals,
    segments: snapshot.segments,
    rest: snapshot.rest,
    activeOrder: snapshot.activeOrder,
    statuses: SELECTABLE_SHIFT_STATUSES,
  })
}

// GET /api/m/shift — снимок текущей смены водителя
export async function GET(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const snapshot = await getShiftSnapshot({
      driverId: auth.value.driver.id,
      organizationId: org.organizationId,
    })

    if (!snapshot) {
      return NextResponse.json({
        success: true,
        shift: null,
        statuses: SELECTABLE_SHIFT_STATUSES,
      })
    }

    return snapshotPayload(snapshot)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shift GET error"
    console.error("[m/shift] GET Error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// POST /api/m/shift
// body: { action?: "start" | "status" | "end", status?, orderId?, latitude?, longitude? }
//   start  — начать смену (по умолчанию)
//   status — переключить статус («в пути», «погрузка», «отдых»…)
//   end    — завершить смену
export async function POST(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const driverId = auth.value.driver.id

  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string
      status?: string
      orderId?: string | null
      latitude?: number | null
      longitude?: number | null
    }

    const action = body.action ?? "start"

    if (action === "status") {
      if (!body.status) {
        return NextResponse.json(
          { success: false, error: "Укажите статус", code: "status_required" },
          { status: 400 },
        )
      }

      const result = await changeShiftStatus({
        driverId,
        organizationId: org.organizationId,
        status: body.status,
        orderId: body.orderId ?? null,
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
      })

      if (!result.ok) {
        return NextResponse.json({ success: false, error: result.error }, { status: result.status })
      }

      const payload = snapshotPayload(result.snapshot ?? null)
      if (payload.status !== 200) return payload
      // Дополняем ответ длительностью завершившегося статуса: экран показывает
      // «погрузка: 1 ч 20 мин» сразу после нажатия, не пересчитывая сам.
      const json = await payload.json()
      return NextResponse.json({ ...json, seconds: result.seconds ?? 0 })
    }

    if (action === "end") {
      const closed = await closeShift({ driverId, organizationId: org.organizationId })
      if (!closed.ok) {
        return NextResponse.json({ success: false, error: closed.error }, { status: 400 })
      }
      return NextResponse.json({ success: true, shift: null })
    }

    // ── action: "start" ───────────────────────────────────────────────────
    const existing = await prisma.driverShift.findFirst({
      where: scopedWhere(org.organizationId, { driverId, endedAt: null }),
      orderBy: { startedAt: "desc" },
    })

    if (existing) {
      const snapshot = await getShiftSnapshot({
        driverId,
        organizationId: org.organizationId,
      })
      const payload = snapshotPayload(snapshot)
      if (payload.status !== 200) return payload
      const json = await payload.json()
      return NextResponse.json({ ...json, alreadyActive: true })
    }

    // Активный заказ водителя — тем же способом, что и вся остальная смена
    const activeOrder = await getActiveOrderForDriver(driverId, org.organizationId)

    // Стартовый статус: если рейс уже назначен — «в пути», иначе «ожидаю рейс»
    const startStatus = activeOrder ? "driving" : "waiting"

    const now = new Date()
    const shift = await prisma.$transaction(async (tx) => {
      const created = await tx.driverShift.create({
        data: {
          organizationId: org.organizationId,
          driverId,
          status: startStatus,
          startedAt: now,
          lastStatusChangeAt: now,
          drivingSinceRestSeconds: 0,
        },
      })

      // Первое событие журнала: с какого статуса началась смена. Без него
      // таймлайн начался бы с пустоты и первые минуты не попали бы в итоги.
      await tx.shiftEvent.create({
        data: {
          organizationId: org.organizationId,
          shiftId: created.id,
          type: "status",
          metadata: JSON.stringify({
            from: null,
            to: startStatus,
            seconds: 0,
            bucket: startStatus === "driving" ? "driving" : "waiting",
            orderId: activeOrder?.id ?? null,
            reason: "shift_start",
          }),
        },
      })

      await tx.driver.updateMany({
        where: scopedWhere(org.organizationId, { id: driverId, status: { not: "maintenance" } }),
        data: { status: activeOrder ? "busy" : "available" },
      })

      return created
    })

    const snapshot = await getShiftSnapshot({
      driverId,
      organizationId: org.organizationId,
      now,
    })

    const payload = snapshotPayload(snapshot)
    if (payload.status !== 200) return payload
    const json = await payload.json()
    return NextResponse.json({ ...json, shift: { ...json.shift, id: shift.id } })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shift POST error"
    console.error("[m/shift] POST Error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// PATCH /api/m/shift — смена статуса (совместимость с прежним вызовом)
export async function PATCH(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const body = (await request.json().catch(() => ({}))) as { status?: string }
    if (!body.status) {
      return NextResponse.json({ success: false, error: "status required" }, { status: 400 })
    }

    const result = await changeShiftStatus({
      driverId: auth.value.driver.id,
      organizationId: org.organizationId,
      status: body.status,
    })

    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status })
    }

    return NextResponse.json({ success: true, shift: result.snapshot?.shift, seconds: result.seconds })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shift update error"
    console.error("[m/shift] PATCH Error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// DELETE /api/m/shift — завершение смены
export async function DELETE(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const closed = await closeShift({
      driverId: auth.value.driver.id,
      organizationId: org.organizationId,
    })

    if (!closed.ok) {
      return NextResponse.json({ success: false, error: closed.error }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shift end error"
    console.error("[m/shift] DELETE Error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

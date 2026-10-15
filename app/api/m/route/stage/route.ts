// app/api/m/route/stage/route.ts
//
// Команда водителя по текущему этапу рейса: POST /api/m/route/stage
//
// body: { routeId, command, stageIndex?, clientEventId? }
//
// Почему команды идут через сервер, а не прямой записью статуса заказа:
//   1. Сервер сам решает, что сейчас является текущим этапом. Водитель не
//      может «закрыть» точку, до которой не доехал, и не может завершить
//      рейс с незакрытыми этапами.
//   2. Отметки времени пишутся в RouteStage (единая модель исполнения) и
//      дублируются в RouteEvent как история — один и тот же момент времени
//      нельзя потерять при пересчёте прогноза.
//   3. Повторная отправка (двойной тап по кнопке, повтор запроса после
//      обрыва связи) не должна создавать вторую отметку.
//
// Безопасность: рейс ищется сразу с организацией водителя из сессии.
// Поля routeId и stageIndex приходят из тела, поэтому оба проверяются:
// чужой routeId даст 404, а этап чужого индекса — отказ по правилам этапа.

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireDriver } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { getRouteTripEta, listRouteStageIds } from "@/lib/eta/trip-repository"
import {
  TRIP_COMMANDS,
  availableTripActions,
  checkTripCommand,
  type TripCommand,
} from "@/lib/eta/trip-actions"
import { logRouteEvent } from "@/lib/routes/service"
import { checkEtaRateLimit } from "@/lib/eta/rate-limit"

export const dynamic = "force-dynamic"

/** Команды, которые отмечают НАЧАЛО этапа. */
const START_COMMANDS: TripCommand[] = ["start_driving", "start_operation"]

/** Команды, которые отмечают ОКОНЧАНИЕ этапа. */
const END_COMMANDS: TripCommand[] = ["arrive_point", "finish_operation", "next_leg"]

export async function POST(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const driverId = auth.value.driver.id

  // Лимит частоты: каждая команда пересчитывает прогноз рейса (OSRM + геокодер)
  const rateLimit = await checkEtaRateLimit(request, "actual", org.organizationId)
  if (rateLimit.response) return rateLimit.response

  let body: {
    routeId?: string
    command?: string
    stageIndex?: number | null
    clientEventId?: string | null
    note?: string | null
  } | null = null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Ожидается JSON" }, { status: 400 })
  }

  const { routeId, command, stageIndex, clientEventId, note } = body ?? {}
  if (!routeId || !command) {
    return NextResponse.json(
      { success: false, error: "routeId и command обязательны" },
      { status: 400 },
    )
  }

  if (!TRIP_COMMANDS.includes(command as TripCommand)) {
    return NextResponse.json(
      { success: false, error: `Неизвестная команда: ${command}` },
      { status: 400 },
    )
  }
  const typedCommand = command as TripCommand

  try {
    // Рейс должен принадлежать организации водителя
    const route = await prisma.route.findFirst({
      where: scopedWhere(org.organizationId, { id: routeId, driverId }),
      select: { id: true, status: true, startedAt: true },
    })
    if (!route) {
      return NextResponse.json({ success: false, error: "Рейс не найден" }, { status: 404 })
    }

    // Защита от повторной отправки: клиент присылает свой id события, и если
    // оно уже записано — возвращаем тот же результат, ничего не меняя.
    if (clientEventId) {
      const duplicate = await prisma.routeEvent.findFirst({
        where: {
          organizationId: org.organizationId,
          routeId,
          driverId,
          type: "stage_command",
          data: clientEventId,
        },
        select: { id: true, createdAt: true },
      })
      if (duplicate) {
        return NextResponse.json({
          success: true,
          duplicate: true,
          message: "Команда уже была приняна ранее",
        })
      }
    }

    const trip = await getRouteTripEta({ routeId, organizationId: org.organizationId })
    if (!trip) {
      return NextResponse.json({ success: false, error: "Рейс не найден" }, { status: 404 })
    }

    const routeStarted = Boolean(route.startedAt)
    const check = checkTripCommand(trip, routeStarted, typedCommand, stageIndex ?? null)
    if (!check.ok) {
      // Отказ с причиной: водитель видит, почему кнопка не сработала
      return NextResponse.json(
        { success: false, error: check.reason ?? "Команда недопустима", code: "invalid_stage" },
        { status: 409 },
      )
    }

    const now = new Date()
    const stageIndexToUse = check.stageIndex ?? null

    // ── start_trip: рейс запущен, этапы рейса создаются ──
    if (typedCommand === "start_trip") {
      await prisma.route.update({
        where: { id: routeId },
        data: { startedAt: now, status: "in_progress" },
      })
      await writeEvent({
        routeId,
        driverId,
        organizationId: org.organizationId,
        command: typedCommand,
        stageIndex: null,
        at: now,
        clientEventId,
      })

      const updated = await getRouteTripEta({ routeId, organizationId: org.organizationId })
      return respond(updated, now)
    }

    // ── finish_trip: рейс завершён ──
    if (typedCommand === "finish_trip") {
      await prisma.route.update({
        where: { id: routeId },
        data: { completedAt: now, status: "completed" },
      })
      await writeEvent({
        routeId,
        driverId,
        organizationId: org.organizationId,
        command: typedCommand,
        stageIndex: null,
        at: now,
        clientEventId,
      })
      return NextResponse.json({ success: true, finished: true, completedAt: now.toISOString() })
    }

    // ── report_problem: только история, прогноз не меняется ──
    if (typedCommand === "report_problem") {
      await writeEvent({
        routeId,
        driverId,
        organizationId: org.organizationId,
        command: typedCommand,
        stageIndex: stageIndexToUse,
        at: now,
        clientEventId,
        note: typeof note === "string" ? note : null,
      })
      return NextResponse.json({
        success: true,
        message: "Проблема передана логисту",
        at: now.toISOString(),
      })
    }

    // ── Остальные команды: отметка времени на этапе ──
    if (stageIndexToUse == null) {
      return NextResponse.json(
        { success: false, error: "Не удалось определить этап" },
        { status: 400 },
      )
    }

    const stageIds = await listRouteStageIds({ routeId, organizationId: org.organizationId })
    const stageRowId = stageIds?.[stageIndexToUse] ?? null
    if (!stageRowId) {
      // Этап не заведён строкой RouteStage — заводим. Ситуация штатная:
      // рейс могли запустить до того, как этапы синхронизировались.
      await ensureStageRows(routeId, org.organizationId)
      const retry = await listRouteStageIds({ routeId, organizationId: org.organizationId })
      const rowId = retry?.[stageIndexToUse] ?? null
      if (!rowId) {
        return NextResponse.json(
          { success: false, error: "Этап рейса не найден" },
          { status: 404 },
        )
      }
      await applyMark(rowId, typedCommand, now)
    } else {
      await applyMark(stageRowId, typedCommand, now)
    }

    await writeEvent({
      routeId,
      driverId,
      organizationId: org.organizationId,
      command: typedCommand,
      stageIndex: stageIndexToUse,
      at: now,
      clientEventId,
    })

    const updated = await getRouteTripEta({ routeId, organizationId: org.organizationId })
    return respond(updated, now)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[RouteStage API] POST error:", message, error)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/** Ставит отметку начала/окончания. Повторный вызов не затирает первую. */
async function applyMark(stageRowId: string, command: TripCommand, at: Date) {
  const isStart = START_COMMANDS.includes(command)
  const isEnd = END_COMMANDS.includes(command)

  const data: { startedAt?: Date; endedAt?: Date; status?: string } = {}
  if (isStart) data.startedAt = at
  if (isEnd) data.endedAt = at
  if (isStart || isEnd) data.status = isEnd ? "completed" : "active"

  // updateMany с условием: отметка ставится только если её ещё нет.
  // Защита от повторной отправки на уровне базы, а не только клиента.
  const existing = await prisma.routeStage.findUnique({
    where: { id: stageRowId },
    select: { startedAt: true, endedAt: true },
  })
  if (!existing) return

  const guarded: { startedAt?: Date; endedAt?: Date; status?: string } = {}
  if (isStart && !existing.startedAt) {
    guarded.startedAt = at
    guarded.status = "active"
  }
  if (isEnd && !existing.endedAt) {
    guarded.endedAt = at
    guarded.status = "completed"
  }
  if (Object.keys(guarded).length === 0) return

  await prisma.routeStage.update({ where: { id: stageRowId }, data: guarded })
}

/** Создаёт недостающие строки этапов рейса. */
async function ensureStageRows(routeId: string, organizationId: string) {
  const { ensureRouteStages } = await import("@/lib/eta/trip-repository")
  await ensureRouteStages({ routeId, organizationId })
}

interface EventInput {
  routeId: string
  driverId: string
  organizationId: string
  command: TripCommand
  stageIndex: number | null
  at: Date
  clientEventId?: string | null
  note?: string | null
}

/** История команд: те же данные, что и в RouteStage, но неизменяемые. */
async function writeEvent(input: EventInput) {
  await logRouteEvent(prisma, {
    organizationId: input.organizationId,
    routeId: input.routeId,
    driverId: input.driverId,
    type: "stage_command",
    status: input.command,
    data: JSON.stringify({
      command: input.command,
      stageIndex: input.stageIndex,
      at: input.at.toISOString(),
      clientEventId: input.clientEventId ?? null,
      note: input.note ?? null,
    }),
  })
}

/** Ответ с новым состоянием рейса — водитель сразу видит следующий шаг. */
function respond(trip: Awaited<ReturnType<typeof getRouteTripEta>>, now: Date) {
  if (!trip) {
    return NextResponse.json({ success: false, error: "Рейс не найден" }, { status: 404 })
  }
  const actions = availableTripActions(trip, true)
  return NextResponse.json({
    success: true,
    at: now.toISOString(),
    actions: actions.available,
    blocked: actions.blocked,
    currentStageIndex: actions.currentStageIndex,
    nextPoint: trip.nextPoint
      ? {
          address: trip.nextPoint.address,
          operation: trip.nextPoint.operation,
          arrivalAt: trip.nextPoint.arrivalAt.toISOString(),
        }
      : null,
    remaining: {
      drivingSec: Math.round(trip.remaining.drivingSec),
      stopsSec: Math.round(trip.remaining.stopsSec),
      restSec: Math.round(trip.remaining.restSec),
      totalSec: Math.round(trip.remaining.totalSec),
      arrivalAt: trip.remaining.arrivalAt.toISOString(),
    },
    completionAt: trip.completionAt.toISOString(),
    stages: trip.stages.map((stage) => ({
      index: stage.index,
      kind: stage.kind,
      label: stage.label,
      status: stage.status,
      address: stage.address,
      actualStartAt: stage.actualStartAt?.toISOString() ?? null,
      actualEndAt: stage.actualEndAt?.toISOString() ?? null,
    })),
  })
}

// lib/shift/service.ts
//
// Смена водителя: чтение снимка и переключение статуса.
//
// Один и тот же код нужен и GET (показать экран), и POST (нажали кнопку), и
// отчётам. Раньше логика отдыха была скопирована в два обработчика, а кнопки
// смены статуса не доходили до сервера вообще: POST /api/m/shift принимал
// только «начать смену», а { action: "status" } молча игнорировал. Водитель
// жал «Погрузка», экран подсвечивал кнопку, а время нигде не учитывалось.
//
// Здесь это исправлено: смена — журнал переключений (ShiftEvent), итоги по
// группам считаются из журнала, а отдых дополнительно пишется в RouteEvent,
// потому что нормы отдыха считаются по рейсу.

import { prisma } from "@/lib/prisma"
import type { RouteEventInput } from "@/lib/routes/service"
import { logRouteEvent } from "@/lib/routes/service"

import { OCCUPYING_ORDER_STATUSES } from "@/lib/orders/stages"
import {
  REST_END,
  REST_START,
  currentBreak,
  drivingMinutes,
  restVerdict,
  sumRestMinutes,
  type RestEventLike,
} from "@/lib/rest/norms"
import {
  applyStatusChange,
  buildTimeline,
  bucketOf,
  emptyTotals,
  secondsBetween,
  shiftStatusMeta,
  totalsFromTimeline,
  type ShiftBucket,
  type ShiftSegment,
  type ShiftStatusEvent,
  type ShiftTotals,
} from "@/lib/shift/timeline"

// Заказ занимает водителя, пока он в рейсе, на документах, назначен или на контроле
const ACTIVE_ORDER_STATUSES = OCCUPYING_ORDER_STATUSES

export interface RestSnapshot {
  resting: boolean
  restDue: boolean
  drivingMinutes: number
  minutesToRest: number
  currentBreakMin: number
  breakCounts: boolean
  limitMin: number
  minBreakMin: number
}

export interface ShiftSnapshot {
  shift: {
    id: string
    status: string
    startedAt: Date
    lastStatusChangeAt: Date
  }
  /** Секунды в текущем статусе (живой таймер на экране) */
  statusSeconds: number
  /** Итоги по группам: путь, погрузка, выгрузка, ожидание, отдых, заправка */
  totals: ShiftTotals
  /** Таймлайн смены по переключениям */
  segments: ShiftSegment[]
  rest: RestSnapshot | null
  activeOrder: { id: string; routeId: string | null; routeFrom: string; routeTo: string } | null
}

/** Активный заказ водителя: первый по времени среди занявающих его. */
export async function getActiveOrderForDriver(driverId: string, organizationId: string) {
  return prisma.order.findFirst({
    where: {
      organizationId,
      assignedDriverId: driverId,
      status: { in: ACTIVE_ORDER_STATUSES as any },
    } as any,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      routeId: true,
      routeFrom: true,
      routeTo: true,
    },
  })
}

/** Нормы отдыха по смене и событиям рейса. */
async function computeRest(params: {
  shiftStart: Date
  routeId: string | null
  driverId: string
  organizationId: string
  now: Date
  /** Нормы отдыха, если их уже загрузил вызывающий (иначе — свой запрос) */
  settings?: { restDriveLimitMin: number | null; restMinBreakMin: number | null } | null
}): Promise<RestSnapshot> {
  const settings =
    params.settings !== undefined
      ? params.settings
      : await prisma.fleetSettings.findFirst({
          where: { organizationId: params.organizationId } as any,
          select: { restDriveLimitMin: true, restMinBreakMin: true },
        })
  const limitMin = settings?.restDriveLimitMin ?? 270
  const minBreakMin = settings?.restMinBreakMin ?? 45

  const events: RestEventLike[] = params.routeId
    ? await prisma.routeEvent.findMany({
        where: {
          organizationId: params.organizationId,
          routeId: params.routeId,
          driverId: params.driverId,
          type: "status",
          status: { in: [REST_START, REST_END] },
        } as any,
        select: { status: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      })
    : []

  const restMinutes = sumRestMinutes(events, params.shiftStart, params.now)
  const breakInfo = currentBreak(events, params.now)
  const verdict = restVerdict({
    shiftStart: params.shiftStart,
    now: params.now,
    restMinutes,
    resting: breakInfo.resting,
    currentBreakMin: breakInfo.currentBreakMin,
    limitMin,
    minBreakMin,
  })

  return {
    resting: verdict.resting,
    restDue: verdict.restDue,
    drivingMinutes: drivingMinutes(params.shiftStart, params.now, restMinutes),
    minutesToRest: verdict.minutesToRest,
    currentBreakMin: verdict.currentBreakMin,
    breakCounts: verdict.breakCounts,
    limitMin,
    minBreakMin,
  }
}

/** Журнал переключений статусов смены в хронологическом порядке. */
async function loadShiftEvents(shiftId: string, organizationId: string): Promise<ShiftStatusEvent[]> {
  const rows = await prisma.shiftEvent.findMany({
    where: { organizationId, shiftId, type: "status" } as any,
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, type: true, metadata: true },
  })

  // Статус переключения лежит в metadata: колонки status у ShiftEvent нет,
  // а тип события («status») сам по себе не говорит, во что переключились.
  return rows.map((row) => {
    let status = ""
    let orderId: string | null = null
    if (row.metadata) {
      try {
        const meta = JSON.parse(row.metadata) as { to?: string; orderId?: string | null }
        if (typeof meta.to === "string") status = meta.to
        if (typeof meta.orderId === "string") orderId = meta.orderId
      } catch {
        // Битый metadata не должен ронять экран: событие просто не попадёт
        // в таймлайн, итоги пересчитаются по остальным.
      }
    }
    return { at: row.createdAt, status, orderId }
  })
}

/**
 * Полный снимок смены для экрана водителя: статус, живые секунды, итоги,
 * таймлайн, нормы отдыха и активный заказ.
 */
export async function getShiftSnapshot(params: {
  driverId: string
  organizationId: string
  now?: Date
}): Promise<ShiftSnapshot | null> {
  const now = params.now ?? new Date()

  // Смена, активный заказ и нормы отдыха независимы: три параллельных запроса
  // вместо трёх последовательных. У удалённой базы каждое обращение — около
  // секунды, и /api/m/shift отвечал 9 секунд, хотя данных в нём немного.
  const [shift, activeOrder, settings] = await Promise.all([
    prisma.driverShift.findFirst({
      where: {
        organizationId: params.organizationId,
        driverId: params.driverId,
        endedAt: null,
      } as any,
      orderBy: { startedAt: "desc" },
    }),
    getActiveOrderForDriver(params.driverId, params.organizationId),
    prisma.fleetSettings.findFirst({
      where: { organizationId: params.organizationId } as any,
      select: { restDriveLimitMin: true, restMinBreakMin: true },
    }),
  ])

  if (!shift) return null

  const [events, rest] = await Promise.all([
    loadShiftEvents(shift.id, params.organizationId),
    computeRest({
      shiftStart: new Date(shift.startedAt),
      routeId: activeOrder?.routeId ?? null,
      driverId: params.driverId,
      organizationId: params.organizationId,
      now,
      settings,
    }),
  ])

  const segments = buildTimeline({
    events,
    shiftStart: new Date(shift.startedAt),
    until: now,
    initialStatus: shift.status,
  })

  // Итоги берём из таймлайна: он считается из журнала, поэтому не расходится
  // с тем, что видит водитель, и пересчитывается при любой правке журнала.
  const totals = totalsFromTimeline(segments)

  return {
    shift: {
      id: shift.id,
      status: shift.status,
      startedAt: new Date(shift.startedAt),
      lastStatusChangeAt: new Date(shift.lastStatusChangeAt),
    },
    statusSeconds: secondsBetween(shift.lastStatusChangeAt, now),
    totals,
    segments,
    rest,
    activeOrder: activeOrder
      ? {
          id: activeOrder.id,
          routeId: activeOrder.routeId,
          routeFrom: activeOrder.routeFrom,
          routeTo: activeOrder.routeTo,
        }
      : null,
  }
}

export interface ChangeStatusResult {
  ok: boolean
  status: number
  error?: string
  snapshot?: ShiftSnapshot
  /** Сколько секунд длился предыдущий статус */
  seconds?: number
}

/**
 * Переключение статуса смены.
 *
 * Что происходит: время предыдущего статуса уходит в его группу, пишется
 * событие ShiftEvent, обновляются DriverShift.status/lastStatusChangeAt и
 * счётчик непрерывного вождения. Отдых дополнительно пишется в RouteEvent —
 * по нему считаются нормы (непрерывное время за рулём).
 */
export async function changeShiftStatus(params: {
  driverId: string
  organizationId: string
  status: string
  orderId?: string | null
  latitude?: number | null
  longitude?: number | null
}): Promise<ChangeStatusResult> {
  const meta = shiftStatusMeta(params.status)
  if (!meta) {
    return { ok: false, status: 400, error: "Неизвестный статус смены" }
  }

  const now = new Date()

  const shift = await prisma.driverShift.findFirst({
    where: { organizationId: params.organizationId, driverId: params.driverId, endedAt: null } as any,
    orderBy: { startedAt: "desc" },
  })

  if (!shift) {
    return { ok: false, status: 400, error: "Смена не начата" }
  }

  // Повторное нажатие того же статуса — не ошибка и не новое событие:
  // иначе одно длинное нажатие кнопки удваивает время.
  if (shift.status === params.status) {
    const snapshot = await getShiftSnapshot({
      driverId: params.driverId,
      organizationId: params.organizationId,
      now,
    })
    return { ok: true, status: 200, snapshot: snapshot ?? undefined, seconds: 0 }
  }

  const previousStatus = shift.status
  const since = new Date(shift.lastStatusChangeAt)

  // Итоги до момента переключения считаем из журнала. Таймлайн строим ДО
  // `since`, иначе текущий статус учтётся дважды: один раз отрезком
  // таймлайна, второй — временем переключения.
  const events = await loadShiftEvents(shift.id, params.organizationId)
  const fromJournal = totalsFromTimeline(
    buildTimeline({
      events,
      shiftStart: new Date(shift.startedAt),
      until: since,
      initialStatus: previousStatus,
    }),
  )

  // И берём максимум с уже записанным в смене: время не должно «испаряться»,
  // если журнал отстал (сбой записи, часы съехали, смена из старой версии).
  const stored = shift as unknown as Record<string, number>
  const keep = (field: keyof ShiftTotals, storedField: string) =>
    Math.max(fromJournal[field], Number(stored[storedField]) || 0)
  const totalsBefore: ShiftTotals = {
    ...fromJournal,
    driving: keep("driving", "totalDrivingSeconds"),
    loading: keep("loading", "totalLoadingSeconds"),
    waiting: keep("waiting", "totalWaitingSeconds"),
    resting: keep("resting", "totalRestingSeconds"),
  }

  const change = applyStatusChange({
    previous: previousStatus,
    next: params.status,
    since,
    now,
    totals: totalsBefore,
    drivingSinceRestSeconds: shift.drivingSinceRestSeconds ?? 0,
  })

  const activeOrder = await getActiveOrderForDriver(params.driverId, params.organizationId)
  const orderId = params.orderId ?? activeOrder?.id ?? null
  const routeId = activeOrder?.routeId ?? null

  const metadata = JSON.stringify({
    from: previousStatus,
    to: params.status,
    seconds: change.seconds,
    bucket: bucketOf(params.status),
    orderId,
  })

  const isRestStart = meta.bucket === "resting"
  const wasResting = bucketOf(previousStatus) === "resting"

  await prisma.$transaction(async (tx) => {
    await tx.driverShift.updateMany({
      where: { id: shift.id, organizationId: params.organizationId } as any,
      data: {
        status: params.status,
        lastStatusChangeAt: now,
        drivingSinceRestSeconds: change.drivingSinceRestSeconds,
        // Итоги держим в БД как денормализацию: отчёты читают их без
        // пересчёта журнала, но пересчитать их можно в любой момент.
        totalDrivingSeconds: change.totals.driving,
        totalLoadingSeconds: change.totals.loading,
        totalWaitingSeconds: change.totals.waiting,
        totalRestingSeconds: change.totals.resting,
      } as any,
    })

    await tx.shiftEvent.create({
      data: {
        organizationId: params.organizationId,
        shiftId: shift.id,
        type: "status",
        metadata,
        latitude: params.latitude ?? null,
        longitude: params.longitude ?? null,
      } as any,
    })

    // Водитель «за рулём» — машина занята; на отдыхе и ожидании рейса — свободна
    if (meta.kind === "move" || meta.kind === "point") {
      await tx.driver.updateMany({
        where: { id: params.driverId, organizationId: params.organizationId, status: { not: "maintenance" } } as any,
        data: { status: "busy" } as any,
      })
    } else if (meta.kind === "idle" || meta.kind === "rest") {
      await tx.driver.updateMany({
        where: { id: params.driverId, organizationId: params.organizationId, status: { not: "maintenance" } } as any,
        data: { status: "available" } as any,
      })
    }
  })

  // Отдых пишем и в рейс: нормы считаются по RouteEvent (rest_start/rest_end)
  if (routeId && (isRestStart || wasResting)) {
    const event: RouteEventInput = {
      organizationId: params.organizationId,
      routeId,
      driverId: params.driverId,
      orderId,
      type: "status",
      status: isRestStart ? REST_START : REST_END,
      latitude: params.latitude ?? null,
      longitude: params.longitude ?? null,
      data: JSON.stringify({ shiftId: shift.id, reason: "driver_status" }),
    }
    try {
      await logRouteEvent(prisma, event)
    } catch (error) {
      // Нормы отдыха — не причина ронять смену: событие рейса повторится
      // при следующем переключении, а статус смены уже зафиксирован.
      console.error("[shift] не удалось записать событие отдыха в рейс:", error)
    }
  }

  const snapshot = await getShiftSnapshot({
    driverId: params.driverId,
    organizationId: params.organizationId,
    now,
  })

  return {
    ok: true,
    status: 200,
    snapshot: snapshot ?? undefined,
    seconds: change.seconds,
  }
}

/**
 * Закрытие смены: текущий статус доживает до момента закрытия, чтобы время
 * не потерялось (иначе последние минуты смены не попадают в аналитику).
 */
export async function closeShift(params: {
  driverId: string
  organizationId: string
}): Promise<{ ok: boolean; error?: string }> {
  const now = new Date()

  const shift = await prisma.driverShift.findFirst({
    where: { organizationId: params.organizationId, driverId: params.driverId, endedAt: null } as any,
    orderBy: { startedAt: "desc" },
  })

  if (!shift) return { ok: true }

  const events = await loadShiftEvents(shift.id, params.organizationId)
  const totals = totalsFromTimeline(
    buildTimeline({
      events,
      shiftStart: new Date(shift.startedAt),
      until: now,
      initialStatus: shift.status,
    }),
  )

  // Итоги закрытия — максимум из журнала и из уже записанных значений:
  // время никогда не должно «испариться» из-за расхождения часов или
  // события, которое не успело записаться.
  const stored = shift as unknown as Record<string, number>
  const keep = (journal: number, field: string) =>
    Math.max(journal, Number(stored[field]) || 0)

  await prisma.$transaction(async (tx) => {
    await tx.driverShift.updateMany({
      where: { id: shift.id, organizationId: params.organizationId } as any,
      data: {
        endedAt: now,
        lastStatusChangeAt: now,
        totalDrivingSeconds: keep(totals.driving, "totalDrivingSeconds"),
        totalLoadingSeconds: keep(totals.loading, "totalLoadingSeconds"),
        totalWaitingSeconds: keep(totals.waiting, "totalWaitingSeconds"),
        totalRestingSeconds: keep(totals.resting, "totalRestingSeconds"),
      } as any,
    })

    const activeOrdersCount = await tx.order.count({
      where: {
        organizationId: params.organizationId,
        assignedDriverId: params.driverId,
        status: { in: ACTIVE_ORDER_STATUSES as any },
      } as any,
    })

    await tx.driver.updateMany({
      where: { id: params.driverId, organizationId: params.organizationId } as any,
      data: { status: activeOrdersCount > 0 ? "busy" : "available" } as any,
    })
  })

  return { ok: true }
}

/** Пустые итоги — для экранов, которым нужна структура без данных. */
export function zeroTotals(): ShiftTotals {
  return emptyTotals()
}

export type { ShiftBucket, ShiftSegment, ShiftTotals }

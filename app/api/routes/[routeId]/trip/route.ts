// app/api/routes/[id]/trip/route.ts
//
// Единый прогноз по рейсу: GET /api/routes/:id/trip
//
// Один эндпоинт на всех потребителей — кабинет водителя, карту логиста,
// помощник сборки и оптимизатор. До него каждый считал ETA сам:
//   * /api/m/route/events — свои коэффициенты и distance/60;
//   * карточка рейса — buildRouteEtaPreview в браузере;
//   * превью в заказах — свои коэффициенты.
// Из-за этого один рейс получал три разных времени прибытия.
//
// Расчёт идёт через lib/eta/trip.ts (временная шкала этапов), загрузка данных —
// через lib/eta/trip-repository.ts. Своей формулы ETA в этом файле нет.
//
// Безопасность: организация берётся из проверенной сессии, рейс ищется сразу
// с организацией в условии. Чужой id даёт 404, а не прогноз.

import { NextRequest, NextResponse } from "next/server"

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization, notFoundInOrganization } from "@/lib/org"
import { getRouteTripEta } from "@/lib/eta/trip-repository"
import { checkEtaRateLimit } from "@/lib/eta/rate-limit"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ routeId: string }> },
) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error
  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  const { routeId } = await context.params

  // ensureStages=1 — привести строки RouteStage в соответствие заказам рейса.
  // Идемпотентно: существующие этапы не перезаписываются.
  const ensureStages = request.nextUrl.searchParams.get("ensureStages") === "1"
  // returnToBase=0 — рейс без возврата на базу (например, смена водителя)
  const returnToBase = request.nextUrl.searchParams.get("returnToBase") !== "0"

  const trip = await getRouteTripEta({
    routeId,
    organizationId: org.organizationId,
    ensureStages,
    returnToBase,
  })

  if (!trip) return notFoundInOrganization("Рейс")

  return NextResponse.json({
    routeId,
    modelVersion: trip.modelVersion,
    calculatedAt: trip.calculatedAt.toISOString(),
    now: trip.now.toISOString(),
    currentStageIndex: trip.currentStageIndex,
    nextStageIndex: trip.nextStageIndex,
    nextPoint: trip.nextPoint
      ? {
          address: trip.nextPoint.address,
          operation: trip.nextPoint.operation,
          orderId: trip.nextPoint.orderId,
          distanceM: trip.nextPoint.distanceM,
          drivingSec: Math.round(trip.nextPoint.drivingSec),
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
    returnToBase: trip.returnToBase
      ? {
          address: trip.returnToBase.address,
          distanceM: trip.returnToBase.distanceM,
          drivingSec: Math.round(trip.returnToBase.drivingSec),
          arrivalAt: trip.returnToBase.arrivalAt.toISOString(),
        }
      : null,
    totalRemainingSec: Math.round(trip.totalRemainingSec),
    completionAt: trip.completionAt.toISOString(),
    scenarios: {
      optimistic: { totalSec: Math.round(trip.scenarios.optimistic.totalSec) },
      base: { totalSec: Math.round(trip.scenarios.base.totalSec) },
      conservative: { totalSec: Math.round(trip.scenarios.conservative.totalSec) },
    },
    confidence: trip.confidence,
    factors: trip.factors,
    dataQuality: trip.dataQuality,
    sources: trip.sources,
    reliable: trip.reliable,
    reliabilityNote: trip.reliabilityNote,
    stages: trip.stages.map((stage) => ({
      index: stage.index,
      kind: stage.kind,
      label: stage.label,
      status: stage.status,
      sequence: stage.sequence,
      orderId: stage.orderId,
      address: stage.address,
      distanceM: stage.distanceM,
      plannedStartAt: stage.plannedStartAt?.toISOString() ?? null,
      plannedEndAt: stage.plannedEndAt?.toISOString() ?? null,
      actualStartAt: stage.actualStartAt?.toISOString() ?? null,
      actualEndAt: stage.actualEndAt?.toISOString() ?? null,
      durationSec: stage.durationSec != null ? Math.round(stage.durationSec) : null,
      stopMinutes: stage.stop?.minutes ?? null,
      stopSource: stage.stop?.source ?? null,
      drivingSec: stage.segment?.drivingSec != null ? Math.round(stage.segment.drivingSec) : null,
      roadClass: stage.segment?.roadClass ?? null,
      corrections: stage.segment?.corrections ?? [],
      blocked: stage.segment?.blocked ?? false,
      completed: stage.completed,
      current: stage.current,
    })),
  })
}

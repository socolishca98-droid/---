// app/api/eta/metrics/route.ts
// Точность прогноза по фактическим рейсам: GET /api/eta/metrics
//
// Здесь измеряется, стал ли прогноз лучше. Без этих цифр «улучшение ETA» —
// набор мнений: непонятно, куда двигаться дальше.
//
// Важно: эндпоинт только ИЗМЕРЯЕТ. Коэффициенты он не переписывает — решение
// о пересмотре принимает человек, и только когда выборки достаточно
// (MIN_SAMPLES_FOR_RECALIBRATION рейсов). Иначе на трёх рейсах можно
// «настроить» модель в полную бесполезность.

import { NextRequest, NextResponse } from "next/server"

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization } from "@/lib/org"
import { listForecastFacts } from "@/lib/eta/repository"
import { checkEtaRateLimit } from "@/lib/eta/rate-limit"
import {
  breakdownBy,
  calculateAccuracyMetrics,
  MIN_SAMPLES_FOR_RECALIBRATION,
} from "@/lib/eta/metrics"

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error
  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response
  const rateLimit = await checkEtaRateLimit(request, "metrics", org.organizationId)
  if (rateLimit.response) return rateLimit.response

  const { searchParams } = new URL(request.url)
  const days = Number(searchParams.get("days") || "90")
  const since = Number.isFinite(days) && days > 0
    ? new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    : undefined

  // Выборка фактов — строго в пределах организации
  const facts = await listForecastFacts(org.organizationId, {
    since,
    limit: 1000,
  })

  const overall = calculateAccuracyMetrics(facts)

  return NextResponse.json({
    periodDays: days ?? null,
    sampleCount: overall.sampleCount,
    // Достаточно ли данных, чтобы человек начал пересмотр коэффициентов
    recalibrationReady: overall.recalibrationReady,
    recalibrationThreshold: MIN_SAMPLES_FOR_RECALIBRATION,
    metrics: {
      maeMinutes: overall.maeMinutes,
      medianAbsErrorMinutes: overall.medianAbsErrorMinutes,
      within15Minutes: overall.within15Minutes,
      within30Minutes: overall.within30Minutes,
      // Положительная — систематически опаздываем, отрицательная — спешим
      biasMinutes: overall.biasMinutes,
      drivingBiasMinutes: overall.drivingBiasMinutes,
      outliersExcluded: overall.outliersExcluded,
    },
    // Разбивки: где именно прогноз врёт
    byRoadClass: breakdownBy(facts, "roadClass").map((row) => ({
      group: row.group,
      maeMinutes: row.metrics.maeMinutes,
      sampleCount: row.metrics.sampleCount,
      biasMinutes: row.metrics.biasMinutes,
    })),
    bySeason: breakdownBy(facts, "season").map((row) => ({
      group: row.group,
      maeMinutes: row.metrics.maeMinutes,
      sampleCount: row.metrics.sampleCount,
      biasMinutes: row.metrics.biasMinutes,
    })),
    byWeather: breakdownBy(facts, "weatherCondition").map((row) => ({
      group: row.group,
      maeMinutes: row.metrics.maeMinutes,
      sampleCount: row.metrics.sampleCount,
      biasMinutes: row.metrics.biasMinutes,
    })),
    note:
      overall.sampleCount === 0
        ? "Фактов ещё нет: сохраняйте прогноз (routeId в POST /api/eta/forecast) и записывайте прибытие фактом"
        : undefined,
  })
}

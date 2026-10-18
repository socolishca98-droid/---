import { forecastSegments } from "../lib/eta/forecast.js"
import type { RouteSegment } from "../lib/eta/segments.js"

function seg(index: number, km: number): RouteSegment {
  const distanceM = km * 1000
  return {
    index, from: { lat: 55 + index, lng: 37 + index }, to: { lat: 55.1 + index, lng: 37.1 },
    distanceM, baseDurationSec: (km / 65) * 3600,
    roadClass: { class: "federal", label: "федеральная трасса", confidence: 0.9, reason: "probe" },
    baseSpeedKmh: 65, speedSource: "table", osrmSpeedKmh: 65,
    freeFlowSec: (km / 65) * 3600, roadName: `участок ${index}`,
  }
}

// 6 × 100 км = 600 мин движения: перерыв после 270 мин (сегмент 2), смена после 600 (сегмент 5)
const segments = [0, 1, 2, 3, 4, 5].map((i) => seg(i, 100))
const r = forecastSegments(segments, {
  departure: new Date(Date.UTC(2026, 0, 12, 0, 0)),
  timeZone: "UTC",
})

console.log("=== ПЕРЕРЫВЫ В ЧАСАХ ===")
console.log("перерывы:", r.rest.breaks.map((b) => `после сегмента ${b.afterSegmentIndex + 1}: ${b.minutes} мин (${b.kind})`).join("; "))
console.log("итого пауз:", r.rest.totalMinutes, "мин")
console.log("driving:", Math.round(r.scenarios.base.drivingSec / 60), "мин | restSec:", r.scenarios.base.restSec / 60, "мин | total:", Math.round(r.scenarios.base.totalSec / 60), "мин")
console.log()
for (const s of r.segments) {
  console.log(`  сегм ${s.index + 1}: прибытие ${s.arrivalAt.toISOString().slice(11, 16)} выезд ${s.departureAt.toISOString().slice(11, 16)} движение ${Math.round(s.drivingSec / 60)} мин`)
}
const last = r.segments[r.segments.length - 1]
console.log()
console.log("выход из последнего сегмента:", last.departureAt.toISOString())
console.log("arrivalAt базового сценария:  ", r.scenarios.base.arrivalAt.toISOString())
console.log("совпадают:", last.departureAt.getTime() === r.scenarios.base.arrivalAt.getTime())
console.log("optimistic total:", Math.round(r.scenarios.optimistic.totalSec / 60), "мин | conservative:", Math.round(r.scenarios.conservative.totalSec / 60), "мин")

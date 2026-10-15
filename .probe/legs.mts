import { forecastSegments } from "../lib/eta/forecast.js"
import type { RouteSegment } from "../lib/eta/segments.js"
function seg(index: number, km: number): RouteSegment {
  const distanceM = km * 1000
  return { index, from: { lat: 55, lng: 37 }, to: { lat: 55.1, lng: 37.1 }, distanceM,
    baseDurationSec: (km / 65) * 3600,
    roadClass: { class: "federal" as const, label: "федеральная трасса", confidence: 0.9, reason: "t" },
    baseSpeedKmh: 65, speedSource: "table" as const, osrmSpeedKmh: 65, freeFlowSec: (km / 65) * 3600, roadName: "плечо" }
}
for (const count of [3, 4, 5, 6]) {
  const segs = Array.from({ length: count }, (_, i) => seg(i, 100))
  const r = forecastSegments(segs, { departure: new Date(Date.UTC(2026, 9, 15, 0, 0)), timeZone: "UTC" })
  console.log(`${count} плеч: движение/плечо=${Math.round(r.segments[0].drivingSec/60)}мин, перерывов=${r.rest.breaks.length} [${r.rest.breaks.map(b=>`${b.kind}@${b.afterSegmentIndex+1}:${b.minutes}`).join(", ")}], restSec=${r.scenarios.base.restSec/60}`)
}

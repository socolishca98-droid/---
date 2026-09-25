"use client"

// components/routes/route-segments-map.tsx
//
// Один рейс — одна линия: заказы внутри рейса показаны цветными сегментами
// (решение задачи 2: «несколько заказов в одном рейсе = один маршрут с
// цветными сегментами по заказам»).
//
// Данные приходят готовыми с сервера (GET /api/routes/[routeId]/map): сегменты
// с геометрией дороги от OSRM, координаты городов — из кэша/Nominatim. Карта
// запрашивает их только когда её открыли, чтобы не тратить лимиты внешних
// сервисов на каждый показ списка рейсов.
//
// Компонент подключается через dynamic(..., { ssr: false }): leaflet работает
// только в браузере.

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Loader2, MapPin, TriangleAlert } from "lucide-react"
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet"
import L from "leaflet"
import "leaflet/dist/leaflet.css"

/** Палитра сегментов: сервер отдаёт только номер цвета в этом списке. */
export const SEGMENT_COLORS = [
  "#22c55e",
  "#3b82f6",
  "#f59e0b",
  "#a855f7",
  "#ef4444",
  "#06b6d4",
  "#84cc16",
  "#f97316",
]

type Segment = {
  orderId: string
  sequence: number
  from: string
  to: string
  status: string
  statusLabel: string
  colorIndex: number
  isAdditionalLoad: boolean
  distanceKm: number | null
  durationMin: number | null
  geometry: [number, number][]
  source: "osrm" | "line" | "none"
}

type MapPayload = {
  success: boolean
  error?: string
  message?: string
  segments: Segment[]
  bounds: [[number, number], [number, number]] | null
  problems: string[]
}

/** Нумерованная точка без картинок: у leaflet с иконками по умолчанию
 *  ломаются пути к файлам при сборке бандла. */
function numberIcon(number: number, color: string) {
  return L.divIcon({
    className: "route-segment-marker",
    html: `<div style="
      display:flex;align-items:center;justify-content:center;
      width:26px;height:26px;border-radius:9999px;
      background:${color};color:#fff;font-weight:600;font-size:12px;
      border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);
    ">${number}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}

/** Подгоняет карту под все сегменты, когда данные пришли или изменились. */
function FitBounds({ bounds }: { bounds: MapPayload["bounds"] }) {
  const map = useMap()

  useEffect(() => {
    if (!bounds) return
    const [[minLat, minLng], [maxLat, maxLng]] = bounds
    // один и тот же город в начале и конце — не растягиваем карту в точку
    if (minLat === maxLat && minLng === maxLng) {
      map.setView([minLat, minLng], 8)
      return
    }
    map.fitBounds(
      [
        [minLat, minLng],
        [maxLat, maxLng],
      ],
      { padding: [32, 32] },
    )
  }, [bounds, map])

  return null
}

export function RouteSegmentsMap({ routeId, className }: { routeId: string; className?: string }) {
  const [data, setData] = useState<MapPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/routes/${routeId}/map`, { cache: "no-store" })
        const payload = (await response.json()) as MapPayload
        if (!active) return
        if (!response.ok || !payload.success) {
          setError(payload.error || "Не удалось построить маршрут")
          return
        }
        setData(payload)
      } catch {
        if (active) setError("Не удалось построить маршрут")
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [routeId])

  const segments = useMemo(
    () => (data?.segments ?? []).filter((segment) => segment.geometry.length >= 2),
    [data],
  )

  if (loading) {
    return (
      <div className={className}>
        <div className="flex h-[280px] items-center justify-center rounded-lg border bg-muted/30 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Строим линию рейса: координаты городов и дорога…
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={className}>
        <div className="flex h-[160px] items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <TriangleAlert className="mr-2 h-4 w-4" />
          {error}
        </div>
      </div>
    )
  }

  if (segments.length === 0) {
    return (
      <div className={className}>
        <div className="flex h-[160px] flex-col items-center justify-center gap-1 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          <MapPin className="h-5 w-5" />
          {data?.message || "Нет точек с координатами"}
          {data && data.problems.length > 0 && (
            <span className="text-xs">
              Не удалось определить координаты: {data.problems.join(", ")}
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      <div className="h-[320px] w-full overflow-hidden rounded-lg border">
        <MapContainer
          bounds={data?.bounds ?? undefined}
          scrollWheelZoom={false}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="© OpenStreetMap"
          />
          <FitBounds bounds={data?.bounds ?? null} />

          {segments.map((segment) => {
            const color = SEGMENT_COLORS[segment.colorIndex % SEGMENT_COLORS.length]
            return (
              <Polyline
                key={segment.orderId}
                positions={segment.geometry}
                pathOptions={{
                  color,
                  weight: 5,
                  opacity: 0.9,
                  // прямая вместо дороги — пунктиром, чтобы это было заметно
                  dashArray: segment.source === "osrm" ? undefined : "6 8",
                }}
              >
                <Tooltip sticky>
                  {segment.from} → {segment.to}
                  {segment.distanceKm ? ` · ${segment.distanceKm} км` : ""}
                </Tooltip>
              </Polyline>
            )
          })}
          {segments.map((segment) => {
            const color = SEGMENT_COLORS[segment.colorIndex % SEGMENT_COLORS.length]
            const start = segment.geometry[0]
            return (
              <Marker
                key={`marker-${segment.orderId}`}
                position={start}
                icon={numberIcon(segment.sequence, color)}
              >
                <Popup>
                  <div className="space-y-1 text-sm">
                    <div className="font-medium">
                      Точка {segment.sequence}: {segment.from} → {segment.to}
                    </div>
                    <div className="text-muted-foreground">
                      {segment.statusLabel}
                      {segment.isAdditionalLoad ? " · догруз" : ""}
                      {segment.distanceKm ? ` · ${segment.distanceKm} км` : ""}
                      {segment.durationMin ? ` · ~${Math.round(segment.durationMin / 60)} ч` : ""}
                    </div>
                    <Link
                      href={`/orders/${segment.orderId}`}
                      className="text-primary underline underline-offset-2"
                    >
                      Карточка заказа
                    </Link>
                  </div>
                </Popup>
              </Marker>
            )
          })}
        </MapContainer>
      </div>

      {/* Легенда: какой цвет какому заказу соответствует */}
      <ul className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
        {segments.map((segment) => (
          <li key={`legend-${segment.orderId}`} className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-6 rounded-full"
              style={{ background: SEGMENT_COLORS[segment.colorIndex % SEGMENT_COLORS.length] }}
            />
            <span className="truncate">
              {segment.sequence}. {segment.from} → {segment.to}
              {segment.isAdditionalLoad ? " (догруз)" : ""}
            </span>
          </li>
        ))}
      </ul>

      {segments.some((segment) => segment.source === "line") && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          Пунктиром показаны сегменты, для которых дорогу получить не удалось —
          линия проведена по прямой между городами.
        </p>
      )}
      {data && data.problems.length > 0 && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          Не удалось определить координаты: {data.problems.join(", ")}. Проверьте
          название города в заказе.
        </p>
      )}
    </div>
  )
}

export default RouteSegmentsMap

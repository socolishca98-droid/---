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

import { Fragment, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Clock, Loader2, MapPin, PackageOpen, TriangleAlert } from "lucide-react"
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
  route?: { id: string; name: string; status: string }
  segments: Segment[]
  bounds: [[number, number], [number, number]] | null
  problems: string[]
  /** Ближайший дедлайн незакрытых заказов — для живого таймера рейса. */
  eta?: { deadline: string; city: string } | null
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

/** Гаверсинус, км — для равномерной скорости анимации. */
function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371
  const dLat = ((b[0] - a[0]) * Math.PI) / 180
  const dLng = ((b[1] - a[1]) * Math.PI) / 180
  const lat1 = (a[0] * Math.PI) / 180
  const lat2 = (b[0] * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Фургон-плашка; flip — едет влево. */
function truckIcon(flip: boolean): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<span style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9999px;background:#fff;border:2px solid #2563eb;box-shadow:0 3px 10px rgba(0,0,0,.45);transform:scaleX(${flip ? -1 : 1});transition:transform .3s;">
      <svg viewBox="0 0 34 20" width="22" height="13" aria-hidden="true">
        <rect x="1" y="2" width="20" height="12" rx="2" fill="#2563eb"/>
        <path d="M22 5.5h6.2l4.3 4.2V14H22z" fill="#1e40af"/>
        <rect x="23.5" y="6.5" width="4" height="3.4" rx=".6" fill="#dbeafe"/>
        <circle cx="8" cy="15.5" r="3.1" fill="#0f172a" stroke="#fff" stroke-width="1.6"/>
        <circle cx="26" cy="15.5" r="3.1" fill="#0f172a" stroke="#fff" stroke-width="1.6"/>
      </svg>
    </span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  })
}

/**
 * Грузовик, едущий по активному плечу: позиция — интерполяция по длине
 * геометрии, скорость визуальная (не телеметрия!). Реального положения
 * машины у нас нет, и превью не должно притворяться данными: это движение
 * ВДОЛЬ маршрута, а не «где машина».
 */
function TruckOnSegment({ geometry }: { geometry: [number, number][] }) {
  const map = useMap()

  useEffect(() => {
    if (geometry.length < 2) return
    const marker = L.marker(geometry[0], {
      icon: truckIcon(false),
      interactive: false,
      keyboard: false,
      zIndexOffset: 1000,
    }).addTo(map)

    const cum: number[] = [0]
    for (let i = 1; i < geometry.length; i += 1) {
      cum.push(cum[i - 1] + haversineKm(geometry[i - 1], geometry[i]))
    }
    const totalKm = cum[cum.length - 1]
    if (totalKm <= 0) {
      return () => {
        marker.remove()
      }
    }

    const LOOP_MS = 12000
    const startedAt = performance.now()
    let frame = 0
    let lastFlip = false
    const tick = () => {
      const progress = ((performance.now() - startedAt) % LOOP_MS) / LOOP_MS
      const target = progress * totalKm
      let i = 1
      while (i < cum.length - 1 && cum[i] < target) i += 1
      const share = (target - cum[i - 1]) / Math.max(cum[i] - cum[i - 1], 1e-9)
      const lat = geometry[i - 1][0] + (geometry[i][0] - geometry[i - 1][0]) * share
      const lng = geometry[i - 1][1] + (geometry[i][1] - geometry[i - 1][1]) * share
      marker.setLatLng([lat, lng])
      const flip = geometry[i][1] < geometry[i - 1][1]
      if (flip !== lastFlip) {
        marker.setIcon(truckIcon(flip))
        lastFlip = flip
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      marker.remove()
    }
  }, [geometry, map])

  return null
}

/** Пульс точки погрузки: рейс назначен, машина грузится — точка «дышит». */
function LoadingPulse({ position, color }: { position: [number, number]; color: string }) {
  const map = useMap()

  useEffect(() => {
    const marker = L.marker(position, {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: "",
        html: `<span class="route-pulse" style="display:block;width:26px;height:26px;border-radius:9999px;background:${color};"></span>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      }),
    }).addTo(map)
    return () => {
      marker.remove()
    }
  }, [position, color, map])

  return null
}

/** «4 ч 12 мин» из миллисекунд — без минут-часов словами, это таймер. */
function spanLabel(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60000)
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24) return rest > 0 ? `${hours} ч ${rest} мин` : `${hours} ч`
  const days = Math.floor(hours / 24)
  return `${days} д ${hours % 24} ч`
}

/** Живой таймер до ближайшей выгрузки: обновляется каждые 30 секунд. */
function EtaTimer({ eta }: { eta: { deadline: string; city: string } }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      window.clearInterval(timer)
    }
  }, [])

  const deadline = new Date(eta.deadline).getTime()
  const left = deadline - now
  const late = left < 0
  const short = eta.city.split(",")[0]

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium ${
        late
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-primary/30 bg-primary/[0.07] text-primary"
      }`}
    >
      <Clock className="h-3.5 w-3.5" />
      {late ? (
        <>опоздание к выгрузке в {short}: {spanLabel(left)}</>
      ) : (
        <>до выгрузки в {short}: {spanLabel(left)}</>
      )}
    </span>
  )
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

  // Рейс в пути: грузовик едет по первому открытому плечу, оно же помечено
  // «муравьями». Рейс назначен (погрузка): точка погрузки пульсирует.
  const routeStatus = data?.route?.status ?? ""
  const activeSegment =
    routeStatus === "in_transit"
      ? segments.find((segment) => segment.status === "in_route") ?? null
      : null
  const loadingNow =
    routeStatus === "active" && segments.length > 0 ? segments[0] : null

  return (
    <div className={className}>
      {/* Таймер рейса: сколько ещё машине ехать — вопрос №1 всякий раз,
          когда карту открыли. Считается по дедлайну заказа, живой. */}
      {data?.eta ? (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <EtaTimer eta={data.eta} />
          {loadingNow ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[13px] font-medium text-amber-700 dark:text-amber-300">
              <PackageOpen className="h-3.5 w-3.5" />
              идёт погрузка в {loadingNow.from.split(",")[0]}
            </span>
          ) : null}
        </div>
      ) : null}
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
              <Fragment key={`group-${segment.orderId}`}>
                {/* Кант: линия читается поверх любой застройки и в тёмной теме */}
                <Polyline
                  positions={segment.geometry}
                  pathOptions={{
                    color: "#0f172a",
                    weight: 9,
                    opacity: 0.5,
                    lineCap: "round",
                    lineJoin: "round",
                  }}
                />
                <Polyline
                  positions={segment.geometry}
                  pathOptions={{
                    color,
                    weight: 5,
                    opacity: 0.95,
                    // прямая вместо дороги — пунктиром, чтобы это было заметно
                    dashArray: segment.source === "osrm" ? undefined : "6 8",
                  }}
                >
                  <Tooltip sticky>
                    {segment.from} → {segment.to}
                    {segment.distanceKm ? ` · ${segment.distanceKm} км` : ""}
                  </Tooltip>
                </Polyline>
                {/* Активное плечо: «муравьи» показывают направление движения */}
                {activeSegment?.orderId === segment.orderId ? (
                  <Polyline
                    positions={segment.geometry}
                    pathOptions={{
                      color: "#ffffff",
                      weight: 2,
                      opacity: 0.9,
                      dashArray: "2 14",
                      lineCap: "round",
                      className: "route-ants",
                    }}
                  />
                ) : null}
              </Fragment>
            )
          })}
          {activeSegment ? <TruckOnSegment geometry={activeSegment.geometry} /> : null}
          {loadingNow ? (
            <LoadingPulse
              position={loadingNow.geometry[0]}
              color={SEGMENT_COLORS[loadingNow.colorIndex % SEGMENT_COLORS.length]}
            />
          ) : null}
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

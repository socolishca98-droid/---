// components/logist-mobile/drivers-map.tsx
//
// Карта для мобильной панели: где сейчас машины и как проходит рейс.
//
// Почему отдельный компонент, а не карта из дашборда:
//  — дашбордная карта построена под мышь и большой экран: плавающие панели,
//    слои, темы. На телефоне её кнопки уезжали за край экрана, а слои
//    перерисовывались так, что карта «мигала»;
//  — здесь карта создаётся один раз, а маршруты и машины обновляются на месте
//    (без пересоздания слоёв) — поэтому ничего не мигает;
//  — весь интерфейс — крупные кнопки и нижняя шторка, ничего не выходит за
//    границы экрана, всё под палец.
//
// Данные: /api/drivers/locations (координаты машин) и /api/dashboard/routes
// (нитки рейсов). Обновление — раз в 30 секунд, положение машин — на месте.

"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { ChevronDown, ChevronUp, Crosshair, Minus, Phone, Plus, RefreshCw, Route as RouteIcon } from "lucide-react"

import { DRIVER_STATUS_META } from "@/lib/logist-mobile/types"
import { formatRelative, telHref } from "@/lib/logist-mobile/format"

export interface MapDriver {
  id: string
  name: string
  phone: string | null
  latitude: number | null
  longitude: number | null
  status: string
  vehiclePlate: string | null
  vehicleType: string | null
  currentLocation: string | null
  routeFrom: string | null
  routeTo: string | null
  lastGpsUpdate?: string | null
}

export interface MapRouteLine {
  id: string
  driverName: string | null
  vehiclePlate: string | null
  routeFrom: string
  routeTo: string
  status: string
  coordinates: Array<[number, number]>
}

interface MapBase {
  name: string
  address: string
  coordinates: [number, number]
}

const STATUS_COLORS: Record<string, string> = {
  available: "#34d399",
  busy: "#38bdf8",
  offline: "#a1a1aa",
  maintenance: "#fbbf24",
}

/** Цвета ниток: рейсы должны отличаться друг от друга, иначе каша. */
const ROUTE_COLORS = ["#fb923c", "#38bdf8", "#a78bfa", "#34d399", "#f472b6", "#facc15", "#22d3ee"]

/**
 * Ключ CARTO из .env. Без ключа CDN отдаёт тайлы с водяным знаком, поэтому
 * в этом случае берём тёмную подложку Esri — она бесплатна и без ключа.
 */
const CARTO_API_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY || ""
const TILE_URL = CARTO_API_KEY
  ? `https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?key=${CARTO_API_KEY}`
  : "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"

export function DriversMap() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const driverMarkers = useRef<Map<string, L.CircleMarker>>(new Map())
  const routeLines = useRef<Map<string, L.Polyline>>(new Map())
  const baseMarker = useRef<L.CircleMarker | null>(null)
  const fitDone = useRef(false)

  const [tilesReady, setTilesReady] = useState(false)
  const [drivers, setDrivers] = useState<MapDriver[]>([])
  const [routes, setRoutes] = useState<MapRouteLine[]>([])
  const [base, setBase] = useState<MapBase | null>(null)
  const [loading, setLoading] = useState(true)
  const [showRoutes, setShowRoutes] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)

  // --- данные ---------------------------------------------------------------
  // Один лёгкий запрос вместо двух тяжёлых: сервер уже проредил нитки рейсов
  // и округлил координаты, поэтому ответ весит десятки килобайт, а не мегабайт.
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/lm/map")
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.success) return

      setDrivers(Array.isArray(data.drivers) ? (data.drivers as MapDriver[]) : [])
      setRoutes(
        Array.isArray(data.routes)
          ? (data.routes as Array<Record<string, unknown>>).map((route) => ({
              id: String(route.id),
              driverName: (route.driverName as string) ?? null,
              vehiclePlate: (route.vehiclePlate as string) ?? null,
              routeFrom: String(route.routeFrom ?? ""),
              routeTo: String(route.routeTo ?? ""),
              status: String(route.status ?? ""),
              coordinates: (route.points as Array<[number, number]>) ?? [],
            }))
          : [],
      )
      if (data.base?.coordinates) {
        setBase({ name: data.base.name, address: data.base.address, coordinates: data.base.coordinates })
      }
      setUpdatedAt(typeof data.generatedAt === "string" ? data.generatedAt : new Date().toISOString())
    } catch {
      // Сеть подвела — оставляем на карте то, что уже есть
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 30000)
    return () => clearInterval(timer)
  }, [load])

  // --- карта: создаётся один раз --------------------------------------------
  useEffect(() => {
    const element = containerRef.current
    if (!element || mapRef.current) return

    const map = L.map(element, {
      zoomControl: false, // свои крупные кнопки — они не уезжают за экран
      attributionControl: false,
      preferCanvas: true,
      center: [55.75, 37.62],
      zoom: 8,
    })
    mapRef.current = map

    const tiles = L.tileLayer(TILE_URL, {
      subdomains: "abcd",
      maxZoom: 18,
      minZoom: 3,
      crossOrigin: true,
    })
    tiles.on("load", () => setTilesReady(true))
    tiles.addTo(map)

    // Карта должна знать о смене размера: панель браузера на телефоне
    // прячется/показывается, высота контейнера меняется — без этого
    // Leaflet рисует серые полосы
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(element)

    return () => {
      observer.disconnect()
      driverMarkers.current.clear()
      routeLines.current.clear()
      baseMarker.current = null
      fitDone.current = false
      map.remove()
      mapRef.current = null
    }
  }, [])

  // --- слои: обновляем на месте, ничего не пересоздаём ----------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const points: Array<[number, number]> = []

    // База
    if (base?.coordinates) {
      points.push(base.coordinates)
      if (!baseMarker.current) {
        baseMarker.current = L.circleMarker(base.coordinates, {
          radius: 7,
          color: "#fb923c",
          weight: 3,
          fillColor: "#0b0b0e",
          fillOpacity: 1,
        })
          .bindTooltip(`База: ${base.name}`, { direction: "top" })
          .addTo(map)
      } else {
        baseMarker.current.setLatLng(base.coordinates)
      }
    }

    // Машины
    const alive = new Set<string>()
    for (const driver of drivers) {
      if (driver.latitude === null || driver.longitude === null) continue
      alive.add(driver.id)
      const position: [number, number] = [driver.latitude, driver.longitude]
      points.push(position)

      const isSelected = driver.id === selected
      const existing = driverMarkers.current.get(driver.id)
      if (existing) {
        existing.setLatLng(position)
        existing.setStyle({
          fillColor: STATUS_COLORS[driver.status] ?? STATUS_COLORS.offline,
          radius: isSelected ? 12 : 9,
          weight: isSelected ? 4 : 2.5,
        })
      } else {
        const marker = L.circleMarker(position, {
          radius: 9,
          color: "#ffffff",
          weight: 2.5,
          fillColor: STATUS_COLORS[driver.status] ?? STATUS_COLORS.offline,
          fillOpacity: 1,
        })
        marker.on("click", () => {
          setSelected(driver.id)
          setSheetOpen(true)
        })
        marker.addTo(map)
        driverMarkers.current.set(driver.id, marker)
      }
    }
    for (const [id, marker] of driverMarkers.current) {
      if (alive.has(id)) continue
      map.removeLayer(marker)
      driverMarkers.current.delete(id)
    }

    // Нитки рейсов
    const aliveRoutes = new Set<string>()
    routes.forEach((route, index) => {
      aliveRoutes.add(route.id)
      const color = ROUTE_COLORS[index % ROUTE_COLORS.length]
      const style: L.PolylineOptions = { color, weight: 3.5, opacity: 0.9 }
      const existing = routeLines.current.get(route.id)
      if (existing) {
        existing.setLatLngs(route.coordinates)
        existing.setStyle({ color })
      } else {
        routeLines.current.set(route.id, L.polyline(route.coordinates, style).addTo(map))
      }
      for (const point of route.coordinates) points.push(point)
    })
    for (const [id, line] of routeLines.current) {
      if (aliveRoutes.has(id)) continue
      map.removeLayer(line)
      routeLines.current.delete(id)
    }

    // Показываем рейсы или прячем — без пересоздания слоёв
    for (const line of routeLines.current.values()) {
      if (showRoutes) {
        if (!map.hasLayer(line)) line.addTo(map)
      } else if (map.hasLayer(line)) {
        map.removeLayer(line)
      }
    }

    // Один раз подгоняем вид под все точки
    if (!fitDone.current && points.length > 0) {
      fitDone.current = true
      map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 10 })
    }
  }, [drivers, routes, base, showRoutes, selected])

  const selectedDriver = useMemo(
    () => drivers.find((driver) => driver.id === selected) ?? null,
    [drivers, selected],
  )

  const onMapDrivers = drivers.filter((driver) => driver.latitude !== null && driver.longitude !== null)

  const focusDriver = useCallback((driver: MapDriver) => {
    if (driver.latitude === null || driver.longitude === null) return
    mapRef.current?.flyTo([driver.latitude, driver.longitude], 13, { duration: 0.6 })
    setSelected(driver.id)
  }, [])

  const fitAll = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const points: Array<[number, number]> = []
    for (const driver of onMapDrivers) {
      if (driver.latitude !== null && driver.longitude !== null) points.push([driver.latitude, driver.longitude])
    }
    if (base) points.push(base.coordinates)
    if (points.length === 0) return
    map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 10 })
  }, [onMapDrivers, base])

  const zoom = useCallback((delta: number) => {
    const map = mapRef.current
    if (!map) return
    map.setZoom(map.getZoom() + delta, { animate: true })
  }, [])

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0b0b0e]">
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* Пока тайлы не приехали — ровная подложка. Без «дыхания» и мигания. */}
      <div
        className={`pointer-events-none absolute inset-0 z-[1] bg-[#0b0b0e] transition-opacity duration-500 ${
          tilesReady ? "opacity-0" : "opacity-100"
        }`}
        aria-hidden="true"
      />

      {/* Верхние кнопки: крупные, в один ряд, ничего не выходит за экран */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[2]">
        <div className="mx-auto flex max-w-md items-start justify-between gap-2 px-3 pt-3">
          <div className="pointer-events-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowRoutes((value) => !value)}
              className={`flex h-10 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium backdrop-blur ${
                showRoutes
                  ? "border-orange-500/40 bg-orange-500/20 text-orange-200"
                  : "border-white/10 bg-black/60 text-zinc-300"
              }`}
            >
              <RouteIcon className="h-4 w-4" />
              Рейсы{routes.length ? ` · ${routes.length}` : ""}
            </button>
            <button
              type="button"
              onClick={fitAll}
              className="flex h-10 items-center gap-2 rounded-full border border-white/10 bg-black/60 px-3.5 text-[13px] font-medium text-zinc-200 backdrop-blur"
            >
              <Crosshair className="h-4 w-4" />
              Все
            </button>
          </div>

          <div className="pointer-events-auto flex flex-col gap-2">
            <button
              type="button"
              onClick={() => zoom(1)}
              aria-label="Приблизить"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white backdrop-blur"
            >
              <Plus className="h-4.5 w-4.5" />
            </button>
            <button
              type="button"
              onClick={() => zoom(-1)}
              aria-label="Отдалить"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white backdrop-blur"
            >
              <Minus className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Карточка выбранной машины — над шторкой, в пределах экрана */}
      {selectedDriver && !sheetOpen ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 z-[3]">
          <div className="mx-auto max-w-md px-3">
            <div className="pointer-events-auto rounded-2xl border border-white/10 bg-[#111114]/95 p-3.5 backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14.5px] font-medium text-white">{selectedDriver.name}</p>
                  <p className="mt-0.5 truncate text-[12.5px] text-zinc-400">
                    {[selectedDriver.vehiclePlate, selectedDriver.currentLocation].filter(Boolean).join(" · ") || "нет данных"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="shrink-0 text-[12.5px] text-zinc-400"
                >
                  Скрыть
                </button>
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => focusDriver(selectedDriver)}
                  className="flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-white/8 text-[13px] font-medium text-white active:bg-white/12"
                >
                  <Crosshair className="h-4 w-4" /> На карте
                </button>
                {telHref(selectedDriver.phone) ? (
                  <a
                    href={telHref(selectedDriver.phone) as string}
                    className="flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-emerald-500/15 text-[13px] font-medium text-emerald-200 active:bg-emerald-500/25"
                  >
                    <Phone className="h-4 w-4" /> Позвонить
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Нижняя шторка: список машин или кнопка его открыть */}
      <div className="absolute inset-x-0 bottom-0 z-[4]">
        <div className="mx-auto max-w-md">
          <div className="rounded-t-3xl border border-b-0 border-white/10 bg-[#0b0b0e]/95 backdrop-blur">
            <button
              type="button"
              onClick={() => setSheetOpen((value) => !value)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3"
            >
              <span className="flex items-center gap-2 text-[14.5px] font-medium text-white">
                Машины на карте
                <span className="rounded-full bg-white/8 px-2 py-0.5 text-[12px] text-zinc-300">
                  {onMapDrivers.length}
                </span>
              </span>
              <span className="flex items-center gap-2 text-[12.5px] text-zinc-400">
                {updatedAt ? formatRelative(updatedAt) : loading ? "загрузка…" : "нет данных"}
                {sheetOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </span>
            </button>

            {sheetOpen ? (
              <div className="max-h-[42vh] overflow-y-auto overscroll-contain px-3 pb-3">
                {onMapDrivers.length === 0 ? (
                  <p className="px-1 pb-2 text-[13px] text-zinc-500">
                    Координат пока нет — водители появятся на карте после первой отправки геопозиции.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {onMapDrivers.map((driver) => {
                      const meta = DRIVER_STATUS_META[driver.status] ?? DRIVER_STATUS_META.offline
                      const tel = telHref(driver.phone)
                      const active = driver.id === selected
                      return (
                        <div
                          key={driver.id}
                          className={`rounded-2xl border p-3 ${
                            active ? "border-orange-500/40 bg-orange-500/[0.08]" : "border-white/8 bg-white/[0.03]"
                          }`}
                        >
                          <button type="button" onClick={() => focusDriver(driver)} className="block w-full text-left">
                            <span className="block truncate text-[14.5px] font-medium text-white">{driver.name}</span>
                            <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px]">
                              <span className={`inline-block h-2 w-2 rounded-full ${meta.dot}`} />
                              <span className={meta.text}>{meta.label}</span>
                              {driver.vehiclePlate ? <span className="text-zinc-500">· {driver.vehiclePlate}</span> : null}
                            </span>
                            <span className="mt-1 block truncate text-[12px] text-zinc-500">
                              {driver.routeFrom && driver.routeTo
                                ? `${driver.routeFrom} → ${driver.routeTo}`
                                : driver.currentLocation || "маршрут не указан"}
                            </span>
                          </button>
                          <div className="mt-2.5 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => focusDriver(driver)}
                              className="flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-white/8 text-[13px] font-medium text-white active:bg-white/12"
                            >
                              <Crosshair className="h-4 w-4" /> Показать
                            </button>
                            {tel ? (
                              <a
                                href={tel}
                                className="flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-emerald-500/15 text-[13px] font-medium text-emerald-200 active:bg-emerald-500/25"
                              >
                                <Phone className="h-4 w-4" /> Позвонить
                              </a>
                            ) : (
                              <span className="flex min-h-[42px] items-center justify-center rounded-xl bg-white/5 text-[12.5px] text-zinc-600">
                                нет телефона
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void load()}
                  className="mt-2 flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl bg-white/[0.04] text-[13px] text-zinc-300"
                >
                  <RefreshCw className="h-4 w-4" /> Обновить
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

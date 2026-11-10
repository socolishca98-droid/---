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
import {
  ChevronDown,
  ChevronUp,
  Compass,
  Crosshair,
  Info,
  LocateFixed,
  Minus,
  Phone,
  Plus,
  RefreshCw,
  Route as RouteIcon,
  Search,
  X,
} from "lucide-react"
import { toast } from "sonner"

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
  driverId: string | null
  driverName: string | null
  vehiclePlate: string | null
  routeFrom: string
  routeTo: string
  status: string
  coordinates: Array<[number, number]>
  /**
   * Откуда линия: "osrm" — построена по дорогам, "line" — расчётная по
   * точкам (дорогу получить не удалось). Расчётную рисуем пунктиром:
   * сплошная линия выглядит дорогой, которой нет.
   */
  geometrySource?: "osrm" | "line"
  /**
   * Порожний возврат в парк — отдельная линия. Раньше она была частью
   * одной петли, и «рейс» показывал вдвое больше километров, чем везли груз.
   */
  returnPoints?: Array<[number, number]>
  returnSource?: "osrm" | "line"
  returnKm?: number | null
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

/** Порядок статусов в живой сводке «кто на линии» */
const FLEET_ORDER: Array<{ status: string; label: string }> = [
  { status: "busy", label: "в рейсе" },
  { status: "available", label: "свободны" },
  { status: "maintenance", label: "ремонт" },
  { status: "offline", label: "не на связи" },
]

/** Легенда: что значит цвета точек и линий на карте. */
const LEGEND_ITEMS: Array<{ color: string; label: string }> = [
  { color: STATUS_COLORS.available, label: "Свободен" },
  { color: STATUS_COLORS.busy, label: "В рейсе" },
  { color: STATUS_COLORS.maintenance, label: "Ремонт" },
  { color: STATUS_COLORS.offline, label: "Не на связи" },
]

/** Иконки активных объектов (и28): форма = тип, цвет = смысл. */
const TRUCK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>`
const WAREHOUSE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5 12 4l9 5.5V20H3V9.5Z"/><path d="M7 20v-7h10v7"/><path d="M7 16.5h10"/></svg>`

/**
 * Цвет груза. Одна нить = один смысл: янтарная дорога «с грузом»,
 * бледный пунктир — порожняк. Радуга по id выглядела пёстро, но не
 * отвечала на вопрос «что это»: цвет теперь несут объекты (машина —
 * статус, точки — принадлежность к грузу), а не ленты маршрутов.
 */
const ROUTE_COLOR = "#f5b04d"

/** Чип-машина: тёмный квадрат с грузовиком, рамка — статус водителя */
function truckIcon(status: string, isSelected: boolean): L.DivIcon {
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.offline
  return L.divIcon({
    className: "lm-pin-wrap",
    html: `<span class="lm-truck${isSelected ? " is-selected" : ""}" style="--pin-color:${color}">${TRUCK_SVG}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })
}

/** Значок точки рейса: «П» — груз забирают, «В» — сдают */
function stopIcon(kind: "Погрузка" | "Выгрузка"): L.DivIcon {
  return L.divIcon({
    className: "lm-pin-wrap",
    html: `<span class="lm-stop lm-stop--${kind === "Погрузка" ? "load" : "unload"}">${kind === "Погрузка" ? "П" : "В"}</span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })
}

/** База: склад в тёплом кольце */
function baseIcon(): L.DivIcon {
  return L.divIcon({
    className: "lm-pin-wrap",
    html: `<span class="lm-base">${WAREHOUSE_SVG}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  })
}

/**
 * Ключ CARTO из .env. Без ключа CDN отдаёт тайлы с водяным знаком, поэтому
 * в этом случае берём тёмную подложку Esri — она бесплатна и без ключа.
 */
const CARTO_API_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY || ""
const CARTO_DARK = CARTO_API_KEY
  ? `https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?key=${CARTO_API_KEY}`
  : null
const ESRI_DARK = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
/**
 * Слой подписей к той же тёмной подложке: названия городов, улиц и дорог.
 * Без него карта — серая пелена без опорных точек, и глаз не понимает,
 * где именно едет машина. Слой бесплатный и без ключа, поэтому включаем
 * его всегда, когда нет своего ключа CARTO.
 */
const ESRI_DARK_LABELS =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
const ESRI_SATELLITE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"

/** Тема подложки выбирается в настройках (полная версия хранит её там же). */
const THEME_STORAGE_KEY = "tms_map_theme"

function tileUrlForTheme(theme: string): string {
  if (theme === "satellite") return ESRI_SATELLITE
  if (theme === "graphite") return ESRI_DARK
  return CARTO_DARK ?? ESRI_DARK
}

function readMapTheme(): string {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) || "dark"
  } catch {
    return "dark"
  }
}

export function DriversMap() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const driverMarkers = useRef<Map<string, L.Marker>>(new Map())
  // Ореолы-свечения под маркерами машин (идут парой с маркерами)
  const driverHalos = useRef<Map<string, L.CircleMarker>>(new Map())
  const routeLines = useRef<Map<string, { casing: L.Polyline; main: L.Polyline }>>(new Map())
  const returnLines = useRef<Map<string, L.Polyline>>(new Map())
  /** Кольца «откуда»/«куда» на концах нитей рейсов — чтобы видеть точки маршрута. */
  const routeEndpoints = useRef<Map<string, L.Marker>>(new Map())
  const baseMarker = useRef<L.Marker | null>(null)
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
  // 6.1: легенда цветов; 6.2: поиск по списку машин; 6.4: моё местоположение
  const [legendOpen, setLegendOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [locating, setLocating] = useState(false)
  /** Плашка «пробки не учитываются»: показываем, пока человек её не закрыл. */
  const [trafficNotice, setTrafficNotice] = useState(true)
  const myMarker = useRef<L.CircleMarker | null>(null)

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
              driverId: (route.driverId as string) ?? null,
              driverName: (route.driverName as string) ?? null,
              vehiclePlate: (route.vehiclePlate as string) ?? null,
              routeFrom: String(route.routeFrom ?? ""),
              routeTo: String(route.routeTo ?? ""),
              status: String(route.status ?? ""),
              coordinates: (route.points as Array<[number, number]>) ?? [],
              geometrySource: (route.geometrySource as "osrm" | "line") ?? "osrm",
              returnPoints: (route.returnPoints as Array<[number, number]>) ?? [],
              returnSource: (route.returnSource as "osrm" | "line") ?? "osrm",
              returnKm: typeof route.returnKm === "number" ? route.returnKm : null,
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
      // Линии рисуем в SVG, а не в canvas: на телефоне с плотным экраном
      // SVG-линия резче, а нитей на карте единицы — производительности хватает
      preferCanvas: false,
      center: [55.75, 37.62],
      zoom: 8,
    })
    mapRef.current = map

    const tiles = L.tileLayer(tileUrlForTheme(readMapTheme()), {
      subdomains: "abcd",
      maxZoom: 18,
      minZoom: 3,
      crossOrigin: true,
    })
    tiles.on("load", () => setTilesReady(true))
    tiles.addTo(map)

    // Слой подписей — поверх подложки, но под нитями рейсов. Он же скрывает
    // «серую пелену»: город, улица, дорога — по ним глаз понимает, где едет
    // машина. Ставим отдельным pane, чтобы подписи не перекрывали маршруты.
    if (!map.getPane("labelsPane")) {
      map.createPane("labelsPane")
      map.getPane("labelsPane")!.style.zIndex = "350"
      map.getPane("labelsPane")!.style.pointerEvents = "none"
    }
    if (!map.getPane("casingPane")) {
      map.createPane("casingPane")
      map.getPane("casingPane")!.style.zIndex = "400"
    }
    if (!map.getPane("routePane")) {
      map.createPane("routePane")
      map.getPane("routePane")!.style.zIndex = "450"
    }
    if (!CARTO_API_KEY) {
      L.tileLayer(ESRI_DARK_LABELS, {
        maxZoom: 18,
        minZoom: 3,
        crossOrigin: true,
        pane: "labelsPane",
      }).addTo(map)
    }

    // Карта должна знать о смене размера: панель браузера на телефоне
    // прячется/показывается, высота контейнера меняется — без этого
    // Leaflet рисует серые полосы
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(element)

    return () => {
      observer.disconnect()
      driverMarkers.current.clear()
      for (const line of routeLines.current.values()) {
        map.removeLayer(line.casing)
        map.removeLayer(line.main)
      }
      routeLines.current.clear()
      for (const marker of routeEndpoints.current.values()) map.removeLayer(marker)
      routeEndpoints.current.clear()
      baseMarker.current = null
      myMarker.current = null
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
        baseMarker.current = L.marker(base.coordinates, { icon: baseIcon() })
          .bindTooltip(`База: ${base.name}`, { direction: "top" })
          .addTo(map)
      } else {
        baseMarker.current.setLatLng(base.coordinates)
      }
    }

    // Машины (маркер + ореол-свечение — машина «фонарик» на тёмной карте)
    const driverPoints: Array<[number, number]> = []
    const alive = new Set<string>()
    for (const driver of drivers) {
      if (driver.latitude === null || driver.longitude === null) continue
      alive.add(driver.id)
      const position: [number, number] = [driver.latitude, driver.longitude]
      points.push(position)
      driverPoints.push(position)

      const isSelected = driver.id === selected
      const existing = driverMarkers.current.get(driver.id)
      const statusColor = STATUS_COLORS[driver.status] ?? STATUS_COLORS.offline
      const halo = driverHalos.current.get(driver.id)
      if (existing) {
        existing.setLatLng(position)
        existing.setIcon(truckIcon(driver.status, isSelected))
        if (halo) {
          halo.setLatLng(position)
          halo.setStyle({
            fillColor: statusColor,
            radius: isSelected ? 20 : 15,
            fillOpacity: isSelected ? 0.3 : 0.16,
          })
          // Выбранная машина «дышит» — ореел пульсирует
          halo.getElement()?.classList.toggle("lm-halo-pulse", isSelected)
        }
      } else {
        // Ореол под маркером: мягкое свечение цвета статуса
        const newHalo = L.circleMarker(position, {
          radius: 15,
          stroke: false,
          fillColor: statusColor,
          fillOpacity: 0.16,
          className: isSelected ? "lm-halo-pulse" : undefined,
        })
        newHalo.addTo(map)
        driverHalos.current.set(driver.id, newHalo)

        const marker = L.marker(position, { icon: truckIcon(driver.status, isSelected) })
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
      const halo = driverHalos.current.get(id)
      if (halo) {
        map.removeLayer(halo)
        driverHalos.current.delete(id)
      }
    }

    // Нитки рейсов.
    //
    // Каждая нить рисуется двумя линиями: тёмная широкая «подкладка» под
    // цветной узкой. Без подкладки цветная линия сливается с дорогами и
    // городской застройкой — выглядит грязно. С подкладкой нить читается
    // на любом фоне, как в навигаторах.
    //
    // Когда рейсов много, все они одной толщины превращаются в кашу. Поэтому:
    //   — выбранный рейс рисуем толще и ярче;
    //   — остальные приглушаем, если что-то выбрано;
    //   — при большом числе рейсов все линии становятся тоньше.
    const aliveRoutes = new Set<string>()
    const crowded = routes.length > 6
    routes.forEach((route) => {
      aliveRoutes.add(route.id)
      const color = ROUTE_COLOR
      const isActive = selected !== null && route.driverId === selected
      const dimmed = selected !== null && !isActive
      const weight = crowded ? 2.5 : 3.5
      const opacity = dimmed ? 0.35 : 1
      // Расчётный маршрут (дорогу получить не удалось) — пунктиром и
      // бледнее: глаз должен отличать «дорогу» от «прикидки по точкам».
      const approximate = route.geometrySource === "line"
      const dash = approximate ? "3 7" : undefined
      const shared: L.PolylineOptions = {
        // Скруглые концы и стыки: без этого линия выглядит как «рваная
        // лесенка» из прямых отрезков
        lineCap: "round",
        lineJoin: "round",
        // Лёгкое сглаживание: сервер прореживает длинную нить до 200 точек,
        // и без него на поворотах видны углы
        smoothFactor: 1.5,
        dashArray: dash,
        opacity: approximate ? Math.min(opacity, 0.75) : opacity,
      }
      const existing = routeLines.current.get(route.id)
      if (existing) {
        existing.main.setLatLngs(route.coordinates)
        // Нить выбранного рейса «едет»: бегущий пунктир по ходу движения
        existing.main.getElement()?.classList.toggle("lm-route-flow", isActive)
        existing.main.setStyle({
          color,
          weight,
          opacity: shared.opacity,
          dashArray: dash,
        })
        existing.casing.setLatLngs(route.coordinates)
        existing.casing.setStyle({
          weight: approximate ? weight + 2 : weight + 3,
          opacity: approximate ? Math.min(dimmed ? 0.3 : 0.5, 0.5) : dimmed ? 0.4 : 0.85,
          dashArray: dash,
        })
      } else {
        const casing = L.polyline(route.coordinates, {
          ...shared,
          color: "#0a0a0c",
          weight: approximate ? weight + 2 : weight + 3,
          opacity: approximate ? Math.min(dimmed ? 0.3 : 0.5, 0.5) : dimmed ? 0.4 : 0.85,
          pane: "casingPane",
        }).addTo(map)
        const main = L.polyline(route.coordinates, {
          ...shared,
          color,
          weight,
          pane: "routePane",
          className: isActive ? "lm-route-flow" : undefined,
        }).addTo(map)
        routeLines.current.set(route.id, { casing, main })
      }
      for (const point of route.coordinates) points.push(point)

      // Порожний возврат в парк: та же цветовая нить, но бледная и
      // пунктирная — глаз сразу отличает «везли груз» от «ехали пустые».
      const returnPts = route.returnPoints ?? []
      if (returnPts.length >= 2) {
        const existingReturn = returnLines.current.get(route.id)
        const returnApproximate = route.returnSource === "line"
        if (existingReturn) {
          existingReturn.setLatLngs(returnPts)
          existingReturn.setStyle({ opacity: dimmed ? 0.15 : 0.35 })
        } else {
          returnLines.current.set(
            route.id,
            L.polyline(returnPts, {
              color,
              weight: crowded ? 1.5 : 2,
              opacity: dimmed ? 0.15 : 0.35,
              dashArray: returnApproximate ? "2 6" : "4 6",
              lineCap: "round",
              pane: "routePane",
            }).addTo(map),
          )
        }
      } else {
        const stale = returnLines.current.get(route.id)
        if (stale) {
          map.removeLayer(stale)
          returnLines.current.delete(route.id)
        }
      }

      // Точки «откуда» и «куда» — кольца в цвете нити с белой обводкой.
      // Раньше нить просто начиналась и заканчивалась ничем, и было не
      // понять, где погрузка, а где выгрузка.
      const endpoints = [
        { point: route.coordinates[0], label: route.routeFrom, kind: "Погрузка" },
        { point: route.coordinates[route.coordinates.length - 1], label: route.routeTo, kind: "Выгрузка" },
      ]
      const aliveEndpoints = new Set<string>()
      for (const endpoint of endpoints) {
        if (!endpoint.point) continue
        const key = `${route.id}:${endpoint.kind}`
        aliveEndpoints.add(key)
        const existing = routeEndpoints.current.get(key)
        if (existing) {
          existing.setLatLng(endpoint.point)
        } else {
          const marker = L.marker(endpoint.point, { icon: stopIcon(endpoint.kind as "Погрузка" | "Выгрузка") })
            .bindTooltip(
              approximate
                ? `${endpoint.kind}: ${endpoint.label || "—"} · маршрут расчётный`
                : `${endpoint.kind}: ${endpoint.label || "—"}`,
              { direction: "top" },
            )
            .addTo(map)
          marker.on("click", () => {
            setSelected(route.driverId ?? null)
            setSheetOpen(true)
          })
          routeEndpoints.current.set(key, marker)
        }
      }
      for (const [key, marker] of routeEndpoints.current) {
        if (key.startsWith(`${route.id}:`) && !aliveEndpoints.has(key)) {
          map.removeLayer(marker)
          routeEndpoints.current.delete(key)
        }
      }
    })
    for (const [id, line] of routeLines.current) {
      if (aliveRoutes.has(id)) continue
      map.removeLayer(line.casing)
      map.removeLayer(line.main)
      routeLines.current.delete(id)
      const staleReturn = returnLines.current.get(id)
      if (staleReturn) {
        map.removeLayer(staleReturn)
        returnLines.current.delete(id)
      }
      for (const [key, marker] of routeEndpoints.current) {
        if (key.startsWith(`${id}:`)) {
          map.removeLayer(marker)
          routeEndpoints.current.delete(key)
        }
      }
    }

    // Показываем рейсы или прячем — без пересоздания слоёв
    for (const line of routeLines.current.values()) {
      if (showRoutes) {
        if (!map.hasLayer(line.casing)) line.casing.addTo(map)
        if (!map.hasLayer(line.main)) line.main.addTo(map)
      } else {
        if (map.hasLayer(line.casing)) map.removeLayer(line.casing)
        if (map.hasLayer(line.main)) map.removeLayer(line.main)
      }
    }
    for (const [key, marker] of routeEndpoints.current) {
      if (showRoutes) {
        if (!map.hasLayer(marker)) marker.addTo(map)
      } else if (map.hasLayer(marker)) {
        map.removeLayer(marker)
      }
    }

    // Один раз подгоняем вид: главный вопрос — «где машины», поэтому рамку
    // считаем по машинам и базе. Нитки рейсов тянутся через всю страну и
    // растянули бы карту до масштаба континента.
    if (!fitDone.current) {
      const frame = driverPoints.length > 0 ? [...driverPoints, base?.coordinates].filter(Boolean) : points
      if (frame.length > 0) {
        fitDone.current = true
        map.fitBounds(L.latLngBounds(frame as Array<[number, number]>), { padding: [40, 40], maxZoom: 11 })
      }
    }
  }, [drivers, routes, base, showRoutes, selected])

  const selectedDriver = useMemo(
    () => drivers.find((driver) => driver.id === selected) ?? null,
    [drivers, selected],
  )

  const onMapDrivers = drivers.filter((driver) => driver.latitude !== null && driver.longitude !== null)

  // 6.2: поиск по имени, номеру машины и маршруту — без учёта регистра.
  // Фильтруется список в шторке; маркеры на карте остаются, чтобы картина
  // «где все машины» не пропадала во время набора.
  const visibleDrivers = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return onMapDrivers
    return onMapDrivers.filter((driver) =>
      [driver.name, driver.vehiclePlate, driver.routeFrom, driver.routeTo, driver.currentLocation]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle)),
    )
  }, [onMapDrivers, query])

  // 6.4: «моё местоположение» — спросить браузер и подлететь к точке
  const locateMe = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    if (!("geolocation" in navigator)) {
      toast.error("Браузер не отдаёт геопозицию")
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false)
        const here: [number, number] = [position.coords.latitude, position.coords.longitude]
        if (!myMarker.current) {
          myMarker.current = L.circleMarker(here, {
            radius: 8,
            color: "#ffffff",
            weight: 2.5,
            fillColor: "#60a5fa",
            fillOpacity: 1,
          })
            .bindTooltip("Вы здесь", { direction: "top" })
            .addTo(map)
        } else {
          myMarker.current.setLatLng(here)
        }
        map.flyTo(here, Math.max(map.getZoom(), 13), { duration: 0.6 })
      },
      () => {
        setLocating(false)
        toast.error("Геопозиция недоступна: разрешите доступ в браузере")
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    )
  }, [])

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
    // Рамка по машинам, а не по ниткам: рейсы тянутся через полстраны
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 11 })
  }, [onMapDrivers, base])

  const zoom = useCallback((delta: number) => {
    const map = mapRef.current
    if (!map) return
    map.setZoom(map.getZoom() + delta, { animate: true })
  }, [])

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* Пока тайлы не приехали — ровная подложка. Без «дыхания» и мигания. */}
      <div
        className={`pointer-events-none absolute inset-0 z-[1] bg-background transition-opacity duration-500 ${
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
              className={`flex h-10 items-center gap-2 rounded-md border px-3.5 text-[13px] font-medium backdrop-blur ${
                showRoutes
                  ? "border-primary/40 bg-primary/20 text-primary"
                  : "border-border bg-black/60 text-foreground/90"
              }`}
            >
              <RouteIcon className="h-4 w-4" />
              Рейсы{routes.length ? ` · ${routes.length}` : ""}
            </button>
            <button
              type="button"
              onClick={fitAll}
              className="flex h-10 items-center gap-2 rounded-full border border-white/10 bg-black/70 shadow-lg shadow-black/50 px-3.5 text-[13px] font-medium text-foreground backdrop-blur"
            >
              <Crosshair className="h-4 w-4" />
              Все
            </button>
            <button
              type="button"
              onClick={() => setLegendOpen((value) => !value)}
              aria-label="Легенда карты"
              className={`flex h-10 w-10 items-center justify-center rounded-md border backdrop-blur ${
                legendOpen
                  ? "border-primary/40 bg-primary/20 text-primary"
                  : "border-border bg-black/60 text-foreground/90"
              }`}
            >
              <Info className="h-4 w-4" />
            </button>
          </div>

          <div className="pointer-events-auto flex flex-col gap-2">
            <button
              type="button"
              onClick={() => zoom(1)}
              aria-label="Приблизить"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/70 shadow-lg shadow-black/50 text-foreground backdrop-blur"
            >
              <Plus className="h-4.5 w-4.5" />
            </button>
            <button
              type="button"
              onClick={() => zoom(-1)}
              aria-label="Отдалить"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/70 shadow-lg shadow-black/50 text-foreground backdrop-blur"
            >
              <Minus className="h-4.5 w-4.5" />
            </button>
            <button
              type="button"
              onClick={locateMe}
              aria-label="Моё местоположение"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/70 shadow-lg shadow-black/50 text-foreground backdrop-blur"
            >
              {locating ? (
                <RefreshCw className="h-4.5 w-4.5 animate-spin" />
              ) : (
                <LocateFixed className="h-4.5 w-4.5" />
              )}
            </button>
          </div>
        </div>

        {/* 6.1: легенда — что значат цвета. Открывается кнопкой ⓘ */}
        {legendOpen ? (
          <div className="mx-auto max-w-md px-3 pt-2">
            <div className="pointer-events-auto inline-block rounded-xl border border-border bg-black/70 p-3 text-[12.5px] text-foreground backdrop-blur">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {LEGEND_ITEMS.map((item) => (
                  <span key={item.label} className="flex items-center gap-2">
                    <span className="lm-legend-chip" style={{ color: item.color }} />
                    {item.label}
                  </span>
                ))}
                <span className="flex items-center gap-2">
                  <span className="lm-legend-stop">П</span>
                  Погрузка
                </span>
                <span className="flex items-center gap-2">
                  <span className="lm-legend-stop">В</span>
                  Выгрузка
                </span>
                <span className="flex items-center gap-2">
                  <span className="lm-legend-base">{WAREHOUSE_SVG}</span>
                  База
                </span>
                <span className="flex items-center gap-2">
                  <span className="lm-legend-route" />
                  С грузом
                </span>
                <span className="flex items-center gap-2">
                  <span className="lm-legend-return" />
                  Порожняк
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Карточка выбранной машины — над шторкой, в пределах экрана */}
      {selectedDriver && !sheetOpen ? (
        // bottom-16: карточка целиком НАД свёрнутой шторкой «Машины на карте»,
        // иначе кнопки «На карте» и «Позвонить» прячутся под неё
        <div className="pointer-events-none absolute inset-x-0 bottom-16 z-[3]">
          <div className="mx-auto max-w-md px-3">
            <div className="lm-glass-card pointer-events-auto p-3.5" data-lm-glass>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14.5px] font-medium text-foreground">{selectedDriver.name}</p>
                  <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
                    {[selectedDriver.vehiclePlate, selectedDriver.currentLocation].filter(Boolean).join(" · ") || "нет данных"}
                  </p>
                  {/* 6.3: время до базы появится после подключения провайдера
                      пробок (Яндекс JS API — ждёт ключа). Пока честно: нет данных. */}
                  <p className="mt-0.5 truncate text-[12px] text-muted-foreground/80">
                    До базы: нет данных о пробках
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="shrink-0 text-[12.5px] text-muted-foreground"
                >
                  Скрыть
                </button>
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => focusDriver(selectedDriver)}
                  aria-label="Показать на карте"
                  className="lm-glass-btn flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-secondary text-[13px] font-medium text-foreground active:opacity-70"
                >
                  <Compass className="h-4 w-4" /> На карте
                </button>
                {telHref(selectedDriver.phone) ? (
                  <a
                    href={telHref(selectedDriver.phone) as string}
                    className="lm-glass-btn lm-glass-btn-success flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-success/15 text-[13px] font-medium text-success active:opacity-70"
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
          <div className="rounded-t-3xl border border-b-0 border-border surface-glass backdrop-blur">
            <span className="lm-sheet-grabber" aria-hidden />
            {/*
              Честная плашка про пробки. Время в программе считается по пробегу
              и историческим коэффициентам, живых пробок у нас нет — как в
              навигаторах без подключённого источника. Молчать об этом нельзя:
              логист принимает решения по этим цифрам.
            */}
            {trafficNotice ? (
              <div className="flex items-start gap-2 border-b border-border/60 px-4 py-2.5">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <p className="flex-1 text-[12px] leading-snug text-muted-foreground">
                  Пробки в расчёте времени не учитываются — время считаем по километрам и опыту прошлых рейсов.
                </p>
                <button
                  type="button"
                  onClick={() => setTrafficNotice(false)}
                  aria-label="Скрыть сообщение о пробках"
                  className="shrink-0 text-muted-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setSheetOpen((value) => !value)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3"
            >
              <span className="flex items-center gap-2 text-[14.5px] font-medium text-foreground">
                Машины на карте
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[12px] text-foreground/90">
                  {query.trim() ? `${visibleDrivers.length} из ${onMapDrivers.length}` : onMapDrivers.length}
                </span>
              </span>
              <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                {updatedAt ? formatRelative(updatedAt) : loading ? "загрузка…" : "нет данных"}
                {sheetOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </span>
            </button>

            {/* Живая сводка «кто на линии»: видно и в закрытой шторке */}
            <div className="lm-fleet-summary" aria-hidden>
              {FLEET_ORDER.map((entry) => {
                const count = onMapDrivers.filter((d) => d.status === entry.status).length
                if (count === 0) return null
                return (
                  <span key={entry.status}>
                    <span
                      className="lm-fleet-dot"
                      style={{ backgroundColor: STATUS_COLORS[entry.status], color: STATUS_COLORS[entry.status] }}
                    />
                    {count} {entry.label}
                  </span>
                )
              })}
            </div>

            {sheetOpen ? (
              <div className="max-h-[42vh] overflow-y-auto overscroll-contain px-3 pb-3">
                {/* 6.2: поиск машины — имя, номер, маршрут */}
                <div className="relative mb-2">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Найти: имя, номер машины, маршрут"
                    className="h-11 w-full rounded-xl border border-border bg-background/70 pl-9 pr-9 text-[13.5px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  {query ? (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      aria-label="Очистить поиск"
                      className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
                {onMapDrivers.length === 0 ? (
                  <p className="px-1 pb-2 text-[13px] text-muted-foreground">
                    Координат пока нет — водители появятся на карте после первой отправки геопозиции.
                  </p>
                ) : visibleDrivers.length === 0 ? (
                  <p className="px-1 pb-2 text-[13px] text-muted-foreground">
                    Никого не нашли по запросу «{query.trim()}». Сотрите запрос — машины вернутся.
                  </p>
                ) : (
                  <div className="lm-stagger space-y-2">
                    {visibleDrivers.map((driver) => {
                      const meta = DRIVER_STATUS_META[driver.status] ?? DRIVER_STATUS_META.offline
                      const tel = telHref(driver.phone)
                      const active = driver.id === selected
                      // Нить этой машины расчётная (дорогу получить не удалось) —
                      // говорим об этом прямо, а не делаем вид, что линия — дорога.
                      const approximate = routes.some(
                        (route) => route.driverId === driver.id && route.geometrySource === "line",
                      )
                      return (
                        <div
                          key={driver.id}
                          className={`rounded-xl border p-3 ${
                            active ? "border-primary/40 bg-primary/[0.08]" : "border-border bg-card shadow-sm"
                          }`}
                        >
                          <button type="button" onClick={() => focusDriver(driver)} className="block w-full text-left">
                            <span className="block truncate text-[14.5px] font-medium text-foreground">{driver.name}</span>
                            <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px]">
                              <span className={`inline-block h-2 w-2 rounded-full ${meta.dot}`} />
                              <span className={meta.text}>{meta.label}</span>
                              {driver.vehiclePlate ? <span className="text-muted-foreground">· {driver.vehiclePlate}</span> : null}
                            </span>
                            <span className="mt-1 block truncate text-[12px] text-muted-foreground">
                              {driver.routeFrom && driver.routeTo
                                ? `${driver.routeFrom} → ${driver.routeTo}`
                                : driver.currentLocation || "маршрут не указан"}
                            </span>
                            {approximate ? (
                              <span className="mt-1 inline-block rounded-md bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                маршрут расчётный — уточняется по дорогам
                              </span>
                            ) : null}
                          </button>
                          <div className="mt-2.5 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => focusDriver(driver)}
                              className="flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-secondary text-[13px] font-medium text-foreground active:opacity-70"
                            >
                              <Crosshair className="h-4 w-4" /> Показать
                            </button>
                            {tel ? (
                              <a
                                href={tel}
                                className="flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-success/15 text-[13px] font-medium text-success active:opacity-70"
                              >
                                <Phone className="h-4 w-4" /> Позвонить
                              </a>
                            ) : (
                              <span className="flex min-h-[42px] items-center justify-center rounded-xl bg-secondary text-[12.5px] text-muted-foreground/80">
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
                  className="lm-glass-btn mt-2 flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl bg-secondary text-[13px] text-foreground/90"
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

// components/dashboard/map/hooks/useMapInstance.ts

import { useEffect, useRef, useState, useCallback } from "react"
import L from "leaflet"
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from "../constants"

export type MapTheme = "dark" | "graphite" | "satellite"

/** Источник тайлов карты: задаётся переменной NEXT_PUBLIC_MAP_TILES. */
export type MapTileSource = "esri" | "carto" | "osm"

interface TileLayerSpec {
  url: string
  attribution?: string
  opacity?: number
  className?: string
  subdomains?: string
  maxZoom?: number
}

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services"

// Esri отдаёт тёмную «канву» без ключа — поэтому он основной источник.
const ESRI_DARK_BASE = `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`
const ESRI_DARK_REFERENCE = `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`
const ESRI_IMAGERY = `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`
const ESRI_BOUNDARIES = `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"

/**
 * CARTO с 2025 года требует ключ даже на базовые стили: без него сервер отдаёт
 * картинку «API KEY REQUIRED». Ключ подставляем, только если он задан и его
 * ещё нет в шаблоне.
 */
const CARTO_KEY = (process.env.NEXT_PUBLIC_CARTO_API_KEY || "").trim()

/**
 * Шаблон тайлов CARTO. По умолчанию — rastertiles/voyager: та самая карта,
 * на которой собрана подкладка. Переопределяется переменной
 * NEXT_PUBLIC_CARTO_TILES (например, на dark_all или свой стиль).
 */
const CARTO_TILE_TEMPLATE =
  (process.env.NEXT_PUBLIC_CARTO_TILES || "").trim() ||
  "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"

function cartoTiles(): string {
  const template = CARTO_TILE_TEMPLATE
  if (!CARTO_KEY) return template
  // ключ уже есть в шаблоне — не дублируем
  if (/[?&]key=/.test(template)) return template
  return `${template}${template.includes("?") ? "&" : "?"}key=${encodeURIComponent(CARTO_KEY)}`
}

/** Источник по умолчанию — carto: основная карта проекта. */
function resolveTileSource(): MapTileSource {
  const raw = (process.env.NEXT_PUBLIC_MAP_TILES || "").trim().toLowerCase()
  return raw === "esri" || raw === "osm" ? raw : "carto"
}

/** Спутник: снимок плюс границы и подписи поверх, иначе читать нечего. */
const SATELLITE_LAYERS: TileLayerSpec[] = [
  { url: ESRI_IMAGERY, attribution: "Esri World Imagery", maxZoom: 19 },
  { url: ESRI_BOUNDARIES, opacity: 0.9, maxZoom: 19 },
]

/**
 * Слои темы для источника.
 *
 * Тема «Графит» отличается от «Тёмной» фильтром (обесцвечивание), а не адресом:
 * оба стиля берутся с одного сервера, но визуально не сливаются.
 * CARTO и OSM спутник не отдают — для него используем Esri Imagery.
 */
function buildTileLayers(source: MapTileSource, theme: MapTheme): TileLayerSpec[] {
  if (theme === "satellite") {
    return SATELLITE_LAYERS
  }

  if (source === "carto") {
    const url = cartoTiles()
    return [
      {
        url,
        attribution: "© OpenStreetMap, © CARTO",
        // поддомены нужны только старым шаблонам вида {s}.basemaps.cartocdn.com
        subdomains: url.includes("{s}") ? "abcd" : undefined,
        maxZoom: 20,
        className: theme === "graphite" ? "map-tiles-graphite" : undefined,
      },
    ]
  }

  if (source === "osm") {
    return [
      {
        url: OSM_TILES,
        attribution: "© OpenStreetMap",
        maxZoom: 19,
        // Тайлы OSM светлые: переворачиваем их в тёмную сторону, а «Графит»
        // дополнительно обесцвечиваем, чтобы темы различались.
        className:
          theme === "graphite"
            ? "map-tiles-osm-dark map-tiles-graphite"
            : "map-tiles-osm-dark",
      },
    ]
  }

  const className = theme === "graphite" ? "map-tiles-graphite" : undefined
  return [
    { url: ESRI_DARK_BASE, attribution: "Esri Canvas Base", maxZoom: 18, className },
    { url: ESRI_DARK_REFERENCE, opacity: 0.85, maxZoom: 18, className },
  ]
}

interface UseMapInstanceOptions {
  containerRef: React.RefObject<HTMLDivElement | null>
  initialTheme?: MapTheme
}

interface UseMapInstanceReturn {
  /** Экземпляр карты (состояние для реактивности) */
  map: L.Map | null
  /** Canvas для анимации */
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>
  /** Перелететь к точке */
  flyTo: (position: [number, number], zoom?: number) => void
  /** Вписать все точки в видимую область */
  fitBounds: (points: [number, number][]) => void
  /** Текущая визуальная тема */
  theme: MapTheme
  /** Переключить тему оформления карты */
  setTheme: (theme: MapTheme) => void
}

export function useMapInstance({
  containerRef,
  initialTheme = "dark",
}: UseMapInstanceOptions): UseMapInstanceReturn {
  const [map, setMap] = useState<L.Map | null>(null)
  const [theme, setThemeState] = useState<MapTheme>(initialTheme)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const initializedRef = useRef(false)
  const baseLayersGroupRef = useRef<L.LayerGroup | null>(null)

  // Функция применения темы тайлов
  const applyTheme = useCallback((mapInstance: L.Map, newTheme: MapTheme) => {
    if (!mapInstance) return

    // Очищаем старые базовые слои
    if (baseLayersGroupRef.current) {
      baseLayersGroupRef.current.remove()
    }

    const group = L.layerGroup().addTo(mapInstance)
    baseLayersGroupRef.current = group

    // Источник читается из NEXT_PUBLIC_MAP_TILES: carto (по умолчанию,
    // основной картой проекта) | esri | osm. Ключ CARTO — NEXT_PUBLIC_CARTO_API_KEY.
    const source = resolveTileSource()

    for (const layer of buildTileLayers(source, newTheme)) {
      L.tileLayer(layer.url, {
        attribution: layer.attribution,
        opacity: layer.opacity,
        subdomains: layer.subdomains,
        className: layer.className,
        maxZoom: layer.maxZoom ?? 19,
        minZoom: 3,
      }).addTo(group)
    }
  }, [])

  const setTheme = useCallback(
    (newTheme: MapTheme) => {
      setThemeState(newTheme)
      if (map) {
        applyTheme(map, newTheme)
      }
      try {
        localStorage.setItem("tms_map_theme", newTheme)
      } catch {
        // ignore
      }
    },
    [map, applyTheme]
  )

  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return

    initializedRef.current = true

    // Загрузка сохраненной темы
    let savedTheme: MapTheme = initialTheme
    try {
      const stored = localStorage.getItem("tms_map_theme") as MapTheme
      if (stored === "dark" || stored === "graphite" || stored === "satellite") {
        savedTheme = stored
        setThemeState(stored)
      }
    } catch {
      // ignore
    }

    // Инициализация карты
    const mapInstance = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM)

    // Применяем тему
    applyTheme(mapInstance, savedTheme)

    // Кастомный zoom контрол справа внизу
    L.control.zoom({ position: "bottomright" }).addTo(mapInstance)

    setMap(mapInstance)

    // Canvas overlay для анимации маршрутов
    const canvas = document.createElement("canvas")
    canvas.style.position = "absolute"
    canvas.style.top = "0"
    canvas.style.left = "0"
    canvas.style.pointerEvents = "none"
    canvas.style.zIndex = "400"
    containerRef.current.appendChild(canvas)
    canvasRef.current = canvas

    const resizeCanvas = () => {
      if (!canvas || !containerRef.current) return
      canvas.width = containerRef.current.offsetWidth
      canvas.height = containerRef.current.offsetHeight
    }

    resizeCanvas()
    window.addEventListener("resize", resizeCanvas)
    mapInstance.on("move zoom viewreset", resizeCanvas)

    return () => {
      window.removeEventListener("resize", resizeCanvas)
      mapInstance.remove()
      setMap(null)
      initializedRef.current = false
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
    }
  }, [containerRef, initialTheme, applyTheme])

  const flyTo = useCallback(
    (position: [number, number], zoom = 14) => {
      map?.flyTo(position, zoom, { duration: 1.2 })
    },
    [map]
  )

  const fitBounds = useCallback(
    (points: [number, number][]) => {
      if (points.length === 0 || !map) return
      const bounds = L.latLngBounds(points)
      map.fitBounds(bounds, { padding: [70, 70], maxZoom: 11 })
    },
    [map]
  )

  return { map, canvasRef, flyTo, fitBounds, theme, setTheme }
}
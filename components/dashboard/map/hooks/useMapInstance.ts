// components/dashboard/map/hooks/useMapInstance.ts

import { useEffect, useRef, useState, useCallback } from "react"
import L from "leaflet"
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from "../constants"

export type MapTheme = "dark" | "graphite" | "satellite"

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

    if (newTheme === "dark") {
      // ═══════════════════════════════════════════════════════════════
      // CARTO DARK MATTER — Ультрастильный тёмный минимализм
      // ═══════════════════════════════════════════════════════════════
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        {
          subdomains: "abcd",
          maxZoom: 19,
          minZoom: 3,
          attribution: "CartoDB Dark Matter",
        }
      ).addTo(group)
    } else if (newTheme === "graphite") {
      // ═══════════════════════════════════════════════════════════════
      // ESRI CANVAS DARK GRAY — Нейтральный инженерный графит
      // ═══════════════════════════════════════════════════════════════
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 18,
          minZoom: 3,
          attribution: "Esri Canvas Base",
        }
      ).addTo(group)

      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 18,
          minZoom: 3,
          opacity: 0.85,
        }
      ).addTo(group)
    } else if (newTheme === "satellite") {
      // ═══════════════════════════════════════════════════════════════
      // SATELLITE HIGH-RES + DARK ROADS/LABELS
      // ═══════════════════════════════════════════════════════════════
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 19,
          minZoom: 3,
          attribution: "Esri Satellite",
        }
      ).addTo(group)

      // Дорожная сеть и подписи поверх спутника для максимальной читаемости
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png",
        {
          subdomains: "abcd",
          maxZoom: 19,
          minZoom: 3,
          opacity: 0.9,
        }
      ).addTo(group)
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
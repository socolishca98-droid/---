// components/dashboard/map/hooks/useMapInstance.ts
//
// Экземпляр карты Leaflet и его оформление.
//
// Что здесь важно:
//  — карта создаётся один раз на контейнер и корректно уничтожается (React 19 в
//    режиме StrictMode монтирует эффекты дважды — без этого Leaflet падал с
//    «Map container is already initialized»);
//  — базовые слои (тайлы) собраны в LayerGroup: смена темы меняет один слой,
//    а не пересоздаёт карту;
//  — размер контейнера меняется не только при ресайзе окна (сворачивание
//    бокового меню, открытие панелей), поэтому за контейнером следит
//    ResizeObserver и честно вызывает invalidateSize() — без него карта
//    оставалась «серой» и клики попадали не туда;
//  — canvas для анимации маршрутов больше не создаётся здесь: его рисует
//    useRouteAnimation в собственном pane карты (см. комментарий там).

import { useCallback, useEffect, useRef, useState } from "react"
import L from "leaflet"
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from "../constants"

export type MapTheme = "dark" | "graphite" | "satellite"

const THEME_STORAGE_KEY = "tms_map_theme"
const THEMES: MapTheme[] = ["dark", "graphite", "satellite"]

/** Базовые слои для каждой темы: тайлы + подпись прав внизу. */
const BASE_LAYERS: Record<MapTheme, Array<{ url: string; options: L.TileLayerOptions }>> = {
  // CARTO Dark Matter — тёмный минимализм, на нём читаются неоновые маршруты
  dark: [
    {
      url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      options: {
        subdomains: "abcd",
        maxZoom: 19,
        minZoom: 3,
        attribution: "© OpenStreetMap · CARTO Dark Matter",
        crossOrigin: true,
      },
    },
  ],
  // Esri Canvas Dark Gray — нейтральный инженерный графит
  graphite: [
    {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      options: {
        maxZoom: 18,
        minZoom: 3,
        attribution: "© Esri Canvas Base",
        crossOrigin: true,
      },
    },
    {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
      options: { maxZoom: 18, minZoom: 3, opacity: 0.85, crossOrigin: true },
    },
  ],
  // Спутник + тёмные подписи дорог поверх снимка
  satellite: [
    {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      options: { maxZoom: 19, minZoom: 3, attribution: "© Esri Satellite", crossOrigin: true },
    },
    {
      url: "https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png",
      options: { subdomains: "abcd", maxZoom: 19, minZoom: 3, opacity: 0.9, crossOrigin: true },
    },
  ],
}

interface UseMapInstanceOptions {
  containerRef: React.RefObject<HTMLDivElement | null>
  initialTheme?: MapTheme
}

interface UseMapInstanceReturn {
  /** Экземпляр карты (состояние — чтобы слои рисовались после инициализации) */
  map: L.Map | null
  /** Перелететь к точке */
  flyTo: (position: [number, number], zoom?: number) => void
  /** Вписать все точки в видимую область */
  fitBounds: (points: [number, number][]) => void
  /** Текущая визуальная тема */
  theme: MapTheme
  /** Переключить тему оформления карты */
  setTheme: (theme: MapTheme) => void
  /** Тайлы базового слоя загружены (можно убирать заглушку загрузки) */
  tilesReady: boolean
}

function isTheme(value: unknown): value is MapTheme {
  return typeof value === "string" && (THEMES as string[]).includes(value)
}

export function useMapInstance({
  containerRef,
  initialTheme = "dark",
}: UseMapInstanceOptions): UseMapInstanceReturn {
  const [map, setMap] = useState<L.Map | null>(null)
  const [theme, setThemeState] = useState<MapTheme>(initialTheme)
  const [tilesReady, setTilesReady] = useState(false)

  const mapRef = useRef<L.Map | null>(null)
  const baseLayersGroupRef = useRef<L.LayerGroup | null>(null)

  const applyTheme = useCallback((instance: L.Map, nextTheme: MapTheme) => {
    if (baseLayersGroupRef.current) {
      baseLayersGroupRef.current.remove()
      baseLayersGroupRef.current = null
    }

    const group = L.layerGroup()
    let pending = BASE_LAYERS[nextTheme].length

    for (const layer of BASE_LAYERS[nextTheme]) {
      const tile = L.tileLayer(layer.url, layer.options)
      tile.on("load", () => {
        pending -= 1
        if (pending <= 0) setTilesReady(true)
      })
      tile.on("tileerror", () => {
        // Сеть может не отвечать (офлайн/прокси) — карта остаётся живой,
        // просто без подложки: состояние загрузки не должно «залипать»
        pending -= 1
        if (pending <= 0) setTilesReady(true)
      })
      tile.addTo(group)
    }

    group.addTo(instance)
    baseLayersGroupRef.current = group
    setTilesReady(false)
  }, [])

  const setTheme = useCallback(
    (nextTheme: MapTheme) => {
      setThemeState(nextTheme)
      if (mapRef.current) applyTheme(mapRef.current, nextTheme)
      try {
        localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
      } catch {
        // приватный режим браузера — не критично
      }
    },
    [applyTheme],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let savedTheme: MapTheme = initialTheme
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY)
      if (isTheme(stored)) {
        savedTheme = stored
        setThemeState(stored)
      }
    } catch {
      // ignore
    }

    // Страховка от повторной инициализации того же контейнера (StrictMode,
    // быстрый перемонтаж): прежний экземпляр уничтожаем сами.
    if (mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
      baseLayersGroupRef.current = null
    }

    const instance = L.map(container, {
      center: DEFAULT_MAP_CENTER,
      zoom: DEFAULT_MAP_ZOOM,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
      // Плавность без «резины»: инерция есть, но карта не улетает за край
      inertiaDeceleration: 3000,
      maxBoundsViscosity: 0.6,
      worldCopyJump: true,
    })

    mapRef.current = instance
    applyTheme(instance, savedTheme)
    L.control.zoom({ position: "bottomright" }).addTo(instance)

    // Размер контейнера меняется при сворачивании меню и открытии панелей
    const observer = new ResizeObserver(() => {
      instance.invalidateSize({ animate: false })
    })
    observer.observe(container)

    setMap(instance)

    return () => {
      observer.disconnect()
      baseLayersGroupRef.current?.remove()
      baseLayersGroupRef.current = null
      instance.remove()
      mapRef.current = null
      setMap(null)
    }
  }, [containerRef, initialTheme, applyTheme])

  const flyTo = useCallback((position: [number, number], zoom = 14) => {
    mapRef.current?.flyTo(position, zoom, { duration: 1.1 })
  }, [])

  const fitBounds = useCallback((points: [number, number][]) => {
    const instance = mapRef.current
    if (!instance || points.length === 0) return
    const valid = points.filter(
      ([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180,
    )
    if (valid.length === 0) return
    const bounds = L.latLngBounds(valid)
    if (valid.length === 1) {
      instance.flyTo(valid[0], 12, { duration: 0.9 })
      return
    }
    instance.fitBounds(bounds, { padding: [80, 80], maxZoom: 11, animate: true })
  }, [])

  return { map, flyTo, fitBounds, theme, setTheme, tilesReady }
}

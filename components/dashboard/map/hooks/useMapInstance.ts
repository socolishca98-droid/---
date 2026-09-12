// components/dashboard/map/hooks/useMapInstance.ts

import { useEffect, useRef, useState, useCallback } from "react"
import L from "leaflet"
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from "../constants"

interface UseMapInstanceOptions {
  // ✅ ИСПРАВЛЕНО: добавлен | null для совместимости с useRef<HTMLDivElement>(null)
  containerRef: React.RefObject<HTMLDivElement | null>
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
}

export function useMapInstance({
  containerRef,
}: UseMapInstanceOptions): UseMapInstanceReturn {
  // Используем state вместо ref для реактивности
  const [map, setMap] = useState<L.Map | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const initializedRef = useRef(false)

  useEffect(() => {
    // ✅ Проверяем что контейнер существует и карта ещё не создана
    if (!containerRef.current || initializedRef.current) return

    initializedRef.current = true

    // Инициализация карты
    const mapInstance = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM)

    // Тёмная тема карты
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { maxZoom: 19 }
    ).addTo(mapInstance)

    // Zoom контрол справа внизу
    L.control.zoom({ position: "bottomright" }).addTo(mapInstance)

    // Устанавливаем state — это вызовет ре-рендер
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

    // Ресайз canvas
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
  }, [containerRef])

  const flyTo = useCallback(
    (position: [number, number], zoom = 14) => {
      map?.flyTo(position, zoom, { duration: 1.5 })
    },
    [map]
  )

  const fitBounds = useCallback(
    (points: [number, number][]) => {
      if (points.length === 0 || !map) return
      const bounds = L.latLngBounds(points)
      map.fitBounds(bounds, { padding: [80, 80], maxZoom: 10 })
    },
    [map]
  )

  return { map, canvasRef, flyTo, fitBounds }
}
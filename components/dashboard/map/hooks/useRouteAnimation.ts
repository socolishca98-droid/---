// components/dashboard/map/hooks/useRouteAnimation.ts
//
// Анимированные нити рейсов поверх карты.
//
// Как это устроено (и почему именно так):
//  — canvas живёт в собственном pane Leaflet (`routeAnimationPane`, z-index 450):
//    ниже маркеров водителей и точек маршрута (600), выше тайлов и слоя пробок
//    (400/420). Раньше canvas вешался поверх контейнера карты и перекрывал
//    маркеры с попапами;
//  — рисуем в координатах слоя (latLngToLayerPoint), а не в координатах
//    контейнера: pane двигается вместе с картой, поэтому при перетаскивании
//    нити не «отстают» и не требуют перерисовки на каждый кадр;
//  — canvas больше видимой области на 35% (padding) и пересчитывается на
//    moveend/zoomend/resize — при перетаскивании по краям не появляется пустоты;
//  — учитываем devicePixelRatio (иначе на retina линии были мыльными и вдвое
//    смещёнными) и ставим анимацию на паузу в скрытой вкладке;
//  — prefers-reduced-motion: рисуем статичные нити без «кометы» и без цикла
//    requestAnimationFrame.

import { useEffect, useRef } from "react"
import L from "leaflet"
import type { RouteData } from "../types"

interface UseRouteAnimationOptions {
  map: L.Map | null
  routes: RouteData[]
  enabled: boolean
}

const PANE_NAME = "routeAnimationPane"
/** Ниже маркеров (600) и инцидентов пробок (460), выше тайлов (200) и пробок (420). */
const PANE_Z_INDEX = "450"
const FPS = 30
const FRAME_MS = 1000 / FPS
/** Скорость движения светового импульса: оборот за ~6 секунд. */
const PULSE_SPEED = 0.16
/** На сколько canvas больше видимой области (доля ширины/высоты). */
const CANVAS_PADDING = 0.35
const MAX_DPR = 2

const FALLBACK_COLOR = "#38bdf8"

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** Прозрачность цвета вида #rrggbb → rgba(r, g, b, alpha) */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.trim()
  if (!value.startsWith("#") || (value.length !== 4 && value.length !== 7)) {
    return `rgba(56, 189, 248, ${alpha})`
  }
  const full =
    value.length === 4
      ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
      : value
  const int = parseInt(full.slice(1), 16)
  if (!Number.isFinite(int)) return `rgba(56, 189, 248, ${alpha})`
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function isValidLatLng(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Math.abs(value[0]) <= 90 &&
    Math.abs(value[1]) <= 180
  )
}

export function useRouteAnimation({ map, routes, enabled }: UseRouteAnimationOptions): void {
  // Данные читаем из ref: обновление списка рейсов не должно пересоздавать
  // canvas и pane (иначе карта «мигает» на каждом опросе сервера).
  const routesRef = useRef<RouteData[]>(routes)
  const enabledRef = useRef(enabled)
  const dirtyRef = useRef(true)

  useEffect(() => {
    routesRef.current = Array.isArray(routes) ? routes : []
    dirtyRef.current = true
  }, [routes])

  useEffect(() => {
    enabledRef.current = enabled
    dirtyRef.current = true
  }, [enabled])

  useEffect(() => {
    if (!map) return

    const pane = map.getPane(PANE_NAME) ?? map.createPane(PANE_NAME)
    pane.style.zIndex = PANE_Z_INDEX
    pane.style.pointerEvents = "none"

    const canvas = document.createElement("canvas")
    canvas.style.position = "absolute"
    canvas.style.left = "0"
    canvas.style.top = "0"
    canvas.style.pointerEvents = "none"
    canvas.setAttribute("aria-hidden", "true")
    pane.appendChild(canvas)

    const ctx = canvas.getContext("2d")
    if (!ctx) {
      pane.removeChild(canvas)
      return
    }

    // Левый верхний угол canvas в координатах слоя
    let origin = L.point(0, 0)
    let cssWidth = 0
    let cssHeight = 0

    const updateGeometry = () => {
      if (!map.getContainer().clientWidth) return

      const pixelBounds = map.getPixelBounds()
      const min = pixelBounds.min ?? L.point(0, 0)
      const size = pixelBounds.getSize()
      const padX = Math.round(size.x * CANVAS_PADDING)
      const padY = Math.round(size.y * CANVAS_PADDING)

      origin = L.point(min.x - padX, min.y - padY)
      cssWidth = size.x + padX * 2
      cssHeight = size.y + padY * 2

      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      canvas.width = Math.max(1, Math.round(cssWidth * dpr))
      canvas.height = Math.max(1, Math.round(cssHeight * dpr))
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`
      L.DomUtil.setPosition(canvas, origin)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    /** Точки рейса в координатах canvas (координаты слоя минус origin). */
    const projectRoute = (route: RouteData): Array<{ x: number; y: number }> => {
      const coordinates = Array.isArray(route.coordinates) ? route.coordinates : []
      const points: Array<{ x: number; y: number }> = []
      for (const coordinate of coordinates) {
        if (!isValidLatLng(coordinate)) continue
        const layerPoint = map.latLngToLayerPoint([coordinate[0], coordinate[1]])
        points.push({ x: layerPoint.x - origin.x, y: layerPoint.y - origin.y })
      }
      return points
    }

    const tracePath = (points: Array<{ x: number; y: number }>) => {
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y)
    }

    const drawRoute = (route: RouteData, progress: number, reduced: boolean) => {
      const points = projectRoute(route)
      if (points.length < 2) return

      const color = route.color || FALLBACK_COLOR

      // 1. Мягкое свечение под нитью — линия читается на любом тайле
      ctx.lineCap = "round"
      ctx.lineJoin = "round"
      tracePath(points)
      ctx.strokeStyle = withAlpha(color, 0.16)
      ctx.lineWidth = 13
      ctx.stroke()

      // 2. Основная нить
      tracePath(points)
      ctx.strokeStyle = withAlpha(color, 0.85)
      ctx.lineWidth = 3.4
      ctx.stroke()

      // 3. Тонкая светлая сердцевина
      tracePath(points)
      ctx.strokeStyle = "rgba(255, 255, 255, 0.22)"
      ctx.lineWidth = 1.1
      ctx.stroke()

      // 4. Точка отправления
      const start = points[0]
      ctx.beginPath()
      ctx.arc(start.x, start.y, 5.5, 0, Math.PI * 2)
      ctx.fillStyle = withAlpha(color, 0.95)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(start.x, start.y, 2.2, 0, Math.PI * 2)
      ctx.fillStyle = "#ffffff"
      ctx.fill()

      if (reduced) return

      // 5. Световой импульс, бегущий по нити («груз едет»)
      const total = points.length - 1
      const position = progress * total
      const index = Math.min(total - 1, Math.max(0, Math.floor(position)))
      const ratio = position - index
      const from = points[index]
      const to = points[index + 1] ?? points[index]
      const x = from.x + (to.x - from.x) * ratio
      const y = from.y + (to.y - from.y) * ratio

      const glow = ctx.createRadialGradient(x, y, 0, x, y, 16)
      glow.addColorStop(0, withAlpha(color, 0.55))
      glow.addColorStop(1, withAlpha(color, 0))
      ctx.beginPath()
      ctx.arc(x, y, 16, 0, Math.PI * 2)
      ctx.fillStyle = glow
      ctx.fill()

      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fillStyle = "#ffffff"
      ctx.fill()
      ctx.beginPath()
      ctx.arc(x, y, 6.4, 0, Math.PI * 2)
      ctx.strokeStyle = withAlpha(color, 0.85)
      ctx.lineWidth = 1.6
      ctx.stroke()
    }

    const draw = (progress: number) => {
      ctx.clearRect(0, 0, cssWidth, cssHeight)
      if (!enabledRef.current) return

      const reduced = prefersReducedMotion()
      const list = routesRef.current
      for (const route of list) {
        if (!route || !Array.isArray(route.coordinates) || route.coordinates.length < 2) continue
        drawRoute(route, progress, reduced)
      }
    }

    updateGeometry()
    draw(0)

    let frame = 0
    let last = 0
    let progress = 0

    const loop = (timestamp: number) => {
      frame = window.requestAnimationFrame(loop)

      if (typeof document !== "undefined" && document.hidden) return
      if (timestamp - last < FRAME_MS) return

      const delta = last ? Math.min(timestamp - last, 250) : 0
      last = timestamp

      const reduced = prefersReducedMotion()
      const hasRoutes = routesRef.current.some(
        (route) => Array.isArray(route?.coordinates) && route.coordinates.length >= 2,
      )

      if (!enabledRef.current || !hasRoutes) {
        if (dirtyRef.current) {
          ctx.clearRect(0, 0, cssWidth, cssHeight)
          dirtyRef.current = false
        }
        return
      }

      if (reduced) {
        if (dirtyRef.current) {
          draw(0)
          dirtyRef.current = false
        }
        return
      }

      progress = (progress + (delta / 1000) * PULSE_SPEED) % 1
      dirtyRef.current = false
      draw(progress)
    }

    frame = window.requestAnimationFrame(loop)

    // Геометрия canvas пересчитывается, когда меняется видимая область карты
    const onViewChange = () => {
      updateGeometry()
      dirtyRef.current = true
      draw(progress)
    }

    map.on("moveend zoomend resize zoomlevelschange", onViewChange)

    return () => {
      window.cancelAnimationFrame(frame)
      map.off("moveend zoomend resize zoomlevelschange", onViewChange)
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
    }
  }, [map])
}

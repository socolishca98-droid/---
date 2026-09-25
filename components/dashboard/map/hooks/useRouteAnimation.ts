// components/dashboard/map/hooks/useRouteAnimation.ts

import { useEffect, useRef } from "react"
import type L from "leaflet"
import type { RouteData } from "../types"
import type { TrafficRouteInfo } from "@/lib/traffic/types"

interface UseRouteAnimationOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  map: L.Map | null
  routes: RouteData[]
  enabled: boolean
  trafficByRouteId?: Record<string, TrafficRouteInfo>
}

const CONFIG = {
  fps: 30,
  gradientSpeed: 0.003, // Скорость движения градиента
}

export function useRouteAnimation({
  canvasRef,
  map,
  routes,
  enabled,
  trafficByRouteId,
}: UseRouteAnimationOptions): void {
  const routesRef = useRef<RouteData[]>(routes)
  const trafficRef = useRef<Record<string, TrafficRouteInfo> | undefined>(trafficByRouteId)
  const frameRef = useRef<number>(0)
  const timeRef = useRef<number>(0)
  const lastTimeRef = useRef<number>(0)

  useEffect(() => {
    routesRef.current = routes
  }, [routes])

  useEffect(() => {
    trafficRef.current = trafficByRouteId
  }, [trafficByRouteId])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !map) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const frameMs = 1000 / CONFIG.fps

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = map.getContainer()
      const dpr = window.devicePixelRatio || 1
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = w + "px"
      canvas.style.height = h + "px"
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    resize()
    map.on("resize moveend zoomend", resize)

    const draw = (timestamp: number) => {
      const delta = timestamp - lastTimeRef.current
      if (delta < frameMs) {
        frameRef.current = requestAnimationFrame(draw)
        return
      }
      lastTimeRef.current = timestamp
      timeRef.current += CONFIG.gradientSpeed

      const { clientWidth: w, clientHeight: h } = map.getContainer()
      ctx.clearRect(0, 0, w, h)

      if (!enabled) {
        frameRef.current = requestAnimationFrame(draw)
        return
      }

      const t = timeRef.current % 1 // 0 → 1 зацикленно

      for (const route of routesRef.current) {
        if (!route.coordinates || route.coordinates.length < 2) continue

        const points = route.coordinates.map((c: any) => {
          const p = map.latLngToContainerPoint([c[0], c[1]])
          return { x: p.x, y: p.y }
        })

        const bounds = map.getBounds()
        if (!route.coordinates.some((c: any) => bounds.contains([c[0], c[1]]))) continue

        const start = points[0]
        const end = points[points.length - 1]

        // ═══════════════════════════════════════════════════
        // СЛОЙ 1: Деликатное мягкое свечение (glow)
        // ═══════════════════════════════════════════════════
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y)
        }
        ctx.strokeStyle = "rgba(56, 189, 248, 0.15)"
        ctx.lineWidth = 12
        ctx.lineCap = "round"
        ctx.lineJoin = "round"
        ctx.stroke()

        // ═══════════════════════════════════════════════════
        // СЛОЙ 2: Основная линия с движущимся импульсом
        // ═══════════════════════════════════════════════════
        const gradient = ctx.createLinearGradient(start.x, start.y, end.x, end.y)
        
        // Движущийся яркий участок
        const pos = t
        const fadeWidth = 0.22

        // Базовый цвет нити — мягкий сапфирово-лазурный
        gradient.addColorStop(0, "rgba(56, 189, 248, 0.35)")
        
        if (pos > fadeWidth) {
          gradient.addColorStop(Math.max(0, pos - fadeWidth), "rgba(56, 189, 248, 0.35)")
        }
        
        // Яркий световой импульс
        gradient.addColorStop(Math.min(1, pos), "rgba(186, 230, 253, 0.95)")
        
        if (pos + fadeWidth < 1) {
          gradient.addColorStop(Math.min(1, pos + fadeWidth), "rgba(56, 189, 248, 0.7)")
        }
        
        gradient.addColorStop(1, "rgba(56, 189, 248, 0.4)")

        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y)
        }
        ctx.strokeStyle = gradient
        ctx.lineWidth = 3.5
        ctx.lineCap = "round"
        ctx.lineJoin = "round"
        ctx.stroke()

        // ═══════════════════════════════════════════════════
        // СЛОЙ 3: Светлая тонкая сердцевина
        // ═══════════════════════════════════════════════════
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y)
        }
        ctx.strokeStyle = "rgba(255, 255, 255, 0.25)"
        ctx.lineWidth = 1.2
        ctx.lineCap = "round"
        ctx.lineJoin = "round"
        ctx.stroke()

        // ═══════════════════════════════════════════════════
        // СЛОЙ 4: Точка старта (депо / отправление)
        // ═══════════════════════════════════════════════════
        ctx.beginPath()
        ctx.arc(start.x, start.y, 6, 0, Math.PI * 2)
        ctx.fillStyle = "#38bdf8"
        ctx.fill()
        
        ctx.beginPath()
        ctx.arc(start.x, start.y, 2.5, 0, Math.PI * 2)
        ctx.fillStyle = "#ffffff"
        ctx.fill()
      }

      frameRef.current = requestAnimationFrame(draw)
    }

    frameRef.current = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(frameRef.current)
      map.off("resize moveend zoomend", resize)
    }
  }, [canvasRef, map, enabled])
}
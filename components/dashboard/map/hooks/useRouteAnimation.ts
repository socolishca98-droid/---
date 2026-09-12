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
}: UseRouteAnimationOptions): void {
  const routesRef = useRef<RouteData[]>(routes)
  const frameRef = useRef<number>(0)
  const timeRef = useRef<number>(0)
  const lastTimeRef = useRef<number>(0)

  useEffect(() => {
    routesRef.current = routes
  }, [routes])

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

        const points = route.coordinates.map((c) => {
          const p = map.latLngToContainerPoint([c[0], c[1]])
          return { x: p.x, y: p.y }
        })

        const bounds = map.getBounds()
        if (!route.coordinates.some((c) => bounds.contains([c[0], c[1]]))) continue

        const start = points[0]
        const end = points[points.length - 1]

        // ═══════════════════════════════════════════════════
        // СЛОЙ 1: Свечение (glow)
        // ═══════════════════════════════════════════════════
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y)
        }
        ctx.strokeStyle = "rgba(255, 107, 53, 0.2)"
        ctx.lineWidth = 16
        ctx.lineCap = "round"
        ctx.lineJoin = "round"
        ctx.stroke()

        // ═══════════════════════════════════════════════════
        // СЛОЙ 2: Основная линия с движущимся градиентом
        // ═══════════════════════════════════════════════════
        const gradient = ctx.createLinearGradient(start.x, start.y, end.x, end.y)
        
        // Движущийся яркий участок
        const pos = t
        const fadeWidth = 0.25

        // До яркого участка — тёмный
        gradient.addColorStop(0, "rgba(255, 107, 53, 0.35)")
        
        // Плавный переход к яркому
        if (pos > fadeWidth) {
          gradient.addColorStop(Math.max(0, pos - fadeWidth), "rgba(255, 107, 53, 0.35)")
        }
        
        // Яркий участок (движущийся)
        gradient.addColorStop(Math.min(1, pos), "rgba(255, 140, 80, 1)")
        
        // Плавный переход после яркого
        if (pos + fadeWidth < 1) {
          gradient.addColorStop(Math.min(1, pos + fadeWidth), "rgba(255, 107, 53, 0.9)")
        }
        
        // После — средняя яркость
        gradient.addColorStop(1, "rgba(255, 107, 53, 0.5)")

        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y)
        }
        ctx.strokeStyle = gradient
        ctx.lineWidth = 5
        ctx.lineCap = "round"
        ctx.lineJoin = "round"
        ctx.stroke()

        // ═══════════════════════════════════════════════════
        // СЛОЙ 3: Светлая сердцевина
        // ═══════════════════════════════════════════════════
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y)
        }
        ctx.strokeStyle = "rgba(255, 200, 150, 0.25)"
        ctx.lineWidth = 2
        ctx.lineCap = "round"
        ctx.lineJoin = "round"
        ctx.stroke()

        // ═══════════════════════════════════════════════════
        // СЛОЙ 4: Точка старта
        // ═══════════════════════════════════════════════════
        ctx.beginPath()
        ctx.arc(start.x, start.y, 7, 0, Math.PI * 2)
        ctx.fillStyle = "#FF6B35"
        ctx.fill()
        
        ctx.beginPath()
        ctx.arc(start.x, start.y, 3, 0, Math.PI * 2)
        ctx.fillStyle = "#fff"
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
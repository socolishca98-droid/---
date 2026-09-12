"use client"

import { useEffect, useRef } from "react"
import { Card, CardContent } from "@/components/ui/card"

interface Waypoint {
  name: string
  type: "start" | "waypoint" | "end"
}

interface RouteMapProps {
  waypoints: Waypoint[]
  className?: string
}

export function RouteMap({ waypoints, className }: RouteMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Set canvas size
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * 2
    canvas.height = rect.height * 2
    ctx.scale(2, 2)

    const width = rect.width
    const height = rect.height

    // Clear canvas
    ctx.fillStyle = "hsl(260, 10%, 13%)"
    ctx.fillRect(0, 0, width, height)

    // Draw grid
    ctx.strokeStyle = "hsl(260, 10%, 20%)"
    ctx.lineWidth = 0.5
    const gridSize = 30
    for (let x = 0; x < width; x += gridSize) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }
    for (let y = 0; y < height; y += gridSize) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }

    // Calculate point positions
    const padding = 60
    const pointSpacing = (width - padding * 2) / Math.max(waypoints.length - 1, 1)

    const points = waypoints.map((wp, i) => ({
      x: padding + i * pointSpacing,
      y: height / 2 + Math.sin(i * 0.8) * 40,
      ...wp,
    }))

    // Draw route line
    ctx.strokeStyle = "hsl(30, 80%, 55%)"
    ctx.lineWidth = 3
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.setLineDash([])

    ctx.beginPath()
    points.forEach((point, i) => {
      if (i === 0) {
        ctx.moveTo(point.x, point.y)
      } else {
        // Draw curved line
        const prev = points[i - 1]
        const cpX = (prev.x + point.x) / 2
        ctx.quadraticCurveTo(cpX, prev.y, point.x, point.y)
      }
    })
    ctx.stroke()

    // Draw points
    points.forEach((point) => {
      // Outer circle
      ctx.beginPath()
      ctx.arc(point.x, point.y, 12, 0, Math.PI * 2)
      ctx.fillStyle =
        point.type === "start"
          ? "hsl(145, 60%, 45%)"
          : point.type === "end"
            ? "hsl(30, 80%, 55%)"
            : "hsl(260, 10%, 35%)"
      ctx.fill()

      // Inner circle
      ctx.beginPath()
      ctx.arc(point.x, point.y, 6, 0, Math.PI * 2)
      ctx.fillStyle = "hsl(260, 10%, 95%)"
      ctx.fill()

      // Label
      ctx.fillStyle = "hsl(260, 10%, 75%)"
      ctx.font = "12px Inter, sans-serif"
      ctx.textAlign = "center"
      ctx.fillText(point.name, point.x, point.y + 30)
    })
  }, [waypoints])

  return (
    <Card className={`bg-card border-border overflow-hidden ${className}`}>
      <CardContent className="p-0">
        <canvas ref={canvasRef} className="w-full h-[200px]" style={{ display: "block" }} />
      </CardContent>
    </Card>
  )
}

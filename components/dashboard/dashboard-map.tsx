// components/dashboard/dashboard-map.tsx

"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { 
  RefreshCw, 
  Package, 
  Users,
  X,
  Building2,
  Route,
  Zap,
  TrendingUp,
  MapPin,
  ChevronRight,
  Activity,
  Timer,
  Truck,
  AlertTriangle
} from "lucide-react"
import Link from "next/link"

// ============================================
// ТИПЫ
// ============================================

interface Waypoint {
  type: 'driver' | 'loading' | 'unloading' | 'base'
  label: string
  address: string
  position: [number, number] | null
}

interface OrderInfo {
  id: string
  from: string
  to: string
  cargo: string
  price: number
  status: string
}

interface RouteData {
  id: string
  driverId: string
  driverName: string
  vehiclePlate?: string
  driverPos: [number, number]
  orders: OrderInfo[]
  waypoints: Waypoint[]
  coordinates: [number, number][]
  totalDistance: number
  totalPrice: number
  duration: number
  status: string
  routeFrom: string
  routeTo: string
  cargoType: string
}

interface BaseData {
  name: string
  address: string
  coordinates: [number, number]
}

interface DriverLocation {
  id: string
  name: string
  latitude: number | null
  longitude: number | null
  status: string
  statusDuration?: number
  vehiclePlate?: string
  vehicleType?: string
  phone?: string
  routeFrom?: string
  routeTo?: string
  cargoType?: string
  orderPrice?: number
  hasOrder?: boolean
}

interface Stats {
  online: number
  inRoute: number
  total: number
  orders: { total: number; active: number; completedToday: number; newToday: number }
  revenue: number
  alerts: number
}

// ============================================
// КОНФИГУРАЦИЯ
// ============================================

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  driving: { label: 'В пути', color: '#FF6B35', bg: 'rgba(255,107,53,0.15)' },
  in_transit: { label: 'В пути', color: '#FF6B35', bg: 'rgba(255,107,53,0.15)' },
  loading: { label: 'Погрузка', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
  unloading: { label: 'Выгрузка', color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
  fueling: { label: 'Заправка', color: '#a855f7', bg: 'rgba(168,85,247,0.15)' },
  resting: { label: 'Отдых', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  sleeping: { label: 'Сон', color: '#6366f1', bg: 'rgba(99,102,241,0.15)' },
  waiting: { label: 'Ожидание', color: '#64748b', bg: 'rgba(100,116,139,0.15)' },
  available: { label: 'Свободен', color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
  confirmed: { label: 'Подтверждён', color: '#06b6d4', bg: 'rgba(6,182,212,0.15)' },
  offline: { label: 'Офлайн', color: '#475569', bg: 'rgba(71,85,105,0.15)' },
  busy: { label: 'Занят', color: '#FF6B35', bg: 'rgba(255,107,53,0.15)' },
  maintenance: { label: 'На ТО', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
}

const WAYPOINT_COLORS: Record<string, string> = {
  driver: '#22c55e',
  loading: '#3b82f6',
  unloading: '#10b981',
  base: '#FF6B35',
}

const formatDuration = (seconds: number): string => {
  if (!seconds) return '0м'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}ч ${m}м` : `${m}м`
}

const formatDistance = (km: number): string => {
  if (km >= 1000) return `${(km / 1000).toFixed(1)}тыс`
  return `${km}`
}

// ============================================
// КОМПОНЕНТ
// ============================================

export default function DashboardMap() {
  const mapRef = useRef<L.Map | null>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const markersRef = useRef<Map<string, L.Marker>>(new Map())
  const waypointMarkersRef = useRef<L.Marker[]>([])
  const baseMarkerRef = useRef<L.Marker | null>(null)
  const animationRef = useRef<number>(0)
  const routesDataRef = useRef<RouteData[]>([])
  
  const [drivers, setDrivers] = useState<DriverLocation[]>([])
  const [routes, setRoutes] = useState<RouteData[]>([])
  const [base, setBase] = useState<BaseData | null>(null)
  const [baseWarning, setBaseWarning] = useState<string | null>(null)
  const [stats, setStats] = useState<Stats>({
    online: 0,
    inRoute: 0,
    total: 0,
    orders: { total: 0, active: 0, completedToday: 0, newToday: 0 },
    revenue: 0,
    alerts: 0,
  })
  const [isLoading, setIsLoading] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [showDriversList, setShowDriversList] = useState(false)
  const [showRoutes, setShowRoutes] = useState(true)
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null)
  const [totalActiveKm, setTotalActiveKm] = useState(0)

  // ============================================
  // ИНИЦИАЛИЗАЦИЯ КАРТЫ
  // ============================================
  
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([55.75, 37.61], 6)

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
    }).addTo(map)

    L.control.zoom({ position: "bottomright" }).addTo(map)

    mapRef.current = map

    // Canvas overlay
    const canvas = document.createElement('canvas')
    canvas.style.position = 'absolute'
    canvas.style.top = '0'
    canvas.style.left = '0'
    canvas.style.pointerEvents = 'none'
    canvas.style.zIndex = '400'
    mapContainerRef.current.appendChild(canvas)
    canvasRef.current = canvas

    const resizeCanvas = () => {
      if (!canvas || !mapContainerRef.current) return
      canvas.width = mapContainerRef.current.offsetWidth
      canvas.height = mapContainerRef.current.offsetHeight
    }

    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)
    map.on('move zoom viewreset', resizeCanvas)

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      window.removeEventListener('resize', resizeCanvas)
      map.remove()
      mapRef.current = null
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
    }
  }, [])

  // ============================================
  // ЗАГРУЗКА ДАННЫХ
  // ============================================
  
  const fetchData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [driversRes, routesRes] = await Promise.all([
        fetch("/api/drivers/locations"),
        fetch("/api/dashboard/routes"),
      ])
      
      const driversData = await driversRes.json()
      const routesData = await routesRes.json()
      
      if (driversData.success) {
        setDrivers(driversData.drivers || [])
        setStats(driversData.stats || {
          online: 0,
          inRoute: 0,
          total: 0,
          orders: { total: 0, active: 0, completedToday: 0, newToday: 0 },
          revenue: 0,
          alerts: 0,
        })
      }
      
      if (routesData.success) {
        const routesList = routesData.routes || []
        setRoutes(routesList)
        routesDataRef.current = routesList
        setBase(routesData.base || null)
        setBaseWarning(routesData.warning || null)
        
        const totalKm = routesList.reduce(
          (sum: number, r: RouteData) => sum + (r.totalDistance || 0),
          0
        )
        setTotalActiveKm(totalKm)
      }
      
      setLastUpdate(new Date())
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        console.warn("Failed to fetch data:", e?.message || e)
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 15000)
    return () => clearInterval(interval)
  }, [fetchData])

  // ============================================
  // CANVAS АНИМАЦИЯ С ПУЛЬСАЦИЕЙ
  // ============================================
  
  useEffect(() => {
    const canvas = canvasRef.current
    const map = mapRef.current
    if (!canvas || !map) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let time = 0
    let heartbeatPhase = 0

    const getPointAtLength = (
      points: { x: number; y: number }[],
      segments: number[],
      targetLength: number
    ): { x: number; y: number } | null => {
      if (points.length < 2) return null

      for (let i = 1; i < points.length; i++) {
        if (segments[i] >= targetLength) {
          const segmentStart = segments[i - 1]
          const segmentEnd = segments[i]
          const segmentLength = segmentEnd - segmentStart
          if (segmentLength === 0) return points[i - 1]
          const t = (targetLength - segmentStart) / segmentLength
          return {
            x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
            y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
          }
        }
      }
      return points[points.length - 1]
    }

    const drawRoutes = () => {
      if (!showRoutes) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        animationRef.current = requestAnimationFrame(drawRoutes)
        return
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height)
      time += 0.015
      heartbeatPhase += 0.08

      // Эффект сердцебиения
      const heartbeat =
        Math.sin(heartbeatPhase) > 0.7 ? 1 : Math.sin(heartbeatPhase + 0.3) > 0.8 ? 0.7 : 0

      routesDataRef.current.forEach((route: any) => {
        if (!route.coordinates || route.coordinates.length < 2) return

        // Конвертируем координаты
        const points = route.coordinates.map((coord: any) => {
          const point = map.latLngToContainerPoint([coord[0], coord[1]])
          return { x: point.x, y: point.y }
        })

        // Вычисляем длину пути
        let totalLength = 0
        const segments: number[] = [0]
        for (let i = 1; i < points.length; i++) {
          const dx = points[i].x - points[i - 1].x
          const dy = points[i].y - points[i - 1].y
          totalLength += Math.sqrt(dx * dx + dy * dy)
          segments.push(totalLength)
        }

        if (totalLength < 10) return

        // СЛОЙ 1: Внешнее свечение
        const glowIntensity = 0.12 + heartbeat * 0.08
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y)
        }
        ctx.strokeStyle = `rgba(255, 107, 53, ${glowIntensity})`
        ctx.lineWidth = 22 + heartbeat * 6
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.stroke()

        // СЛОЙ 2: Среднее свечение
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y)
        }
        ctx.strokeStyle = `rgba(255, 107, 53, ${0.2 + heartbeat * 0.1})`
        ctx.lineWidth = 14 + heartbeat * 4
        ctx.stroke()

        // СЛОЙ 3: Стенка вены
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y)
        }
        ctx.strokeStyle = '#1a0500'
        ctx.lineWidth = 8
        ctx.stroke()

        // СЛОЙ 4: Внутренность вены
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y)
        }
        ctx.strokeStyle = `rgba(255, 107, 53, ${0.35 + heartbeat * 0.15})`
        ctx.lineWidth = 5
        ctx.stroke()

        // СЛОЙ 5: Потоки крови
        const numBlobs = 4
        for (let b = 0; b < numBlobs; b++) {
          const blobOffset = b / numBlobs
          const speed = 0.4 + heartbeat * 0.3
          const blobPos = ((time * speed + blobOffset) % 1) * totalLength
          const blobLength = totalLength * (0.12 + heartbeat * 0.05)

          const gradientStart = Math.max(0, blobPos - blobLength)
          const gradientEnd = Math.min(totalLength, blobPos + blobLength)

          const startPoint = getPointAtLength(points, segments, gradientStart)
          const endPoint = getPointAtLength(points, segments, gradientEnd)

          if (!startPoint || !endPoint) continue

          const gradient = ctx.createLinearGradient(
            startPoint.x,
            startPoint.y,
            endPoint.x,
            endPoint.y
          )

          const blobOpacity = 0.7 + heartbeat * 0.3

          gradient.addColorStop(0, 'rgba(255, 107, 53, 0)')
          gradient.addColorStop(0.2, `rgba(255, 107, 53, ${blobOpacity * 0.5})`)
          gradient.addColorStop(0.4, `rgba(255, 140, 90, ${blobOpacity})`)
          gradient.addColorStop(0.5, `rgba(255, 180, 140, ${blobOpacity})`)
          gradient.addColorStop(0.6, `rgba(255, 140, 90, ${blobOpacity})`)
          gradient.addColorStop(0.8, `rgba(255, 107, 53, ${blobOpacity * 0.5})`)
          gradient.addColorStop(1, 'rgba(255, 107, 53, 0)')

          ctx.beginPath()
          let drawing = false
          for (let i = 0; i < points.length; i++) {
            const segmentDist = segments[i]
            if (segmentDist >= gradientStart && segmentDist <= gradientEnd) {
              if (!drawing) {
                const startP = getPointAtLength(points, segments, gradientStart)
                if (startP) ctx.moveTo(startP.x, startP.y)
                drawing = true
              }
              ctx.lineTo(points[i].x, points[i].y)
            }
          }
          if (drawing) {
            const endP = getPointAtLength(points, segments, gradientEnd)
            if (endP) ctx.lineTo(endP.x, endP.y)
          }

          ctx.strokeStyle = gradient
          ctx.lineWidth = 4 + heartbeat * 2
          ctx.stroke()
        }

        // СЛОЙ 6: Яркий центр
        const centerPulse = 0.4 + Math.sin(time * 4) * 0.2 + heartbeat * 0.3
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y)
        }
        ctx.strokeStyle = `rgba(255, 200, 170, ${centerPulse})`
        ctx.lineWidth = 2
        ctx.stroke()
      })

      animationRef.current = requestAnimationFrame(drawRoutes)
    }

    drawRoutes()

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [showRoutes, routes])

  // ============================================
  // МАРКЕРЫ ТОЧЕК МАРШРУТА (A, B, C, D...)
  // ============================================

  useEffect(() => {
    if (!mapRef.current) return
    const map = mapRef.current

    // Удаляем старые маркеры
    waypointMarkersRef.current.forEach((m: any) => m.remove())
    waypointMarkersRef.current = []

    if (!showRoutes) return

    routes.forEach((route: any) => {
      // Проверяем что waypoints существует
      if (!route.waypoints || !Array.isArray(route.waypoints)) return

      route.waypoints.forEach((wp: any) => {
        // Пропускаем водителя и невалидные позиции
        if (!wp.position || wp.type === 'driver') return

        const color = WAYPOINT_COLORS[wp.type] || '#888'
        const size = wp.type === 'base' ? 36 : 28
        const icon = wp.type === 'base' ? '🏠' : wp.type === 'loading' ? '📦' : '📤'

        const markerIcon = L.divIcon({
          className: 'waypoint-marker',
          html: `
            <div class="waypoint-container" style="--wp-color: ${color}">
              <div class="waypoint-pulse"></div>
              <div class="waypoint-core" style="width: ${size}px; height: ${size}px;">
                <span class="waypoint-icon">${icon}</span>
                <span class="waypoint-label">${wp.label}</span>
              </div>
            </div>
          `,
          iconSize: [size + 20, size + 20],
          iconAnchor: [(size + 20) / 2, (size + 20) / 2],
        })

        const marker = L.marker(wp.position, { icon: markerIcon })
          .addTo(map)
          .bindPopup(
            `
            <div style="padding: 10px; font-family: system-ui; min-width: 150px;">
              <div style="font-weight: 600; color: white; margin-bottom: 4px;">
                ${wp.type === 'loading' ? '📦 Погрузка' : wp.type === 'unloading' ? '📤 Выгрузка' : '🏠 База'}
              </div>
              <div style="color: #888; font-size: 12px;">${wp.address}</div>
            </div>
          `,
            { className: 'custom-popup' }
          )

        waypointMarkersRef.current.push(marker)
      })
    })
  }, [routes, showRoutes])

  // ============================================
  // РЕНДЕР БАЗЫ
  // ============================================

  useEffect(() => {
    if (!mapRef.current) return
    const map = mapRef.current

    if (baseMarkerRef.current) baseMarkerRef.current.remove()

    if (!base) return

    const baseIcon = L.divIcon({
      className: 'base-marker',
      html: `
        <div class="base-container">
          <div class="base-pulse-1"></div>
          <div class="base-pulse-2"></div>
          <div class="base-core">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
          <div class="base-label">${base.name}</div>
        </div>
      `,
      iconSize: [80, 80],
      iconAnchor: [40, 40],
    })

    baseMarkerRef.current = L.marker(base.coordinates, {
      icon: baseIcon,
      zIndexOffset: 1000,
    }).addTo(map)
  }, [base])

  // ============================================
  // РЕНДЕР МАРКЕРОВ ВОДИТЕЛЕЙ
  // ============================================

  useEffect(() => {
    if (!mapRef.current) return

    const map = mapRef.current
    const currentMarkers = markersRef.current

    // Удаляем маркеры водителей, которых больше нет
    currentMarkers.forEach((marker, id) => {
      if (!drivers.find((d: any) => d.id === id)) {
        marker.remove()
        currentMarkers.delete(id)
      }
    })

    drivers.forEach((driver: any) => {
      if (!driver.latitude || !driver.longitude) return

      const pos: L.LatLngExpression = [driver.latitude, driver.longitude]
      const statusInfo = STATUS_CONFIG[driver.status] || STATUS_CONFIG.offline
      const isActive = ['driving', 'loading', 'in_transit', 'unloading'].includes(driver.status)

      const truckIcon = L.divIcon({
        className: 'driver-marker',
        html: `
          <div class="driver-container ${isActive ? 'active' : ''}">
            ${isActive ? `<div class="driver-pulse" style="background: ${statusInfo.color}"></div>` : ''}
            <div class="driver-core" style="border-color: ${statusInfo.color}">
              <svg viewBox="0 0 24 24" fill="none" stroke="${statusInfo.color}" stroke-width="2">
                <rect x="1" y="3" width="15" height="13"/>
                <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/>
                <circle cx="5.5" cy="18.5" r="2.5"/>
                <circle cx="18.5" cy="18.5" r="2.5"/>
              </svg>
            </div>
            <div class="driver-pointer" style="border-top-color: ${statusInfo.color}"></div>
          </div>
        `,
        iconSize: [52, 62],
        iconAnchor: [26, 62],
        popupAnchor: [0, -62],
      })

      const popupContent = `
        <div class="popup-content">
          <div class="popup-header">
            <div class="popup-avatar" style="background: linear-gradient(135deg, ${statusInfo.color}, ${statusInfo.color}88)">
              ${driver.name
                .split(' ')
                .map((n: any) => n[0])
                .join('')
                .slice(0, 2)}
            </div>
            <div>
              <div class="popup-name">${driver.name}</div>
              <div class="popup-vehicle">${driver.vehiclePlate || '—'} • ${driver.vehicleType || ''}</div>
            </div>
          </div>
          <div class="popup-status" style="background: ${statusInfo.bg}; border-color: ${statusInfo.color}40">
            <span class="popup-status-dot" style="background: ${statusInfo.color}"></span>
            <span style="color: ${statusInfo.color}">${statusInfo.label}</span>
          </div>
          ${
            driver.routeFrom
              ? `
            <div class="popup-route">
              <div class="popup-route-from">${driver.routeFrom}</div>
              <div class="popup-route-arrow">↓</div>
              <div class="popup-route-to">${driver.routeTo}</div>
            </div>
          `
              : ''
          }
        </div>
      `

      if (currentMarkers.has(driver.id)) {
        const marker = currentMarkers.get(driver.id)!
        marker.setLatLng(pos)
        marker.setIcon(truckIcon)
        marker.setPopupContent(popupContent)
      } else {
        const marker = L.marker(pos, { icon: truckIcon })
          .addTo(map)
          .bindPopup(popupContent, { className: 'custom-popup' })
        marker.on('click', () => setSelectedDriver(driver.id))
        currentMarkers.set(driver.id, marker)
      }
    })

    // Центрирование при первой загрузке
    const allPoints: L.LatLngExpression[] = []
    if (base) allPoints.push(base.coordinates)
    drivers.forEach((d: any) => {
      if (d.latitude && d.longitude) allPoints.push([d.latitude, d.longitude])
    })

    if (allPoints.length > 0 && !lastUpdate) {
      const bounds = L.latLngBounds(allPoints)
      map.fitBounds(bounds, { padding: [80, 80], maxZoom: 10 })
    }
  }, [drivers, base, lastUpdate, selectedDriver])

  // ============================================
  // RENDER
  // ============================================

  return (
    <div className="relative h-full w-full bg-[#0a0a0a] overflow-hidden">
      <style jsx global>{`
        /* BASE */
        .base-container {
          position: relative;
          width: 80px;
          height: 80px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .base-pulse-1,
        .base-pulse-2 {
          position: absolute;
          width: 50px;
          height: 50px;
          border: 2px solid #ff6b35;
          border-radius: 50%;
          animation: basePulse 2.5s ease-out infinite;
        }
        .base-pulse-2 {
          animation-delay: 1.25s;
        }
        @keyframes basePulse {
          0% {
            transform: scale(0.8);
            opacity: 1;
          }
          100% {
            transform: scale(2.5);
            opacity: 0;
          }
        }
        .base-core {
          position: relative;
          z-index: 10;
          width: 46px;
          height: 46px;
          background: linear-gradient(135deg, #ff6b35, #ff8555);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 20px rgba(255, 107, 53, 0.6), 0 0 40px rgba(255, 107, 53, 0.3);
        }
        .base-core svg {
          width: 22px;
          height: 22px;
        }
        .base-label {
          position: absolute;
          bottom: -6px;
          left: 50%;
          transform: translateX(-50%);
          background: #1a1a1f;
          border: 1px solid #ff6b3560;
          padding: 3px 10px;
          border-radius: 12px;
          font-size: 10px;
          font-weight: 600;
          color: #ff6b35;
          white-space: nowrap;
        }

        /* WAYPOINTS */
        .waypoint-container {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .waypoint-pulse {
          position: absolute;
          width: 100%;
          height: 100%;
          background: var(--wp-color);
          border-radius: 50%;
          opacity: 0.3;
          animation: wpPulse 2s ease-out infinite;
        }
        @keyframes wpPulse {
          0% {
            transform: scale(0.8);
            opacity: 0.4;
          }
          100% {
            transform: scale(2);
            opacity: 0;
          }
        }
        .waypoint-core {
          position: relative;
          z-index: 10;
          background: #1a1a1f;
          border: 2px solid var(--wp-color);
          border-radius: 50%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
        }
        .waypoint-icon {
          font-size: 12px;
        }
        .waypoint-label {
          font-size: 9px;
          font-weight: 700;
          color: var(--wp-color);
          margin-top: -2px;
        }

        /* DRIVER */
        .driver-container {
          position: relative;
          width: 52px;
          height: 62px;
          display: flex;
          flex-direction: column;
          align-items: center;
          transition: transform 0.2s ease;
        }
        .driver-container:hover {
          transform: scale(1.2);
        }
        .driver-pulse {
          position: absolute;
          top: 6px;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          opacity: 0.5;
          animation: driverPulse 1.5s ease-out infinite;
        }
        @keyframes driverPulse {
          0% {
            transform: scale(1);
            opacity: 0.5;
          }
          100% {
            transform: scale(2);
            opacity: 0;
          }
        }
        .driver-core {
          position: relative;
          z-index: 10;
          width: 40px;
          height: 40px;
          background: #121217;
          border: 2.5px solid;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
        }
        .driver-core svg {
          width: 20px;
          height: 20px;
        }
        .driver-pointer {
          width: 0;
          height: 0;
          border-left: 7px solid transparent;
          border-right: 7px solid transparent;
          border-top: 9px solid;
          margin-top: -1px;
        }

        /* POPUP */
        .custom-popup .leaflet-popup-content-wrapper {
          background: #1a1a1f;
          border: 1px solid #2a2a35;
          border-radius: 14px;
          box-shadow: 0 15px 50px rgba(0, 0, 0, 0.5);
          padding: 0;
        }
        .custom-popup .leaflet-popup-content {
          margin: 0;
        }
        .custom-popup .leaflet-popup-tip-container {
          display: none;
        }
        .popup-content {
          padding: 14px;
          min-width: 200px;
          font-family: system-ui;
        }
        .popup-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 12px;
        }
        .popup-avatar {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          font-weight: 700;
          color: white;
        }
        .popup-name {
          font-size: 14px;
          font-weight: 600;
          color: white;
        }
        .popup-vehicle {
          font-size: 11px;
          color: #666;
          margin-top: 2px;
        }
        .popup-status {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border: 1px solid;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          margin-bottom: 10px;
        }
        .popup-status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }
        .popup-route {
          background: #0f0f12;
          border-radius: 10px;
          padding: 10px;
        }
        .popup-route-from,
        .popup-route-to {
          font-size: 12px;
          color: #bbb;
        }
        .popup-route-arrow {
          color: #444;
          font-size: 10px;
          padding: 2px 0;
        }

        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #333;
          border-radius: 2px;
        }
      `}</style>

      <div ref={mapContainerRef} className="h-full w-full z-0" />

      {/* WARNING */}
      {baseWarning && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1001] bg-amber-500/90 text-black px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium shadow-lg">
          <AlertTriangle className="h-4 w-4" />
          {baseWarning}
          <Link href="/fleet" className="underline ml-2">
            Настроить
          </Link>
        </div>
      )}

      {/* TOP LEFT */}
      <div className="absolute top-4 left-4 z-[1000] flex flex-col gap-3">
        {base && (
          <div
            className="group bg-[#121217]/95 backdrop-blur-xl border border-[#2a2a35] rounded-2xl p-4 shadow-xl cursor-pointer hover:border-orange-500/40 transition-all"
            onClick={() => mapRef.current?.flyTo(base.coordinates, 14, { duration: 1.5 })}
          >
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 shadow-lg shadow-orange-500/30">
                <Building2 className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="text-sm font-bold text-white">{base.name}</div>
                <div className="text-xs text-gray-500 max-w-[140px] truncate">{base.address}</div>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-600 group-hover:text-orange-500 transition-colors" />
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Link href="/orders?status=active">
            <div className="bg-[#121217]/95 backdrop-blur-xl border border-[#2a2a35] rounded-xl px-4 py-3 hover:border-orange-500/40 transition-all cursor-pointer">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-500/15">
                  <Package className="h-4 w-4 text-orange-500" />
                </div>
                <div>
                  <div className="text-xl font-bold text-white">{stats.orders.active}</div>
                  <div className="text-[9px] text-gray-500 uppercase tracking-wider font-semibold">
                    В работе
                  </div>
                </div>
              </div>
            </div>
          </Link>

          <div className="bg-[#121217]/95 backdrop-blur-xl border border-[#2a2a35] rounded-xl px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/15">
                <Route className="h-4 w-4 text-green-500" />
              </div>
              <div>
                <div className="text-xl font-bold text-white">{routes.length}</div>
                <div className="text-[9px] text-gray-500 uppercase tracking-wider font-semibold">
                  Маршрутов
                </div>
              </div>
            </div>
          </div>

          <div className="bg-[#121217]/95 backdrop-blur-xl border border-[#2a2a35] rounded-xl px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/15">
                <TrendingUp className="h-4 w-4 text-blue-500" />
              </div>
              <div>
                <div className="text-xl font-bold text-white">
                  {formatDistance(totalActiveKm)}{' '}
                  <span className="text-sm font-normal text-gray-500">км</span>
                </div>
                <div className="text-[9px] text-gray-500 uppercase tracking-wider font-semibold">
                  Активно
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* TOP RIGHT */}
      <div className="absolute top-4 right-4 z-[1000] flex gap-2">
        <button
          onClick={() => setShowRoutes(!showRoutes)}
          className={`bg-[#121217]/95 backdrop-blur-xl border rounded-xl p-3 transition-all ${
            showRoutes
              ? 'border-orange-500/50 text-orange-500'
              : 'border-[#2a2a35] text-gray-500 hover:text-white'
          }`}
        >
          <Zap className="h-5 w-5" />
        </button>
        <button
          onClick={fetchData}
          disabled={isLoading}
          className="bg-[#121217]/95 backdrop-blur-xl border border-[#2a2a35] rounded-xl p-3 text-gray-500 hover:text-white transition-all"
        >
          <RefreshCw className={`h-5 w-5 ${isLoading ? 'animate-spin text-orange-500' : ''}`} />
        </button>
        <button
          onClick={() => setShowDriversList(!showDriversList)}
          className={`relative bg-[#121217]/95 backdrop-blur-xl border rounded-xl p-3 transition-all ${
            showDriversList
              ? 'border-orange-500/50 text-orange-500'
              : 'border-[#2a2a35] text-gray-500 hover:text-white'
          }`}
        >
          <Users className="h-5 w-5" />
          {stats.online > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center">
              {stats.online}
            </span>
          )}
        </button>
      </div>

      {/* SIDE PANEL */}
      <div
        className={`absolute top-0 right-0 bottom-0 w-80 bg-[#121217]/98 backdrop-blur-2xl border-l border-[#2a2a35] z-[999] flex flex-col shadow-2xl transition-transform duration-300 ${
          showDriversList ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="px-5 py-4 border-b border-[#2a2a35] flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-orange-500/15">
              <Users className="h-5 w-5 text-orange-500" />
            </div>
            <div>
              <h3 className="font-bold text-white">Водители</h3>
              <p className="text-xs text-gray-500">{stats.online} онлайн</p>
            </div>
          </div>
          <button
            onClick={() => setShowDriversList(false)}
            className="p-2 hover:bg-[#2a2a35] rounded-lg"
          >
            <X className="h-5 w-5 text-gray-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
          {drivers.length === 0 ? (
            <div className="text-center py-16 text-gray-500">Нет водителей</div>
          ) : (
            drivers.map((driver: any) => {
              const status = STATUS_CONFIG[driver.status] || STATUS_CONFIG.offline
              const isActive = ['driving', 'loading', 'in_transit', 'unloading'].includes(
                driver.status
              )

              return (
                <div
                  key={driver.id}
                  onClick={() => {
                    setSelectedDriver(driver.id)
                    if (driver.latitude && driver.longitude)
                      mapRef.current?.flyTo([driver.latitude, driver.longitude], 14, {
                        duration: 1,
                      })
                  }}
                  className={`relative bg-[#1a1a1f] border rounded-xl p-4 cursor-pointer transition-all ${
                    selectedDriver === driver.id
                      ? 'border-orange-500/50'
                      : 'border-[#2a2a35] hover:border-[#3a3a45]'
                  }`}
                >
                  {isActive && (
                    <div
                      className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
                      style={{ background: status.color }}
                    />
                  )}

                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold text-white"
                        style={{
                          background: `linear-gradient(135deg, ${status.color}, ${status.color}88)`,
                        }}
                      >
                        {driver.name
                          .split(' ')
                          .map((n: any) => n[0])
                          .join('')
                          .slice(0, 2)}
                      </div>
                      <div>
                        <div className="font-semibold text-sm text-white">{driver.name}</div>
                        <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                          <Truck className="h-3 w-3" />
                          {driver.vehiclePlate || 'Нет ТС'}
                        </div>
                      </div>
                    </div>
                    {driver.statusDuration && driver.statusDuration > 0 && (
                      <div className="text-xs text-gray-500 bg-[#0f0f12] px-2 py-1 rounded flex items-center gap-1">
                        <Timer className="h-3 w-3" />
                        {formatDuration(driver.statusDuration)}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <div
                      className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase flex items-center gap-1.5"
                      style={{ background: status.bg, color: status.color }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      {status.label}
                    </div>
                    {driver.routeTo && (
                      <div className="text-[10px] text-gray-600 flex items-center gap-1 truncate max-w-[90px]">
                        <MapPin className="h-3 w-3 flex-shrink-0" />
                        {driver.routeTo.split(',')[0]}
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="px-4 py-3 border-t border-[#2a2a35]">
          <Link
            href="/fleet"
            className="flex items-center justify-center gap-2 py-2.5 bg-orange-500/10 border border-orange-500/20 rounded-xl text-orange-500 text-sm font-medium hover:bg-orange-500/20 transition-all"
          >
            Управление парком
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* BOTTOM LEFT */}
      <div className="absolute bottom-6 left-4 z-[1000]">
        <Link href="/fleet">
          <div className="bg-[#121217]/95 backdrop-blur-xl border border-[#2a2a35] rounded-2xl px-6 py-4 shadow-xl hover:border-orange-500/30 transition-all">
            <div className="flex items-center gap-1.5 mb-3">
              <Activity className="h-4 w-4 text-orange-500" />
              <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                Live
              </span>
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            </div>
            <div className="flex gap-8">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-500">{stats.online}</div>
                <div className="text-[9px] uppercase text-gray-500 tracking-wider font-semibold">
                  На связи
                </div>
              </div>
              <div className="w-px bg-[#2a2a35]" />
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-500">{stats.inRoute}</div>
                <div className="text-[9px] uppercase text-gray-500 tracking-wider font-semibold">
                  В рейсе
                </div>
              </div>
              <div className="w-px bg-[#2a2a35]" />
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-500">{stats.orders.completedToday}</div>
                <div className="text-[9px] uppercase text-gray-500 tracking-wider font-semibold">
                  Сегодня
                </div>
              </div>
            </div>
          </div>
        </Link>
      </div>

      {/* BOTTOM RIGHT */}
      <div className="absolute bottom-6 right-4 z-[1000]">
        <div className="flex items-center gap-2 bg-[#121217]/80 backdrop-blur border border-[#2a2a35] rounded-xl px-3 py-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isLoading ? 'bg-orange-500 animate-pulse' : 'bg-green-500'
            }`}
          />
          <span className="text-xs text-gray-500">
            {lastUpdate
              ? lastUpdate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
              : '...'}
          </span>
        </div>
      </div>
    </div>
  )
}
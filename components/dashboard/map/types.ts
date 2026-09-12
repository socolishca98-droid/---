// components/dashboard/map/types.ts

export interface Waypoint {
  type: "driver" | "loading" | "unloading" | "base"
  label: string
  address: string
  position: [number, number] | null
}

export interface OrderInfo {
  id: string
  from: string
  to: string
  cargo: string
  price: number
  status: string
}

export interface RouteData {
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
  color?: string // ✅ Добавлено для премиальных цветов маршрутов
}

export interface BaseData {
  name: string
  address: string
  coordinates: [number, number]
}

export interface DriverLocation {
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

export interface DashboardStats {
  online: number
  inRoute: number
  total: number
  orders: {
    total: number
    active: number
    completedToday: number
    newToday: number
  }
  revenue: number
  alerts: number
}

export interface StatusConfig {
  label: string
  color: string
  bg: string
}
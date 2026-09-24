// lib/types.ts

// ============================================
// ЧАТ
// ============================================
import type { OrderStatus } from "@/lib/orders/stages"

export interface ChatMessage {
  id: string
  senderId: string
  senderRole: "driver" | "logist"
  senderName: string
  recipientId?: string
  routeId?: string
  content: string
  type: "text" | "photo" | "location" | "alert"
  isImportant?: boolean
  importantReason?: string | null
  attachmentUrl?: string
  isRead: boolean
  createdAt: Date
}

// ============================================
// ВОДИТЕЛИ
// ============================================
export interface Driver {
  id: string
  name: string
  phone: string
  vehicleId?: string
  vehicleType: string
  vehiclePlate: string
  currentLocation?: string
  latitude?: number
  longitude?: number
  lastGpsUpdate?: Date
  status: "available" | "busy" | "offline"
  ordersCompleted: number
  rating: number
  licenseNumber?: string
  licenseExpiry?: Date
  medicalExpiry?: Date
  hiredAt?: Date
  createdAt: Date
  updatedAt: Date
}

// ============================================
// ТРАНСПОРТ
// ============================================
export interface Vehicle {
  id: string
  plate: string
  type: string
  brand?: string
  model?: string
  year?: number
  capacity: number
  volume?: number
  length?: number
  width?: number
  height?: number
  features: string[]
  driverId?: string
  status: "available" | "in_use" | "maintenance"
  lastMaintenanceDate?: Date
  nextMaintenanceDate?: Date
  mileage?: number
  insuranceExpiry?: Date
  inspectionExpiry?: Date
  createdAt: Date
  updatedAt: Date
}

// ============================================
// ЗАКАЗЫ
// ============================================
export interface Order {
  id: string
  source: string
  sourceId?: string
  routeFrom: string
  routeTo: string
  distance: number
  weight: number
  volume?: number
  cargoType: string
  loadingType: string
  requirements?: string
  price?: number
  priceNegotiable: boolean
  paymentType?: string
  vatType?: string
  deferredDays?: number
  isPaid: boolean
  paidAt?: Date
  dueDate?: Date
  clientName?: string
  clientContact: string
  clientFirmId?: string
  deadline: Date
  /**
   * Канон жизненного цикла заказа — lib/orders/stages.ts:
   * search → negotiation → agreed → in_route → documents → assigned → control → delivered
   * (+ cancelled / rejected / expired). В базе могут встречаться прежние значения
   * («new», «confirmed», «in_transit», «loading», …) — они приводятся к канону
   * функцией normalizeOrderStatus и переносятся scripts/migrate-order-stages.ts.
   */
  status: OrderStatus | (string & {})
  priority: "profitable" | "possible" | "needs_clarification" | "reject"
  aiScore: number
  aiReason?: string
  assignedDriverId?: string
  assignedVehicleId?: string
  routeId?: string
  createdAt: Date
  updatedAt: Date
}

// ============================================
// МАРШРУТЫ
// ============================================
export interface Route {
  id: string
  name: string
  status: "pending" | "active" | "completed" | "cancelled"
  driver?: Driver
  vehicle?: Vehicle
  orders: Order[]
  totalDistance: number
  totalWeight: number
  estimatedDuration: number
  startTime?: Date
  endTime?: Date
  createdAt: Date
}

// ============================================
// ФОТО
// ============================================
export interface Photo {
  id: string
  url: string
  type: "cargo" | "document" | "damage" | "other"
  driverId: string
  orderId?: string
  routeId?: string
  description?: string
  aiClassification?: {
    cargoType?: string
    cargoFillPercent?: number
    description?: string
    issues?: string[]
  }
  createdAt: Date
}

// ============================================
// ДОГРУЗ (AI-подсказки)
// ============================================
export interface DogrizSuggestion {
  id: string
  currentFillPercent: number
  availableCapacity: number
  suggestedOrder: {
    id: string
    cargoType: string
    source: string
    routeFrom: string
    routeTo: string
    weight: number
    volume?: number
    price?: number
    clientName?: string
  }
  aiReason: string
}

// ============================================
// ПОЛЬЗОВАТЕЛИ
// ============================================
export interface User {
  id: string
  name: string
  email?: string
  phone?: string
  role: "admin" | "logist" | "driver"
  driverId?: string
  avatar?: string
  createdAt: Date
}
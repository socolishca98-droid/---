// lib/logist-mobile/types.ts
//
// Типы данных мобильного контура логиста (/lm/*).
//
// Объявлены локально, а не взяты из @prisma/client: мобильные экраны —
// клиентские компоненты, и им нужен только тот срез полей, который реально
// отображается. Так мобильная версия не зависит от генерации Prisma-клиента
// в момент сборки и не тянет серверные типы в браузерный бандл.

export interface MobileOrder {
  id: string
  status: string
  routeFrom: string
  routeTo: string
  distance: number | null
  cargoType: string | null
  weight: number | null
  volume: number | null
  price: number | null
  agreedPrice: number | null
  priceNegotiable: boolean
  paymentType: string | null
  clientName: string | null
  clientContact: string | null
  deadline: string | null
  dueDate: string | null
  createdAt: string
  priority: string | null
  isPaid: boolean
  assignedDriverId: string | null
  assignedVehicleId: string | null
  routeId: string | null
  routeSequence: number | null
  requirements: string | null
  notes?: string | null
}

export interface MobileDriver {
  id: string
  name: string
  phone: string | null
  status: string
  vehicleId: string | null
  vehiclePlate: string | null
  vehicleType: string | null
  currentLocation: string | null
  latitude: number | null
  longitude: number | null
  lastGpsUpdate: string | null
  ordersCompleted: number | null
  licenseNumber: string | null
  licenseExpiry: string | null
  medicalExpiry: string | null
}

export interface MobileVehicle {
  id: string
  plate: string
  type: string | null
  brand: string | null
  model: string | null
  capacity: number | null
  volume: number | null
  status: string
}

export interface MobileRouteOrder {
  id: string
  status: string
  routeFrom: string
  routeTo: string
  cargoType: string | null
  clientName: string | null
  weight: number | null
  price: number | null
  agreedPrice: number | null
  routeSequence: number | null
}

export interface MobileRoute {
  id: string
  name: string | null
  status: string
  statusLabel?: string
  driverId: string | null
  driver: { id: string; name: string; phone: string | null; status: string } | null
  vehicle: { id: string; plate: string; type: string | null } | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  notes: string | null
  orders: MobileRouteOrder[]
  stats: {
    totalOrders?: number
    totalDistance?: number
    cargoWeight?: number
    cargoVolume?: number
  } | null
  economics?: { revenueRub?: number; distanceKm?: number; estimatedCostRub?: number } | null
}

export interface MobileNotification {
  id: string
  type: string
  title: string
  message: string | null
  priority: string | null
  isRead: boolean
  createdAt: string
  orderId: string | null
  routeId: string | null
  driverId: string | null
}

// ---------------------------------------------------------------------------
// Подписи и цвета статусов
// ---------------------------------------------------------------------------

/** Цветной чип статуса заказа: классы Tailwind. */
export const ORDER_STATUS_STYLES: Record<string, string> = {
  search: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  negotiation: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  agreed: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  in_route: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  documents: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  assigned: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  control: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  delivered: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  cancelled: "bg-red-500/15 text-red-300 border-red-500/30",
  rejected: "bg-red-500/15 text-red-300 border-red-500/30",
  expired: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
}

/** Группы для фильтров списка заказов. */
export const ORDER_FILTERS: { id: string; label: string; statuses: string[] }[] = [
  { id: "active", label: "В работе", statuses: ["search", "negotiation", "agreed", "in_route", "documents", "assigned", "control"] },
  { id: "negotiation", label: "Согласование", statuses: ["search", "negotiation", "agreed"] },
  { id: "route", label: "Маршрут", statuses: ["in_route"] },
  { id: "documents", label: "Документы", statuses: ["documents"] },
  { id: "assignment", label: "Назначение", statuses: ["assigned"] },
  { id: "control", label: "Контроль", statuses: ["control"] },
  { id: "closed", label: "Закрытые", statuses: ["delivered", "cancelled", "rejected", "expired"] },
]

/** Статусы, которые логист видит в блоке «требуют внимания» на дашборде. */
export const ATTENTION_STATUSES = ["negotiation", "agreed", "documents", "assigned"]

export const DRIVER_STATUS_META: Record<string, { label: string; dot: string; text: string }> = {
  available: { label: "Свободен", dot: "bg-emerald-400", text: "text-emerald-300" },
  busy: { label: "В рейсе", dot: "bg-amber-400", text: "text-amber-300" },
  offline: { label: "Не на связи", dot: "bg-zinc-500", text: "text-zinc-400" },
  maintenance: { label: "На ТО", dot: "bg-sky-400", text: "text-sky-300" },
}

export const ROUTE_STATUS_META: Record<string, { label: string; style: string }> = {
  planned: { label: "Запланирован", style: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  draft: { label: "Черновик", style: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30" },
  in_progress: { label: "В пути", style: "bg-orange-500/15 text-orange-300 border-orange-500/30" },
  active: { label: "В пути", style: "bg-orange-500/15 text-orange-300 border-orange-500/30" },
  completed: { label: "Завершён", style: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  cancelled: { label: "Отменён", style: "bg-red-500/15 text-red-300 border-red-500/30" },
}

export const PAYMENT_TYPE_LABELS: Record<string, string> = {
  cash: "Наличные",
  bank: "На счёт",
  card: "Карта",
  cashless: "Безнал",
}

export const LOADING_TYPE_LABELS: Record<string, string> = {
  pallets: "Паллеты",
  boxes: "Коробки",
  bulk: "Навалом",
  bags: "Мешки",
  barrels: "Бочки",
  containers: "Контейнеры",
}

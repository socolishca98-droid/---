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

/**
 * Цветной чип статуса заказа.
 *
 * Цвета берём из токенов темы (те же, что в компьютерной версии), а не из
 * произвольных оттенков Tailwind: тогда чипы выглядят частью продукта, а смена
 * палитры в globals.css меняет оба контура сразу.
 */
export const ORDER_STATUS_STYLES: Record<string, string> = {
  search: "bg-secondary text-muted-foreground border-border",
  negotiation: "bg-warning/15 text-warning border-warning/30",
  agreed: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  in_route: "bg-primary/15 text-primary border-primary/30",
  documents: "bg-chart-5/15 text-chart-5 border-chart-5/30",
  assigned: "bg-chart-3/15 text-chart-3 border-chart-3/30",
  control: "bg-primary/15 text-primary border-primary/30",
  delivered: "bg-success/15 text-success border-success/30",
  cancelled: "bg-destructive/15 text-destructive border-destructive/30",
  rejected: "bg-destructive/15 text-destructive border-destructive/30",
  expired: "bg-secondary text-muted-foreground border-border",
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
  available: { label: "Свободен", dot: "bg-success", text: "text-success" },
  busy: { label: "В рейсе", dot: "bg-warning", text: "text-warning" },
  offline: { label: "Не на связи", dot: "bg-muted-foreground", text: "text-muted-foreground" },
  maintenance: { label: "На ТО", dot: "bg-chart-2", text: "text-chart-2" },
}

export const ROUTE_STATUS_META: Record<string, { label: string; style: string }> = {
  planned: { label: "Запланирован", style: "bg-chart-2/15 text-chart-2 border-chart-2/30" },
  draft: { label: "Черновик", style: "bg-secondary text-muted-foreground border-border" },
  in_progress: { label: "В пути", style: "bg-primary/15 text-primary border-primary/30" },
  active: { label: "В пути", style: "bg-primary/15 text-primary border-primary/30" },
  completed: { label: "Завершён", style: "bg-success/15 text-success border-success/30" },
  cancelled: { label: "Отменён", style: "bg-destructive/15 text-destructive border-destructive/30" },
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

// --- Разделы, которых раньше не было в мобильной панели ---------------------

export interface MobileClient {
  id: string
  name: string
  inn: string | null
  address: string | null
  contactName: string | null
  phone: string | null
  email: string | null
  paymentType: string | null
  vatType: string | null
  deferredDays: number | null
  notes: string | null
  stats?: MobileClientStats | null
}

export interface MobileClientStats {
  total: number
  delivered: number
  active: number
  revenueRub: number
  paidRub: number
  unpaidRub: number
  overdueRub: number
  overdueCount: number
  avgPaymentDays: number | null
  reliabilityPercent: number | null
  lastOrderAt: string | null
}

export interface MobilePaymentOrder {
  id: string
  clientId: string | null
  clientName: string | null
  clientContact: string | null
  routeFrom: string
  routeTo: string
  distance: number | null
  status: string
  createdAt: string
  amount: number | null
  paymentType: string | null
  deferredDays: number | null
  dueDate: string | null
  isPaid: boolean
  paidAt: string | null
  isOverdue: boolean
  overdueDays: number | null
}

export interface MobilePaymentsStats {
  totalPending: number
  totalDeferred: number
  totalOverdue: number
  totalPaid: number
  totalRevenue: number
  pendingCount: number
  deferredCount: number
  overdueCount: number
  paidCount: number
  avgPaymentDays: number | null
}

export interface MobileDebtor {
  clientId: string | null
  clientName: string | null
  debt: number
  overdue: number
  ordersCount: number
  oldestDueDate: string | null
}

export interface MobileFleetVehicle {
  id: string
  plate: string
  type: string | null
  brand: string | null
  model: string | null
  year: number | null
  capacity: number | null
  volume: number | null
  mileage: number | null
  status: string
  lastMaintenanceDate: string | null
  nextMaintenanceDate: string | null
  driverName?: string | null
  deadlines?: {
    maintenance?: { status: string; daysLeft: number; date: string } | null
    insurance?: { status: string; daysLeft: number; date: string } | null
  } | null
}

export interface MobileInsight {
  id: string
  level: string
  title: string
  detail: string | null
  source: string | null
}

/** Переписка с водителем для списка чата (GET /api/lm/chat-threads) */
export interface MobileChatThread {
  driverId: string
  lastMessage: {
    id: string
    content: string
    createdAt: string
    /** Последнее сообщение написал водитель (а не штаб) */
    fromDriver: boolean
    isImportant: boolean
  }
  /** Сколько сообщений водителя ещё не прочитано */
  unreadCount: number
}

export interface MobileChatMessage {
  id: string
  senderId: string | null
  recipientId: string | null
  /** Текст сообщения приходит как content (поля message/text — старые имена) */
  content?: string | null
  message?: string | null
  text?: string | null
  createdAt: string
  isRead?: boolean | null
  senderName?: string | null
}

export const VEHICLE_STATUS_META: Record<string, { label: string; style: string }> = {
  available: { label: "Свободна", style: "bg-success/15 text-success border-success/30" },
  in_use: { label: "В рейсе", style: "bg-chart-2/15 text-chart-2 border-chart-2/30" },
  maintenance: { label: "На ТО", style: "bg-warning/15 text-warning border-warning/30" },
  offline: { label: "Не в работе", style: "bg-secondary text-foreground/90 border-border" },
}

/** Состояние срока (ТО, страховка): сколько дней осталось до даты. */
export const DEADLINE_STATUS_META: Record<string, { label: string; style: string }> = {
  ok: { label: "в порядке", style: "text-muted-foreground" },
  soon: { label: "скоро", style: "text-warning" },
  overdue: { label: "просрочено", style: "text-destructive" },
}

/**
 * Вид подсказки отчёта: тон задаёт цвет, иконку рисует экран (lucide).
 * Эмодзи не используем: на части телефонов и шрифтов они превращаются
 * в пустые квадраты.
 */
export const INSIGHT_LEVEL_META: Record<string, { tone: "ok" | "warn" | "critical" | "info"; style: string }> = {
  ok: { tone: "ok", style: "border-success/25 bg-success/10" },
  warn: { tone: "warn", style: "border-warning/25 bg-warning/10" },
  warning: { tone: "warn", style: "border-warning/25 bg-warning/10" },
  critical: { tone: "critical", style: "border-destructive/25 bg-destructive/10" },
  info: { tone: "info", style: "border-border bg-white/[0.03]" },
}

// --- Поиск грузов (ATI), топливо, фото -------------------------------------

export interface MobileAtiLoad {
  id: string
  atiLoadId?: string | null
  routeFrom: string
  routeTo: string
  distance: number | null
  weight: number | null
  volume: number | null
  cargoType: string | null
  truckType: string | null
  price: number | null
  firmId: string | null
  firmName: string | null
  contactPhone: string | null
  contactName: string | null
  loadingDate: string | null
  status: string
  note: string | null
}

export interface MobileAtiStats {
  total: number
  new: number
  imported: number
  expired?: number
  expiringSoon?: number
}

export interface MobileFuelEntry {
  id: string
  spentAt: string
  liters: number | null
  amountRub: number | null
  pricePerL: number | null
  vendor: string | null
  odometer: number | null
  routeId: string | null
  routeName: string | null
  driverName: string | null
  vehiclePlate: string | null
}

export interface MobileFuelVehicle {
  vehicleId: string
  plate: string
  routes: number
  liters: number | null
  amountRub: number
  pricePerL: number | null
  estimatedL: number | null
  diffPct: number | null
  flag: boolean
}

export interface MobilePhoto {
  id: string
  url: string
  type: string
  driverId: string
  orderId: string | null
  routeId: string | null
  description: string | null
  createdAt: string
}

/** Подписи типов фото — те же, что в полной версии. */
export const PHOTO_TYPE_LABELS: Record<string, string> = {
  cargo_before: "До погрузки",
  cargo_after: "После погрузки",
  damage: "Повреждение",
  receipt: "Чек",
  waybill: "Накладная",
  other: "Другое",
}

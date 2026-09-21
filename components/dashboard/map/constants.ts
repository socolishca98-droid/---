// components/dashboard/map/constants.ts

export const DEFAULT_MAP_CENTER: [number, number] = [55.7558, 37.6173]
export const DEFAULT_MAP_ZOOM = 10

// Цвета маршрутов — в стиле программы
export const ROUTE_COLORS = [
  "#FF6B35", // Оранжевый (основной)
  "#FF8555", 
  "#E85A2A",
  "#FF7043",
  "#FF9F6B",
  "#FF6B35",
]

// Статусы водителей из мобильного приложения
export const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  driving: { label: "В пути", color: "#FF6B35", bg: "rgba(255, 107, 53, 0.15)" },
  in_transit: { label: "В пути", color: "#FF6B35", bg: "rgba(255, 107, 53, 0.15)" },
  resting: { label: "Отдых (РТО)", color: "#F59E0B", bg: "rgba(245, 158, 11, 0.15)" },
  rest: { label: "Отдых", color: "#F59E0B", bg: "rgba(245, 158, 11, 0.15)" },
  sleeping: { label: "Сон (ночной)", color: "#6366F1", bg: "rgba(99, 102, 241, 0.15)" },
  loading: { label: "Погрузка", color: "#3B82F6", bg: "rgba(59, 130, 246, 0.15)" },
  unloading: { label: "Выгрузка", color: "#10B981", bg: "rgba(16, 185, 129, 0.15)" },
  waiting: { label: "Ожидание", color: "#94A3B8", bg: "rgba(148, 163, 184, 0.15)" },
  waiting_point: { label: "Ожидание", color: "#94A3B8", bg: "rgba(148, 163, 184, 0.15)" },
  fueling: { label: "Заправка", color: "#A855F7", bg: "rgba(168, 85, 247, 0.15)" },
  maintenance: { label: "ТО / Ремонт", color: "#EAB308", bg: "rgba(234, 179, 8, 0.15)" },
  available: { label: "Свободен", color: "#22C55E", bg: "rgba(34, 197, 94, 0.15)" },
  online: { label: "На связи", color: "#22C55E", bg: "rgba(34, 197, 94, 0.15)" },
  busy: { label: "В рейсе", color: "#FF6B35", bg: "rgba(255, 107, 53, 0.15)" },
  offline: { label: "Не на смене", color: "#64748B", bg: "rgba(100, 116, 139, 0.15)" },
}

export const ACTIVE_STATUSES = [
  "driving",
  "in_transit",
  "resting",
  "sleeping",
  "loading",
  "unloading",
  "waiting",
  "waiting_point",
  "fueling",
  "available",
  "online",
  "busy",
]

export const WAYPOINT_COLORS: Record<string, string> = {
  loading: "#F59E0B",
  unloading: "#22C55E",
  base: "#FF6B35",
}

export function formatDistance(km: number): string {
  if (km >= 1000) return `${(km / 1000).toFixed(1)}k`
  return km.toFixed(0)
}

export function formatDuration(secondsOrMinutes: number): string {
  // Если переданы секунды (типично > 120 для смен) или минуты
  const totalSeconds = secondsOrMinutes > 300 ? secondsOrMinutes : secondsOrMinutes * 60
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 1) return "< 1м"
  if (minutes < 60) return `${minutes}м`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}ч ${m}м` : `${h}ч`
}
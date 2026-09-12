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

// Статусы водителей
export const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  online: { label: "На связи", color: "#22C55E", bg: "rgba(34, 197, 94, 0.15)" },
  in_transit: { label: "В пути", color: "#FF6B35", bg: "rgba(255, 107, 53, 0.15)" },
  loading: { label: "Погрузка", color: "#F59E0B", bg: "rgba(245, 158, 11, 0.15)" },
  unloading: { label: "Выгрузка", color: "#22C55E", bg: "rgba(34, 197, 94, 0.15)" },
  rest: { label: "Отдых", color: "#71717A", bg: "rgba(113, 113, 122, 0.15)" },
  offline: { label: "Оффлайн", color: "#52525B", bg: "rgba(82, 82, 91, 0.15)" },
}

export const ACTIVE_STATUSES = ["online", "in_transit", "loading", "unloading"]

export const WAYPOINT_COLORS: Record<string, string> = {
  loading: "#F59E0B",
  unloading: "#22C55E",
  base: "#FF6B35",
}

export function formatDistance(km: number): string {
  if (km >= 1000) return `${(km / 1000).toFixed(1)}k`
  return km.toFixed(0)
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}м`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}ч ${m}м` : `${h}ч`
}
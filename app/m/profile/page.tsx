// app/m/profile/page.tsx

"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { BottomNav } from "@/components/driver-mobile/bottom-nav"
import {
  Loader2,
  Phone,
  Truck,
  Star,
  Calendar,
  FileText,
  LogOut,
  MapPin,
  TrendingUp,
  AlertTriangle,
  Shield,
  Award,
  Wrench,
} from "lucide-react"

interface DriverProfile {
  id: string
  name: string
  phone: string
  vehicleType?: string
  vehiclePlate?: string
  status: string
  rating: number
  ordersCompleted: number
  licenseNumber?: string
  licenseExpiry?: string
  medicalExpiry?: string
  hiredAt?: string
}

interface DriverStats {
  totalOrders: number
  totalEarnings: number
  totalDistance: number
}

export default function MobileProfilePage() {
  const router = useRouter()
  const [driver, setDriver] = useState<DriverProfile | null>(null)
  const [stats, setStats] = useState<DriverStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Загрузка профиля
  useEffect(() => {
    const saved = localStorage.getItem("driver_session")
    if (!saved) {
      router.push("/m/login")
      return
    }

    try {
      const session = JSON.parse(saved) as { id: string }
      if (!session?.id) throw new Error("Invalid session")
      fetchProfile(session.id)
    } catch {
      localStorage.removeItem("driver_session")
      router.push("/m/login")
    }
  }, [router])

  const fetchProfile = async (driverId: string) => {
    try {
      const driverRes = await fetch(`/api/drivers/${driverId}`)
      const driverData = await driverRes.json()

      if (driverData.success && driverData.driver) {
        setDriver(driverData.driver)
        localStorage.setItem("driver_session", JSON.stringify(driverData.driver))
      }

      const ordersRes = await fetch(
        `/api/m/orders?driverId=${driverId}&status=history`
      )
      const ordersData = await ordersRes.json()

      if (ordersData.success) {
        setStats({
          totalOrders: ordersData.stats?.completedOrders || 0,
          totalEarnings: ordersData.stats?.totalEarnings || 0,
          totalDistance: ordersData.stats?.totalDistance || 0,
        })
      }
    } catch (error) {
      console.error("Failed to fetch profile:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogout = () => {
    if (confirm("Выйти из аккаунта?")) {
      localStorage.removeItem("driver_session")
      router.push("/m/login")
    }
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return "—"
    return new Date(dateString).toLocaleDateString("ru-RU")
  }

  const isExpiringSoon = (dateString?: string) => {
    if (!dateString) return false
    const date = new Date(dateString)
    const now = new Date()
    const diffDays = (date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    return diffDays < 30 && diffDays > 0
  }

  const isExpired = (dateString?: string) => {
    if (!dateString) return false
    return new Date(dateString) < new Date()
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    )
  }

  if (!driver) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center text-white">
        <p className="text-gray-400">Ошибка загрузки профиля</p>
      </div>
    )
  }

  const initials = driver.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="min-h-screen bg-[#09090b] text-white pb-24">
      {/* Header с аватаром */}
      <div className="bg-gradient-to-b from-orange-500/10 to-transparent pt-8 pb-6 px-4">
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center text-2xl font-bold shadow-lg shadow-orange-500/25">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold truncate">{driver.name}</h1>
            <a
              href={`tel:${driver.phone}`}
              className="text-gray-400 text-sm flex items-center gap-1.5 mt-1 hover:text-gray-300"
            >
              <Phone className="h-4 w-4" />
              {driver.phone}
            </a>
          </div>
        </div>

        {/* Бейджи */}
        <div className="flex flex-wrap gap-2 mt-4">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500/15 border border-yellow-500/30 rounded-full">
            <Star className="h-4 w-4 text-yellow-500" />
            <span className="text-sm font-medium text-yellow-500">
              {driver.rating?.toFixed(1) || "5.0"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/15 border border-emerald-500/30 rounded-full">
            <Award className="h-4 w-4 text-emerald-500" />
            <span className="text-sm font-medium text-emerald-500">
              {driver.ordersCompleted || 0} рейсов
            </span>
          </div>
        </div>
      </div>

      <main className="p-4 space-y-4">
        {/* Автомобиль (чтение) */}
        <div className="bg-[#151518] border border-gray-800 rounded-2xl p-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-500/15 flex items-center justify-center">
              <Truck className="h-6 w-6 text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-500">Автомобиль</p>
              <p className="font-bold text-lg">
                {driver.vehiclePlate || "Не назначен"}
              </p>
              {driver.vehicleType && (
                <p className="text-sm text-gray-400">{driver.vehicleType}</p>
              )}
            </div>
          </div>
        </div>

        {/* База */}
        <div className="bg-[#151518] border border-gray-800 rounded-2xl p-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/15 flex items-center justify-center">
              <MapPin className="h-6 w-6 text-emerald-400" />
            </div>
            <div className="flex-1">
              <p className="text-xs text-gray-500">База</p>
              <p className="font-bold text-lg">Ярославль</p>
              <p className="text-sm text-gray-500">Точка возврата</p>
            </div>
          </div>
        </div>

        {/* Статистика */}
        {stats && stats.totalOrders > 0 && (
          <div className="bg-[#151518] border border-gray-800 rounded-2xl p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-4">
              Статистика
            </p>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold">{stats.totalOrders}</p>
                <p className="text-[11px] text-gray-500 uppercase">
                  Рейсов
                </p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-orange-400">
                  {stats.totalDistance > 1000
                    ? `${(stats.totalDistance / 1000).toFixed(0)}к`
                    : stats.totalDistance}
                </p>
                <p className="text-[11px] text-gray-500 uppercase">
                  Км
                </p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-emerald-400">
                  {stats.totalEarnings > 1000
                    ? `${(stats.totalEarnings / 1000).toFixed(0)}к`
                    : stats.totalEarnings}
                </p>
                <p className="text-[11px] text-gray-500 uppercase">
                  ₽
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Документы */}
        <div className="bg-[#151518] border border-gray-800 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <p className="text-xs text-gray-500 uppercase tracking-wider flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Документы
            </p>
          </div>

          <div className="divide-y divide-gray-800">
            {/* ВУ */}
            <div className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">
                  Водительское удостоверение
                </p>
                <p className="font-medium">
                  {driver.licenseNumber || "Не указано"}
                </p>
              </div>
              {driver.licenseExpiry && (
                <div
                  className={`text-right ${
                    isExpired(driver.licenseExpiry)
                      ? "text-red-400"
                      : isExpiringSoon(driver.licenseExpiry)
                      ? "text-yellow-400"
                      : "text-gray-500"
                  }`}
                >
                  <p className="text-xs">до</p>
                  <p className="text-sm font-medium">
                    {formatDate(driver.licenseExpiry)}
                  </p>
                </div>
              )}
            </div>

            {/* Мед справка */}
            <div className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">
                  Медицинская справка
                </p>
                <p className="font-medium">
                  {driver.medicalExpiry ? "Действует" : "Не указана"}
                </p>
              </div>
              {driver.medicalExpiry && (
                <div
                  className={`text-right ${
                    isExpired(driver.medicalExpiry)
                      ? "text-red-400"
                      : isExpiringSoon(driver.medicalExpiry)
                      ? "text-yellow-400"
                      : "text-gray-500"
                  }`}
                >
                  <p className="text-xs">до</p>
                  <p className="text-sm font-medium">
                    {formatDate(driver.medicalExpiry)}
                  </p>
                </div>
              )}
            </div>

            {/* Дата приёма */}
            {driver.hiredAt && (
              <div className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">В компании с</p>
                  <p className="font-medium">
                    {formatDate(driver.hiredAt)}
                  </p>
                </div>
                <Calendar className="h-5 w-5 text-gray-600" />
              </div>
            )}
          </div>
        </div>

        {/* Предупреждения */}
        {(isExpiringSoon(driver.licenseExpiry) ||
          isExpiringSoon(driver.medicalExpiry) ||
          isExpired(driver.licenseExpiry) ||
          isExpired(driver.medicalExpiry)) && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-yellow-400">Внимание</p>
              <p className="text-sm text-yellow-500/80 mt-1">
                {isExpired(driver.licenseExpiry) && "ВУ просрочено. "}
                {isExpired(driver.medicalExpiry) && "Мед. справка просрочена. "}
                {!isExpired(driver.licenseExpiry) &&
                  isExpiringSoon(driver.licenseExpiry) &&
                  "Срок ВУ скоро истекает. "}
                {!isExpired(driver.medicalExpiry) &&
                  isExpiringSoon(driver.medicalExpiry) &&
                  "Срок мед. справки скоро истекает."}
              </p>
            </div>
          </div>
        )}

        {/* Кнопка: ТО / ремонт */}
        <button
          onClick={() => router.push("/m/maintenance")}
          className="w-full py-4 bg-[#151518] hover:bg-[#1a1a1f] border border-gray-800 rounded-2xl font-medium flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
        >
          <Wrench className="h-5 w-5 text-amber-400" />
          ТО / ремонт
        </button>

        {/* Выход */}
        <button
          onClick={handleLogout}
          className="w-full py-4 bg-red-500/10 hover:bg-red-500/15 text-red-400 border border-red-500/30 rounded-2xl font-medium flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
        >
          <LogOut className="h-5 w-5" />
          Выйти из аккаунта
        </button>
      </main>

      <BottomNav />
    </div>
  )
}
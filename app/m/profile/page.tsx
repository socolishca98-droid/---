// app/m/profile/page.tsx

"use client"

import { useState, useEffect, useCallback } from "react"
import { BottomNav } from "@/components/driver-mobile/bottom-nav"
import Link from "next/link"
import { useDriverSession } from "@/hooks/use-driver-session"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { formatPhone, telHref } from "@/lib/ui/phone"
import { toast } from "sonner"
import {
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
  KeyRound,
  Pencil,
} from "lucide-react"
import { TruckLoader } from "@/components/ui/truck-loader"

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
  const confirm = useConfirm()
  // Сессия — серверная (httpOnly-cookie), а не запись в localStorage:
  // раньше страница читала «driver_session», которой после задачи 1 больше
  // не существует, и любой вход заканчивался возвратом на экран логина
  const { driver: session, isLoading: isSessionLoading, logout, updateDriver, refresh } =
    useDriverSession()
  const [driver, setDriver] = useState<DriverProfile | null>(null)
  const [stats, setStats] = useState<DriverStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Свои данные: имя и телефон. Меняется только свой аккаунт — роут
  // /api/auth/profile берёт id из сессии, роли и организации в нём нет.
  const [editOpen, setEditOpen] = useState(false)
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [savingData, setSavingData] = useState(false)

  // Смена пароля. Форма открывается сама, если логист выдал временный
  // пароль: /m/login отправляет сюда с ?changePassword=1.
  const [pwOpen, setPwOpen] = useState(false)
  const [currentPw, setCurrentPw] = useState("")
  const [newPw, setNewPw] = useState("")
  const [repeatPw, setRepeatPw] = useState("")
  const [savingPw, setSavingPw] = useState(false)

  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get("changePassword") === "1") {
        setPwOpen(true)
      }
    } catch {
      /* истории нет — значит и флага нет */
    }
  }, [])

  const fetchProfile = useCallback(async (driverId: string) => {
    try {
      const driverRes = await fetch(`/api/drivers/${driverId}`)
      const driverData = await driverRes.json()

      if (driverData.success && driverData.driver) {
        setDriver(driverData.driver as DriverProfile)
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
  }, [])

  useEffect(() => {
    if (isSessionLoading) return
    if (session?.id) void fetchProfile(session.id)
  }, [isSessionLoading, session?.id, fetchProfile])

  // Пока профиль не догрузился, показываем данные из сессии — без пустого экрана
  const shown: DriverProfile | null =
    driver ??
    (session
      ? {
          id: session.id,
          name: session.name,
          phone: session.phone ?? "",
          vehicleType: session.vehicleType,
          vehiclePlate: session.vehiclePlate,
          status: session.status ?? "active",
          rating: session.rating ?? 5,
          ordersCompleted: session.ordersCompleted ?? 0,
          licenseNumber: session.licenseNumber ?? undefined,
          licenseExpiry: session.licenseExpiry ?? undefined,
          medicalExpiry: session.medicalExpiry ?? undefined,
          hiredAt: session.hiredAt ?? undefined,
        }
      : null)

  const startEdit = () => {
    setName(shown?.name ?? "")
    setPhone(shown?.phone ?? "")
    setPwOpen(false)
    setEditOpen(true)
  }

  const saveData = async () => {
    if (name.trim().length < 2) {
      toast.error("Укажите имя")
      return
    }
    setSavingData(true)
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data?.success) {
        toast.error(data?.error || "Не удалось сохранить данные")
        return
      }
      toast.success("Данные сохранены")
      setEditOpen(false)
      // Имя и телефон на экране берутся из загруженной карточки водителя, а
      // она имеет приоритет над сессией. Обновляем и её, иначе после
      // сохранения страница продолжит показывать старое имя до перезагрузки.
      setDriver((prev) => (prev ? { ...prev, name, phone } : prev))
      updateDriver({ name, phone })
      await refresh()
    } catch (error) {
      console.error("[m/profile] сохранение данных:", error)
      toast.error("Ошибка соединения")
    } finally {
      setSavingData(false)
    }
  }

  const changePassword = async () => {
    if (newPw !== repeatPw) {
      toast.error("Новые пароли не совпадают")
      return
    }
    setSavingPw(true)
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data?.success) {
        toast.error(data?.error || "Не удалось сменить пароль")
        return
      }
      toast.success("Пароль изменён. Другие устройства вышли из системы")
      setPwOpen(false)
      setCurrentPw("")
      setNewPw("")
      setRepeatPw("")
    } catch (error) {
      console.error("[m/profile] смена пароля:", error)
      toast.error("Ошибка соединения")
    } finally {
      setSavingPw(false)
    }
  }

  const handleLogout = async () => {
    const ok = await confirm({
      title: "Выйти из аккаунта?",
      description: "Чтобы вернуться к рейсам, нужно будет снова войти по телефону и паролю.",
      confirmLabel: "Выйти",
    })
    if (!ok) return

    await logout()
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

  if (isSessionLoading || !shown) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <TruckLoader className="text-orange-500" />
      </div>
    )
  }

  const initials = shown.name
    .split(" ")
    .map((n: any) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="min-h-screen bg-[#09090b] text-white m-nav-pad">
      {/* Header с аватаром */}
      <div className="bg-gradient-to-b from-orange-500/10 to-transparent pt-8 pb-6 px-4">
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center text-2xl font-bold shadow-lg shadow-orange-500/25">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold truncate">{shown.name}</h1>
            <a
              href={`tel:${telHref(shown.phone)}`}
              className="text-gray-400 text-sm flex items-center gap-1.5 mt-1 hover:text-gray-300"
            >
              <Phone className="h-4 w-4" />
              {formatPhone(shown.phone)}
            </a>
          </div>
        </div>

        {/* Бейджи */}
        <div className="flex flex-wrap gap-2 mt-4">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500/15 border border-yellow-500/30 rounded-full">
            <Star className="h-4 w-4 text-yellow-500" />
            <span className="text-sm font-medium text-yellow-500">
              {shown.rating?.toFixed(1) || "5.0"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/15 border border-emerald-500/30 rounded-full">
            <Award className="h-4 w-4 text-emerald-500" />
            <span className="text-sm font-medium text-emerald-500">
              {shown.ordersCompleted || 0} рейсов
            </span>
          </div>
        </div>
      </div>

      <main className="p-4 space-y-4">
        {/* Мои данные: имя и телефон — только свой аккаунт */}
        <div className="bg-[#151518] border border-gray-800 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Мои данные</p>
            {!editOpen && (
              <button
                type="button"
                onClick={startEdit}
                className="flex items-center gap-1.5 text-[13px] font-medium text-orange-400 active:opacity-70"
              >
                <Pencil className="h-3.5 w-3.5" />
                Изменить
              </button>
            )}
          </div>

          {editOpen ? (
            <div className="mt-3 space-y-3">
              <div>
                <label htmlFor="m-profile-name" className="block text-[12px] text-gray-500 mb-1.5">
                  Имя
                </label>
                <input
                  id="m-profile-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  className="w-full min-h-[48px] rounded-xl bg-[#0f0f12] border border-gray-700 px-3.5 text-[15px] text-white placeholder:text-gray-600 focus:border-orange-500/50 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="m-profile-phone" className="block text-[12px] text-gray-500 mb-1.5">
                  Телефон (это вход в приложение)
                </label>
                <input
                  id="m-profile-phone"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  inputMode="tel"
                  autoComplete="tel"
                  className="w-full min-h-[48px] rounded-xl bg-[#0f0f12] border border-gray-700 px-3.5 text-[15px] text-white placeholder:text-gray-600 focus:border-orange-500/50 focus:outline-none"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditOpen(false)}
                  disabled={savingData}
                  className="flex-1 min-h-[48px] rounded-xl border border-gray-700 text-[14px] font-medium text-gray-300 active:opacity-70 disabled:opacity-50"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={() => void saveData()}
                  disabled={savingData}
                  className="flex-1 min-h-[48px] rounded-xl bg-orange-500 text-[14px] font-semibold text-black active:opacity-70 disabled:opacity-50"
                >
                  {savingData ? "Сохраняем…" : "Сохранить"}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between text-[14px]">
                <span className="text-gray-500">Имя</span>
                <span className="font-medium text-white">{shown.name}</span>
              </div>
              <div className="flex items-center justify-between text-[14px]">
                <span className="text-gray-500">Телефон</span>
                <span className="font-medium text-white">
                  {formatPhone(shown.phone) || "—"}
                </span>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setEditOpen(false)
              setPwOpen((value) => !value)
            }}
            className="mt-3 w-full min-h-[48px] flex items-center justify-center gap-2 rounded-xl bg-[#1c1c21] border border-gray-800 text-[14px] font-medium text-white active:opacity-70"
          >
            <KeyRound className="h-4 w-4 text-orange-400" />
            {pwOpen ? "Отмена" : "Сменить пароль"}
          </button>

          {pwOpen && (
            <div className="mt-3 space-y-3">
              <input
                type="password"
                value={currentPw}
                onChange={(event) => setCurrentPw(event.target.value)}
                placeholder="Текущий пароль"
                autoComplete="current-password"
                className="w-full min-h-[48px] rounded-xl bg-[#0f0f12] border border-gray-700 px-3.5 text-[15px] text-white placeholder:text-gray-600 focus:border-orange-500/50 focus:outline-none"
              />
              <input
                type="password"
                value={newPw}
                onChange={(event) => setNewPw(event.target.value)}
                placeholder="Новый пароль (минимум 8 символов)"
                autoComplete="new-password"
                className="w-full min-h-[48px] rounded-xl bg-[#0f0f12] border border-gray-700 px-3.5 text-[15px] text-white placeholder:text-gray-600 focus:border-orange-500/50 focus:outline-none"
              />
              <input
                type="password"
                value={repeatPw}
                onChange={(event) => setRepeatPw(event.target.value)}
                placeholder="Повторите новый пароль"
                autoComplete="new-password"
                className="w-full min-h-[48px] rounded-xl bg-[#0f0f12] border border-gray-700 px-3.5 text-[15px] text-white placeholder:text-gray-600 focus:border-orange-500/50 focus:outline-none"
              />
              <p className="text-[11px] leading-relaxed text-gray-500">
                Минимум 8 символов, буквы и цифры. После смены остальные устройства
                выйдут из системы.
              </p>
              <button
                type="button"
                onClick={() => void changePassword()}
                disabled={savingPw}
                className="w-full min-h-[48px] rounded-xl bg-orange-500 text-[14px] font-semibold text-black active:opacity-70 disabled:opacity-50"
              >
                {savingPw ? "Меняем…" : "Сменить пароль"}
              </button>
            </div>
          )}
        </div>

        {/* Автомобиль (чтение) */}
        <div className="bg-[#151518] border border-gray-800 rounded-2xl p-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-500/15 flex items-center justify-center">
              <Truck className="h-6 w-6 text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-500">Автомобиль</p>
              <p className="font-bold text-lg">
                {shown.vehiclePlate || "Не назначен"}
              </p>
              {shown.vehicleType && (
                <p className="text-sm text-gray-400">{shown.vehicleType}</p>
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
                  {shown.licenseNumber || "Не указано"}
                </p>
              </div>
              {shown.licenseExpiry && (
                <div
                  className={`text-right ${
                    isExpired(shown.licenseExpiry)
                      ? "text-red-400"
                      : isExpiringSoon(shown.licenseExpiry)
                      ? "text-yellow-400"
                      : "text-gray-500"
                  }`}
                >
                  <p className="text-xs">до</p>
                  <p className="text-sm font-medium">
                    {formatDate(shown.licenseExpiry)}
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
                  {shown.medicalExpiry ? "Действует" : "Не указана"}
                </p>
              </div>
              {shown.medicalExpiry && (
                <div
                  className={`text-right ${
                    isExpired(shown.medicalExpiry)
                      ? "text-red-400"
                      : isExpiringSoon(shown.medicalExpiry)
                      ? "text-yellow-400"
                      : "text-gray-500"
                  }`}
                >
                  <p className="text-xs">до</p>
                  <p className="text-sm font-medium">
                    {formatDate(shown.medicalExpiry)}
                  </p>
                </div>
              )}
            </div>

            {/* Дата приёма */}
            {shown.hiredAt && (
              <div className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">В компании с</p>
                  <p className="font-medium">
                    {formatDate(shown.hiredAt)}
                  </p>
                </div>
                <Calendar className="h-5 w-5 text-gray-600" />
              </div>
            )}
          </div>
        </div>

        {/* Предупреждения */}
        {(isExpiringSoon(shown.licenseExpiry) ||
          isExpiringSoon(shown.medicalExpiry) ||
          isExpired(shown.licenseExpiry) ||
          isExpired(shown.medicalExpiry)) && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-yellow-400">Внимание</p>
              <p className="text-sm text-yellow-500/80 mt-1">
                {isExpired(shown.licenseExpiry) && "ВУ просрочено. "}
                {isExpired(shown.medicalExpiry) && "Мед. справка просрочена. "}
                {!isExpired(shown.licenseExpiry) &&
                  isExpiringSoon(shown.licenseExpiry) &&
                  "Срок ВУ скоро истекает. "}
                {!isExpired(shown.medicalExpiry) &&
                  isExpiringSoon(shown.medicalExpiry) &&
                  "Срок мед. справки скоро истекает."}
              </p>
            </div>
          </div>
        )}

        {/* Моя машина: выбор и смена своей машины в рейсе */}
        <Link
          href="/m/vehicle"
          className="w-full py-4 bg-[#151518] hover:bg-[#1a1a1f] border border-gray-800 rounded-2xl font-medium flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
        >
          <Truck className="h-5 w-5 text-sky-400" />
          {shown.vehiclePlate ? `Моя машина: ${shown.vehiclePlate}` : "Выбрать машину"}
        </Link>

        {/* Кнопка: ТО / ремонт */}
        <Link
          href="/m/maintenance"
          className="w-full py-4 bg-[#151518] hover:bg-[#1a1a1f] border border-gray-800 rounded-2xl font-medium flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
        >
          <Wrench className="h-5 w-5 text-amber-400" />
          ТО / ремонт
        </Link>

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
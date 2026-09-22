// app/m/maintenance/page.tsx

"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronLeft,
  Wrench,
  Loader2,
  Car,
  Fuel,
  Settings,
  CircleDot,
  FileText,
} from "lucide-react"
import { toast } from "sonner"

interface Driver {
  id: string
  name: string
  vehicleId?: string | null
  vehiclePlate?: string | null
}

const MAINTENANCE_TYPES = [
  {
    id: "oil_change",
    label: "Замена масла",
    icon: Fuel,
  },
  {
    id: "tire_change",
    label: "Замена шин",
    icon: CircleDot,
  },
  {
    id: "scheduled",
    label: "Плановое ТО",
    icon: Settings,
  },
  {
    id: "repair",
    label: "Ремонт",
    icon: Wrench,
  },
  {
    id: "inspection",
    label: "Осмотр / Диагностика",
    icon: Car,
  },
  {
    id: "other",
    label: "Другое",
    icon: FileText,
  },
] as const

export default function MaintenancePage() {
  const router = useRouter()

  const [driver, setDriver] = useState<Driver | null>(null)
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [description, setDescription] = useState("")
  const [mileage, setMileage] = useState("")
  const [cost, setCost] = useState("")
  const [performer, setPerformer] = useState<"driver" | "service">("driver")
  const [serviceName, setServiceName] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem("driver_session")
    if (!saved) {
      router.push("/m/login")
      return
    }

    try {
      const parsed = JSON.parse(saved) as Driver
      if (!parsed?.id) throw new Error("Invalid session")

      fetch(`/api/drivers/${parsed.id}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.driver) {
            setDriver({
              id: data.driver.id,
              name: data.driver.name,
              vehicleId: data.driver.vehicleId,
              vehiclePlate: data.driver.vehiclePlate,
            })
          } else {
            setDriver(parsed)
          }
        })
        .catch(() => setDriver(parsed))
    } catch {
      localStorage.removeItem("driver_session")
      router.push("/m/login")
    }
  }, [router])

  const handleSubmit = async () => {
    if (!driver?.id || !selectedType) {
      toast.error("Выберите тип ТО")
      return
    }

    if (!description.trim()) {
      toast.error("Опишите, что делается")
      return
    }

    if (!driver.vehicleId) {
      toast.error("Нет привязанного автомобиля", {
        description: "Выберите автомобиль в профиле",
      })
      return
    }

    if (performer === "service" && !serviceName.trim()) {
      toast.error("Укажите название СТО")
      return
    }

    setIsSubmitting(true)

    try {
      const res = await fetch("/api/m/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driverId: driver.id,
          vehicleId: driver.vehicleId,
          type: selectedType,
          description: description.trim(),
          mileage: mileage ? parseInt(mileage, 10) : null,
          cost: cost ? parseInt(cost, 10) : null,
          performer,
          serviceName: performer === "service" ? serviceName.trim() : null,
        }),
      })

      const data = await res.json()

      if (data.success) {
        toast.success("ТО начато", {
          description:
            performer === "driver"
              ? "Вы отмечены как выполняющий ТО"
              : `СТО: ${serviceName.trim()}`,
        })

        const updated = { ...driver, status: "maintenance" }
        localStorage.setItem("driver_session", JSON.stringify(updated))

        router.push("/m")
      } else {
        toast.error("Ошибка", {
          description: data.error || "Не удалось начать ТО",
        })
      }
    } catch (error) {
      console.error("Maintenance error:", error)
      toast.error("Ошибка связи")
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!driver) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    )
  }

  const selectedTypeInfo = MAINTENANCE_TYPES.find((t: any) => t.id === selectedType)

  return (
    <div className="min-h-screen bg-[#09090b] text-white pb-8">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[#09090b]/95 backdrop-blur-lg border-b border-gray-800/50">
        <div className="px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 rounded-xl hover:bg-gray-800 transition-colors"
          >
            <ChevronLeft className="h-5 w-5 text-gray-400" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold">ТО / Ремонт</h1>
            <p className="text-xs text-gray-500">
              {driver.vehiclePlate || "Нет привязанного ТС"}
            </p>
          </div>
        </div>
      </header>

      <main className="p-4 space-y-6">
        {/* Тип работ */}
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">
            Тип работ
          </p>
          <div className="grid grid-cols-2 gap-2">
            {MAINTENANCE_TYPES.map((type: any) => {
              const isSelected = selectedType === type.id
              return (
                <button
                  key={type.id}
                  onClick={() => setSelectedType(type.id)}
                  className={`p-4 rounded-xl border transition-all flex items-center gap-3 ${
                    isSelected
                      ? "border-amber-500 bg-amber-500/10"
                      : "border-gray-800 bg-[#151518] hover:border-gray-700"
                  }`}
                >
                  <type.icon
                    className={`h-5 w-5 ${
                      isSelected ? "text-amber-400" : "text-gray-500"
                    }`}
                  />
                  <span
                    className={`text-sm font-medium ${
                      isSelected ? "text-amber-400" : "text-gray-300"
                    }`}
                  >
                    {type.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Кто выполняет */}
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">
            Кто выполняет работы
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPerformer("driver")}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                performer === "driver"
                  ? "bg-emerald-500/20 border-emerald-500 text-emerald-400"
                  : "bg-[#151518] border-gray-800 text-gray-400 hover:border-gray-700"
              }`}
            >
              Водитель
            </button>
            <button
              onClick={() => setPerformer("service")}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                performer === "service"
                  ? "bg-blue-500/20 border-blue-500 text-blue-400"
                  : "bg-[#151518] border-gray-800 text-gray-400 hover:border-gray-700"
              }`}
            >
              СТО
            </button>
          </div>

          {performer === "service" && (
            <div className="mt-3">
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
                Название СТО
              </label>
              <input
                type="text"
                value={serviceName}
                onChange={(e) => setServiceName(e.target.value)}
                placeholder="Например: ООО «АвтоСервис»"
                className="w-full px-4 py-3 bg-[#151518] border border-gray-800 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
              />
            </div>
          )}
        </div>

        {/* Описание */}
        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">
            Что делается? *
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Например: замена масла и фильтров, проверка тормозов..."
            rows={4}
            className="w-full px-4 py-3 bg-[#151518] border border-gray-800 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/50 resize-none transition-colors"
          />
        </div>

        {/* Пробег + стоимость */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">
              Пробег (км)
            </label>
            <input
              type="number"
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
              placeholder="150000"
              className="w-full px-4 py-3 bg-[#151518] border border-gray-800 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/50 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">
              Стоимость (₽)
            </label>
            <input
              type="number"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="12000"
              className="w-full px-4 py-3 bg-[#151518] border border-gray-800 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500/50 transition-colors"
            />
          </div>
        </div>

        {/* Превью */}
        {selectedType && description.trim() && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center">
                {selectedTypeInfo && (
                  <selectedTypeInfo.icon className="h-5 w-5 text-white" />
                )}
              </div>
              <div>
                <p className="font-medium text-amber-400">
                  {selectedTypeInfo?.label}
                </p>
                <p className="text-xs text-gray-500">
                  {driver.vehiclePlate || "Нет ТС"}
                </p>
              </div>
            </div>
            <p className="text-sm text-gray-300">{description}</p>
            {mileage && (
              <p className="text-xs text-gray-500 mt-2">
                Пробег:{" "}
                {parseInt(mileage, 10).toLocaleString("ru-RU")} км
              </p>
            )}
            {(cost || performer === "service") && (
              <p className="text-xs text-gray-500 mt-1">
                {cost &&
                  `Ориентировочная стоимость: ${parseInt(
                    cost,
                    10
                  ).toLocaleString("ru-RU")} ₽. `}
                {performer === "service" &&
                  serviceName &&
                  `СТО: ${serviceName.trim()}.`}
              </p>
            )}
          </div>
        )}

        {/* Кнопка */}
        <button
          onClick={handleSubmit}
          disabled={isSubmitting || !selectedType || !description.trim()}
          className="w-full py-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 rounded-xl font-bold text-lg flex items-center justify-center gap-3 active:scale-[0.98] transition-all shadow-lg shadow-amber-500/25 disabled:shadow-none"
        >
          {isSubmitting ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>
              <Wrench className="h-5 w-5" />
              Начать ТО
            </>
          )}
        </button>

        <p className="text-xs text-gray-600 text-center">
          После начала ТО статус машины изменится на «На ТО».<br />
          Завершить ТО можно с главного экрана.
        </p>
      </main>
    </div>
  )
}
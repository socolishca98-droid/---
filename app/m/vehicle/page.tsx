// app/m/vehicle/page.tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { BottomNav } from "@/components/driver-mobile/bottom-nav"
import {
  Truck,
  Check,
  Loader2,
  AlertTriangle,
  Wrench,
  ChevronRight,
  ChevronLeft,
} from "lucide-react"

interface Vehicle {
  id: string
  plate: string
  type: string
  brand: string | null
  model: string | null
  capacity: number
  status: string
  assignedDriver: { id: string; name: string } | null
}

export default function VehicleSelectPage() {
  const router = useRouter()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [driverId, setDriverId] = useState<string | null>(null)
  const [currentVehicleId, setCurrentVehicleId] = useState<string | null>(null)

  useEffect(() => {
    // Получаем driverId из localStorage
    const stored = localStorage.getItem("driverSession")
    if (stored) {
      try {
        const session = JSON.parse(stored)
        setDriverId(session.driverId || session.id)
      } catch {
        router.push("/m/login")
        return
      }
    } else {
      router.push("/m/login")
      return
    }

    loadVehicles()
    loadCurrentVehicle()
  }, [router])

  const loadVehicles = async () => {
    try {
      const res = await fetch("/api/m/vehicle")
      const data = await res.json()
      if (data.success) {
        setVehicles(data.vehicles || [])
      }
    } catch (e) {
      console.error("Failed to load vehicles:", e)
    } finally {
      setIsLoading(false)
    }
  }

  const loadCurrentVehicle = async () => {
    const stored = localStorage.getItem("driverSession")
    if (!stored) return

    try {
      const session = JSON.parse(stored)
      const did = session.driverId || session.id
      const res = await fetch(`/api/drivers/${did}`)
      const data = await res.json()
      if (data.success && data.driver?.vehicleId) {
        setCurrentVehicleId(data.driver.vehicleId)
        setSelectedId(data.driver.vehicleId)
      }
    } catch (e) {
      console.error("Failed to load current vehicle:", e)
    }
  }

  const handleSelect = async (vehicleId: string) => {
    if (!driverId) return
    
    setSelectedId(vehicleId)
    setIsSaving(true)

    try {
      const res = await fetch("/api/m/vehicle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId, vehicleId }),
      })

      const data = await res.json()

      if (data.success) {
        // Обновляем сессию
        const stored = localStorage.getItem("driverSession")
        if (stored) {
          const session = JSON.parse(stored)
          session.vehicleId = vehicleId
          session.vehiclePlate = data.vehicle?.plate
          session.vehicleType = data.vehicle?.type
          localStorage.setItem("driverSession", JSON.stringify(session))
        }

        setCurrentVehicleId(vehicleId)
        
        // Небольшая задержка для UX
        setTimeout(() => {
          router.push("/m")
        }, 500)
      } else {
        alert(data.error || "Ошибка выбора машины")
        setSelectedId(currentVehicleId)
      }
    } catch (e) {
      console.error("Failed to select vehicle:", e)
      alert("Ошибка соединения")
      setSelectedId(currentVehicleId)
    } finally {
      setIsSaving(false)
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "maintenance":
        return <Wrench className="h-4 w-4 text-yellow-500" />
      case "in_use":
        return <AlertTriangle className="h-4 w-4 text-orange-500" />
      default:
        return null
    }
  }

  const getStatusText = (vehicle: Vehicle) => {
    if (vehicle.status === "maintenance") return "На ТО"
    if (vehicle.assignedDriver && vehicle.assignedDriver.id !== driverId) {
      return `Занята: ${vehicle.assignedDriver.name}`
    }
    return "Доступна"
  }

  const isDisabled = (vehicle: Vehicle) => {
    if (vehicle.status === "maintenance") return true
    if (vehicle.assignedDriver && vehicle.assignedDriver.id !== driverId) return true
    return false
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-white pb-24">
      {/* Кастомный хедер с кнопкой назад */}
      <header className="sticky top-0 z-10 bg-[#09090b]/95 backdrop-blur-lg border-b border-gray-800/50">
        <div className="px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 rounded-xl hover:bg-gray-800 transition-colors"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold">Выбор машины</h1>
            <p className="text-xs text-gray-500">Выберите транспортное средство</p>
          </div>
        </div>
      </header>

      <main className="p-4 space-y-3">
        {vehicles.length === 0 ? (
          <div className="text-center py-12">
            <Truck className="h-16 w-16 text-gray-700 mx-auto mb-4" />
            <p className="text-gray-400">Нет доступных машин</p>
          </div>
        ) : (
          vehicles.map((vehicle) => {
            const disabled = isDisabled(vehicle)
            const isSelected = selectedId === vehicle.id
            const isCurrent = currentVehicleId === vehicle.id

            return (
              <button
                key={vehicle.id}
                onClick={() => !disabled && handleSelect(vehicle.id)}
                disabled={disabled || isSaving}
                className={`
                  w-full p-4 rounded-2xl border transition-all text-left
                  ${disabled 
                    ? "bg-gray-900/50 border-gray-800 opacity-50 cursor-not-allowed" 
                    : isSelected
                      ? "bg-orange-500/10 border-orange-500"
                      : "bg-[#1a1a1f] border-gray-800 hover:border-gray-700 active:scale-[0.98]"
                  }
                `}
              >
                <div className="flex items-center gap-4">
                  {/* Иконка */}
                  <div className={`
                    w-12 h-12 rounded-xl flex items-center justify-center
                    ${isSelected ? "bg-orange-500/20" : "bg-gray-800"}
                  `}>
                    <Truck className={`h-6 w-6 ${isSelected ? "text-orange-400" : "text-gray-400"}`} />
                  </div>

                  {/* Инфо */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-lg">{vehicle.plate}</span>
                      {isCurrent && (
                        <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
                          Текущая
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-400">
                      {vehicle.brand} {vehicle.model} • {vehicle.type}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {(vehicle.capacity / 1000).toFixed(0)}т • {getStatusText(vehicle)}
                    </p>
                  </div>

                  {/* Статус / Выбор */}
                  <div className="flex items-center gap-2">
                    {getStatusIcon(vehicle.status)}
                    {isSelected && isSaving ? (
                      <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                    ) : isSelected ? (
                      <div className="w-6 h-6 rounded-full bg-orange-500 flex items-center justify-center">
                        <Check className="h-4 w-4 text-white" />
                      </div>
                    ) : !disabled ? (
                      <ChevronRight className="h-5 w-5 text-gray-600" />
                    ) : null}
                  </div>
                </div>
              </button>
            )
          })
        )}
      </main>

      <BottomNav />
    </div>
  )
}
"use client"

import { useState } from "react"
import { AlertTriangle, Loader2, Phone, X } from "lucide-react"
import { toast } from "sonner"

interface Props {
  driverId: string
  orderId?: string
}

// Типы должны совпадать с бэкендом (app/api/m/sos/route.ts)
const sosOptions = [
  {
    type: "breakdown",
    label: "Поломка",
    description: "Машина сломалась",
    color: "bg-yellow-500",
  },
  {
    type: "accident",
    label: "ДТП",
    description: "Попал в аварию",
    color: "bg-red-500",
  },
  {
    type: "cargo",
    label: "Проблема с грузом",
    description: "Повреждение, утеря",
    color: "bg-orange-500",
  },
  {
    type: "medical", // Было "health", исправлено на "medical"
    label: "Плохое самочувствие",
    description: "Нужна помощь",
    color: "bg-purple-500",
  },
  {
    type: "robbery", // Добавлено для полноты
    label: "Угроза / Ограбление",
    description: "Опасность",
    color: "bg-red-700",
  },
  {
    type: "other",
    label: "Другое",
    description: "Иная проблема",
    color: "bg-gray-500",
  },
]

export function SosButton({ driverId, orderId }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [isSending, setIsSending] = useState(false)

  const sendSos = async (type: string, message: string) => {
    setIsSending(true)

    try {
      let latitude = 0
      let longitude = 0

      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 5000,
          })
        })
        latitude = pos.coords.latitude
        longitude = pos.coords.longitude
      } catch {
        // Игнорируем ошибку GPS в критической ситуации
      }

      const res = await fetch("/api/m/sos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driverId,
          orderId,
          type,
          message,
          latitude,
          longitude,
        }),
      })

      const data = await res.json()

      if (data.success) {
        toast.success("SOS-сигнал отправлен!", {
          description: "Диспетчер получил ваше сообщение",
        })
        setIsOpen(false)
      } else {
        toast.error("Ошибка отправки SOS")
      }
    } catch (error) {
      console.error("SOS error:", error)
      toast.error("Ошибка связи")
    } finally {
      setIsSending(false)
    }
  }

  // Рендер кнопки и модалки остаётся прежним...
  // (Вставляешь сюда весь остальной JSX из оригинального файла)
  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="fixed right-4 bottom-24 w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/40 flex items-center justify-center transition-all active:scale-95 z-40 animate-pulse"
      >
        <AlertTriangle className="h-6 w-6 text-white" />
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-end animate-in fade-in slide-in-from-bottom-10">
          <div className="w-full max-w-md mx-auto bg-[#151518] rounded-t-3xl overflow-hidden">
            <div className="p-4 border-b border-gray-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                </div>
                <div>
                  <h3 className="font-bold text-white">SOS</h3>
                  <p className="text-xs text-gray-500">Выберите тип проблемы</p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 hover:bg-gray-800 rounded-lg"
              >
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>

            <div className="p-4 space-y-2 max-h-[60vh] overflow-y-auto">
              {sosOptions.map((option) => (
                <button
                  key={option.type}
                  onClick={() => sendSos(option.type, option.label)}
                  disabled={isSending}
                  className="w-full p-4 bg-[#1a1a1f] border border-gray-800 hover:border-gray-700 rounded-xl flex items-center gap-4 transition-all active:scale-[0.99] disabled:opacity-50"
                >
                  <div
                    className={`w-12 h-12 rounded-xl ${option.color} flex items-center justify-center`}
                  >
                    <AlertTriangle className="h-6 w-6 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-medium text-white">{option.label}</p>
                    <p className="text-sm text-gray-500">{option.description}</p>
                  </div>
                  {isSending && (
                    <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                  )}
                </button>
              ))}

              <a
                href="tel:112"
                className="w-full p-4 bg-red-500/20 border border-red-500/30 rounded-xl flex items-center gap-4 mt-4"
              >
                <div className="w-12 h-12 rounded-xl bg-red-500 flex items-center justify-center">
                  <Phone className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-medium text-red-400">Экстренный вызов</p>
                  <p className="text-sm text-red-500/70">Позвонить 112</p>
                </div>
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
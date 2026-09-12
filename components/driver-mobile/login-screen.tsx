// components/driver-mobile/login-screen.tsx

"use client"

import { useState } from "react"
import { Truck, ArrowRight, Loader2, AlertCircle } from "lucide-react"

interface LoginScreenProps {
  onLogin: (driver: any) => void
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [phone, setPhone] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError("")

    try {
      // Очищаем номер от лишних символов для поиска
      const cleanPhone = phone.trim()

      const res = await fetch('/api/m/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleanPhone })
      })
      
      const data = await res.json()
      
      if (data.success) {
        // Сохраняем сессию
        localStorage.setItem('driver_id', data.driver.id)
        localStorage.setItem('driver_name', data.driver.name)
        onLogin(data.driver)
      } else {
        setError("Номер не найден. Проверьте, создан ли водитель в разделе Автопарк.")
      }
    } catch (err) {
      setError("Ошибка соединения с сервером")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#09090b] flex flex-col items-center justify-center p-6 text-white safe-area-bottom">
      <div className="w-24 h-24 bg-gradient-to-br from-orange-600 to-orange-800 rounded-3xl flex items-center justify-center mb-8 shadow-2xl shadow-orange-900/50 animate-in zoom-in duration-500">
        <Truck className="h-12 w-12 text-white" />
      </div>
      
      <h1 className="text-3xl font-bold mb-2">Грузопоток.Водитель</h1>
      <p className="text-gray-500 mb-10 text-center max-w-xs">
        Введите номер телефона, указанный диспетчером в карточке водителя
      </p>
      
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-6">
        <div className="space-y-2">
          <label className="text-xs uppercase text-gray-500 font-bold tracking-wider ml-1">Номер телефона</label>
          <input
            type="tel"
            placeholder="+7 (999) 000-00-00"
            className="w-full bg-[#1a1a1f] border border-gray-800 rounded-2xl px-5 py-4 text-xl outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all placeholder:text-gray-700"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </div>
        
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 flex items-center gap-3 text-red-400 text-sm">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}
        
        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-white text-black hover:bg-gray-200 active:scale-95 transition-all rounded-2xl py-4 font-bold text-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:active:scale-100"
        >
          {isLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : <>Войти <ArrowRight className="h-5 w-5" /></>}
        </button>
      </form>

      <div className="mt-auto pt-10 text-center">
        <p className="text-xs text-gray-700">Версия 1.0.2</p>
      </div>
    </div>
  )
}
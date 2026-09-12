// app/m/login/page.tsx

"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  Truck,
  Phone,
  Loader2,
  ArrowRight,
  Building2,
} from "lucide-react"

export default function DriverLoginPage() {
  const router = useRouter()
  const [organization, setOrganization] = useState<string>("")
  const [phone, setPhone] = useState<string>("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (!organization.trim() || !phone.trim()) {
      setError("Укажите организацию и номер телефона")
      return
    }

    setIsLoading(true)
    setError("")

    try {
      const res = await fetch("/api/m/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phone.trim(),
          organization: organization.trim(),
        }),
      })

      const data = await res.json()

      if (data.success && data.driver) {
        localStorage.setItem("driver_session", JSON.stringify(data.driver))
        router.push("/m")
      } else {
        setError(data.error || "Водитель не найден")
      }
    } catch {
      setError("Ошибка соединения")
    } finally {
      setIsLoading(false)
    }
  }

  const canSubmit = organization.trim() && phone.trim()

  return (
    <div className="min-h-screen bg-[#09090b] text-white flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        {/* Logo */}
        <div className="w-20 h-20 rounded-2xl bg-orange-500/20 flex items-center justify-center mb-6">
          <Truck className="h-10 w-10 text-orange-500" />
        </div>

        <h1 className="text-2xl font-bold mb-2">АИ Логистика</h1>
        <p className="text-gray-400 mb-8">Приложение водителя</p>

        {/* Form */}
        <form onSubmit={handleLogin} className="w-full max-w-sm space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Организация
            </label>
            <div className="relative">
              <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
              <input
                type="text"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                placeholder="АИ Логистика"
                className="w-full pl-12 pr-4 py-4 bg-[#1a1a1f] border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Номер телефона
            </label>
            <div className="relative">
              <Phone className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+7 (999) 123-45-67"
                className="w-full pl-12 pr-4 py-4 bg-[#1a1a1f] border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition-colors"
              />
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-xl text-red-400 text-sm text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !canSubmit}
            className="w-full py-4 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-700 disabled:text-gray-500 rounded-xl font-bold transition-all flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                Войти
                <ArrowRight className="h-5 w-5" />
              </>
            )}
          </button>
        </form>
      </div>

      <div className="p-6 text-center text-xs text-gray-600">
        Введите организацию и номер телефона, указанные логистом в
        системе
      </div>
    </div>
  )
}
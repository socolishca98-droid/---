// app/lm/more/page.tsx — всё, что не поместилось в нижнее меню.
//
// Здесь же показывается предупреждение, если логист с телефона попал на
// раздел, у которого мобильной версии пока нет: вместо сломанной вёрстки
// он видит понятный экран и кнопку «открыть на компьютере».

"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  Bell,
  Building2,
  History,
  Camera as CameraIcon,
  Car,
  ExternalLink,
  Fuel as FuelIcon,
  KeyRound,
  Loader2,
  LogOut,
  Map as MapIcon,
  MessageSquare,
  Package,
  Search as SearchIcon,
  Settings2,
  ShieldCheck,
  Truck,
  Users,
  Wallet,
} from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { ActionButton, Card, LinkRow } from "@/components/logist-mobile/ui"
import { useStaffSession } from "@/hooks/use-staff-session"
import { apiSend } from "@/hooks/use-json-api"

const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  logist: "Логист",
  staff: "Сотрудник",
  driver: "Водитель",
}

export default function LogistMorePage() {
  const { user, organization, logout, mustChangePassword } = useStaffSession()
  const [passwordOpen, setPasswordOpen] = useState(Boolean(mustChangePassword))
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [repeat, setRepeat] = useState("")
  const [saving, setSaving] = useState(false)

  async function changePassword() {
    if (!current || !next) {
      toast.error("Заполните оба поля")
      return
    }
    if (next !== repeat) {
      toast.error("Новые пароли не совпадают")
      return
    }
    setSaving(true)
    const result = await apiSend("/api/auth/change-password", "POST", {
      currentPassword: current,
      newPassword: next,
    })
    setSaving(false)

    if (!result.ok) {
      toast.error(result.error || "Не удалось сменить пароль")
      return
    }
    toast.success("Пароль изменён")
    setCurrent("")
    setNext("")
    setRepeat("")
    setPasswordOpen(false)
  }

  return (
    <>
      <LogistHeader title="Ещё" subtitle="Разделы и профиль" userName={user?.name} />

      <div className="px-4 pt-4">
        <Card>
          <p className="text-[16px] font-semibold text-white">{user?.name || "—"}</p>
          <p className="mt-0.5 text-[13px] text-zinc-400">{user?.email || "email не указан"}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-zinc-500">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-2.5 py-1 text-zinc-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              {ROLE_LABELS[user?.role ?? ""] ?? user?.role}
            </span>
            {organization ? (
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" />
                {organization.name}
              </span>
            ) : null}
          </div>
        </Card>

        {mustChangePassword ? (
          <p className="mt-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.08] px-4 py-3 text-[13px] text-amber-200">
            Смените временный пароль — пока он действует, система будет напоминать об этом.
          </p>
        ) : null}

        {/* Администрирование: заявки, компания и настройки — обоим штабным
            ролям, журнал действий API отдаёт только админу */}
        <p className="mt-4 px-1 text-[12px] uppercase tracking-wide text-zinc-500">
          Администрирование
        </p>
        <div className="mt-1.5 overflow-hidden rounded-2xl border border-white/8 bg-white/[0.03]">
          <LinkRow icon={<ShieldCheck className="h-4.5 w-4.5" />} label="Сотрудники и доступ" href="/lm/users" />
          <LinkRow icon={<Building2 className="h-4.5 w-4.5" />} label="Организация и коды" href="/lm/organization" />
          <LinkRow icon={<Settings2 className="h-4.5 w-4.5" />} label="Настройки автопарка" href="/lm/settings" />
          {user?.role === "admin" ? (
            <LinkRow icon={<History className="h-4.5 w-4.5" />} label="Журнал действий" href="/lm/audit" />
          ) : null}
        </div>

        <p className="mt-4 px-1 text-[12px] uppercase tracking-wide text-zinc-500">Разделы</p>
        <div className="mt-1.5 overflow-hidden rounded-2xl border border-white/8 bg-white/[0.03]">
          <LinkRow icon={<SearchIcon className="h-4.5 w-4.5" />} label="Поиск грузов (ATI)" href="/lm/search" />
          <LinkRow icon={<Users className="h-4.5 w-4.5" />} label="Водители" href="/lm/drivers" />
          <LinkRow icon={<MapIcon className="h-4.5 w-4.5" />} label="Карта" href="/lm/map" />
          <LinkRow icon={<Users className="h-4.5 w-4.5" />} label="Клиенты" href="/lm/clients" />
          <LinkRow icon={<Wallet className="h-4.5 w-4.5" />} label="Оплаты" href="/lm/payments" />
          <LinkRow icon={<Truck className="h-4.5 w-4.5" />} label="Автопарк и ТО" href="/lm/fleet" />
          <LinkRow icon={<FuelIcon className="h-4.5 w-4.5" />} label="Топливо" href="/lm/fuel" />
          <LinkRow icon={<CameraIcon className="h-4.5 w-4.5" />} label="Фото" href="/lm/photos" />
          <LinkRow icon={<MessageSquare className="h-4.5 w-4.5" />} label="Чат с водителями" href="/lm/chat" />
          <LinkRow icon={<Bell className="h-4.5 w-4.5" />} label="Уведомления" href="/lm/notifications" />
          <LinkRow icon={<Package className="h-4.5 w-4.5" />} label="Отчёты и подсказки" href="/lm/reports" />
        </div>

        <p className="mt-4 px-1 text-[12px] uppercase tracking-wide text-zinc-500">Аккаунт</p>
        <div className="mt-1.5 overflow-hidden rounded-2xl border border-white/8 bg-white/[0.03]">
          <LinkRow
            icon={<KeyRound className="h-4.5 w-4.5" />}
            label="Сменить пароль"
            onClick={() => setPasswordOpen((value) => !value)}
          />
          <LinkRow
            icon={<ExternalLink className="h-4.5 w-4.5" />}
            label="Полная версия (для компьютера)"
            href="/dashboard?full=1"
          />
          <LinkRow icon={<Car className="h-4.5 w-4.5" />} label="Приложение водителя" href="/m/login" />
        </div>

        {passwordOpen ? (
          <Card className="mt-3 space-y-2.5">
            <input
              type="password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              placeholder="Текущий пароль"
              autoComplete="current-password"
              className={inputClass}
            />
            <input
              type="password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              placeholder="Новый пароль (минимум 8 символов)"
              autoComplete="new-password"
              className={inputClass}
            />
            <input
              type="password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
              placeholder="Повторите новый пароль"
              autoComplete="new-password"
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => void changePassword()}
              disabled={saving}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-orange-500 text-[14.5px] font-semibold text-white active:bg-orange-600 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : null}
              Сохранить пароль
            </button>
          </Card>
        ) : null}

        <div className="mt-4">
          <ActionButton tone="danger" full onClick={() => void logout()}>
            <LogOut className="h-4 w-4" /> Выйти из аккаунта
          </ActionButton>
        </div>

        <div className="mt-6 pb-2 text-center">
          <p className="text-[12px] text-zinc-600">Мобильная панель · админ и логист</p>
          <Link href="/docs" className="mt-1 inline-block text-[12px] text-zinc-500">
            Документация
          </Link>
        </div>
      </div>
    </>
  )
}

const inputClass =
  "min-h-[48px] w-full rounded-xl border border-white/8 bg-white/[0.04] px-3.5 text-[15px] text-white placeholder:text-zinc-600 focus:border-orange-500/50 focus:outline-none"

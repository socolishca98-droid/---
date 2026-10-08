// app/lm/more/page.tsx — «Ещё»: разделы, которые не поместились в нижнее меню,
// и профиль сотрудника.
//
// Здесь ровно две группы и десять строк: разделы, которые открываются из этого
// экрана, и ничего больше. То, что уже стоит в нижнем меню (Главная, Заказы,
// Рейсы, Карта), здесь не повторяется, а «Топливо», «Настройки» и «Журнал
// действий» живут внутри своих разделов — «Автопарка» и «Организации», чтобы
// на этом экране не было длинного хвоста мелких ссылок.
//
// Стрелка «назад» на каждом разделе ведёт сюда же (см. mobileParentPath):
// у экрана один родитель, и это «Ещё».

"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  BarChart3,
  Building2,
  Camera as CameraIcon,
  Car,
  Loader2,
  LogOut,
  MessageSquare,
  Search as SearchIcon,
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

/** Разделы под рукой: с ними работают каждый день. */
const WORK_LINKS: SectionLink[] = [
  { href: "/lm/drivers", label: "Водители", icon: Truck },
  { href: "/lm/clients", label: "Клиенты", icon: Users },
  { href: "/lm/chat", label: "Чат", icon: MessageSquare },
  { href: "/lm/payments", label: "Оплаты", icon: Wallet },
  { href: "/lm/photos", label: "Фото от водителей", icon: CameraIcon },
  { href: "/lm/search", label: "Поиск грузов", icon: SearchIcon },
]

/** Компания: сюда заходят реже — настроить, проверить, отчитаться. */
const COMPANY_LINKS: SectionLink[] = [
  { href: "/lm/fleet", label: "Автопарк", icon: Car },
  { href: "/lm/reports", label: "Отчёты", icon: BarChart3 },
  { href: "/lm/users", label: "Сотрудники", icon: ShieldCheck },
  { href: "/lm/organization", label: "Организация", icon: Building2 },
]

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
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[16px] font-semibold text-white">{user?.name || "—"}</p>
              <p className="mt-0.5 truncate text-[13px] text-zinc-400">{user?.email || "email не указан"}</p>
            </div>
            <button
              type="button"
              onClick={() => setPasswordOpen((value) => !value)}
              className="shrink-0 rounded-xl bg-white/8 px-3 py-2 text-[12.5px] font-medium text-zinc-100 active:bg-white/12"
            >
              {passwordOpen ? "Отмена" : "Сменить пароль"}
            </button>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12.5px] text-zinc-500">
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

        <SectionGroup title="Работа" items={WORK_LINKS} />
        <SectionGroup title="Компания" items={COMPANY_LINKS} />

        <div className="mt-5">
          <ActionButton tone="danger" full onClick={() => void logout()}>
            <LogOut className="h-4 w-4" /> Выйти из аккаунта
          </ActionButton>
        </div>

        <div className="mt-5 space-y-2 pb-2 text-center">
          <p className="text-[12px] text-zinc-600">
            <Link href="/dashboard?full=1" className="text-zinc-500 underline decoration-zinc-700">
              Полная версия для компьютера
            </Link>
            <span className="px-1.5">·</span>
            <Link href="/m/login" className="text-zinc-500 underline decoration-zinc-700">
              Приложение водителя
            </Link>
            <span className="px-1.5">·</span>
            <Link href="/docs" className="text-zinc-500 underline decoration-zinc-700">
              Документация
            </Link>
          </p>
          <p className="text-[12px] text-zinc-600">Мобильная панель · админ и логист</p>
        </div>
      </div>
    </>
  )
}

type SectionLink = {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

/** Группа разделов: подпись и карточка со строками. Всего таких групп две. */
function SectionGroup({ title, items }: { title: string; items: SectionLink[] }) {
  return (
    <>
      <p className="mt-4 px-1 text-[12px] uppercase tracking-wide text-zinc-500">{title}</p>
      <div className="mt-1.5 overflow-hidden rounded-2xl border border-white/8 bg-white/[0.03]">
        {items.map((item) => {
          const Icon = item.icon
          return <LinkRow key={item.href} icon={<Icon className="h-4.5 w-4.5" />} label={item.label} href={item.href} />
        })}
      </div>
    </>
  )
}

const inputClass =
  "min-h-[48px] w-full rounded-xl border border-white/8 bg-white/[0.04] px-3.5 text-[15px] text-white placeholder:text-zinc-600 focus:border-orange-500/50 focus:outline-none"

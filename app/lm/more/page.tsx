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

import { useEffect, useState } from "react"
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
  UserCog,
  ChevronRight,
} from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { ActionButton, Card, LinkRow } from "@/components/logist-mobile/ui"
import { useStaffSession } from "@/hooks/use-staff-session"
import { apiSend, useJsonApi } from "@/hooks/use-json-api"
import { formatPhone } from "@/lib/ui/phone"

/** Ответ /api/auth/session — нужен флаг владельца платформы */
interface SessionFlags {
  isOwner?: boolean
}

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
  { href: "/lm/search", label: "Биржа грузов", icon: SearchIcon },
]

/** Компания: сюда заходят реже — настроить, проверить, отчитаться. */
const COMPANY_LINKS: SectionLink[] = [
  { href: "/lm/fleet", label: "Автопарк", icon: Car },
  { href: "/lm/reports", label: "Отчёты", icon: BarChart3 },
  { href: "/lm/users", label: "Сотрудники", icon: ShieldCheck },
  { href: "/lm/organization", label: "Организация", icon: Building2 },
]

export default function LogistMorePage() {
  const { user, organization, logout, mustChangePassword, refresh } = useStaffSession()
  // Владельцу платформы показываем вход в любой аккаунт
  const sessionFlags = useJsonApi<SessionFlags>(user ? "/api/auth/session" : null)
  const isOwner = Boolean(sessionFlags.data?.isOwner)
  const [passwordOpen, setPasswordOpen] = useState(Boolean(mustChangePassword))
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [repeat, setRepeat] = useState("")
  const [saving, setSaving] = useState(false)

  // Свои данные: имя и телефон. Форма подставляется из базы, сохранение —
  // PATCH /api/auth/profile (свой аккаунт, роль и организация недоступны).
  const [profileOpen, setProfileOpen] = useState(false)
  const [profileName, setProfileName] = useState("")
  const [profilePhone, setProfilePhone] = useState("")
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)

  useEffect(() => {
    if (!profileOpen) return
    let alive = true
    setProfileLoading(true)
    fetch("/api/auth/profile", { cache: "no-store" })
      .then((response) => response.json().catch(() => null))
      .then((data) => {
        if (!alive) return
        if (data?.success && data.profile) {
          setProfileName(String(data.profile.name ?? ""))
          setProfilePhone(String(data.profile.phone ?? ""))
        }
      })
      .catch(() => {
        /* сеть недоступна — поля останутся пустыми */
      })
      .finally(() => {
        if (alive) setProfileLoading(false)
      })
    return () => {
      alive = false
    }
  }, [profileOpen])

  async function saveProfile() {
    if (profileName.trim().length < 2) {
      toast.error("Укажите имя")
      return
    }
    setProfileSaving(true)
    const result = await apiSend("/api/auth/profile", "PATCH", {
      name: profileName,
      phone: profilePhone,
    })
    setProfileSaving(false)

    if (!result.ok) {
      toast.error(result.error || "Не удалось сохранить данные")
      return
    }
    toast.success("Данные сохранены")
    setProfileOpen(false)
    await refresh()
  }

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
              <p className="truncate text-[16px] font-semibold text-foreground">{user?.name || "—"}</p>
              <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{user?.email || "email не указан"}</p>
              <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                {user?.phone ? formatPhone(user.phone) : "телефон не указан"}
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setProfileOpen((value) => !value)
                  setPasswordOpen(false)
                }}
                className="rounded-xl bg-secondary px-3 py-2 text-[12.5px] font-medium text-foreground active:opacity-70"
              >
                {profileOpen ? "Отмена" : "Изменить данные"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPasswordOpen((value) => !value)
                  setProfileOpen(false)
                }}
                className="rounded-xl bg-secondary px-3 py-2 text-[12.5px] font-medium text-foreground active:opacity-70"
              >
                {passwordOpen ? "Отмена" : "Сменить пароль"}
              </button>
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-foreground/90">
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

        {profileOpen ? (
          <Card className="mt-3 space-y-2.5">
            <p className="text-[13px] text-muted-foreground">
              Имя и телефон — только свои. Роль и организацию меняет администратор.
            </p>
            <input
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              placeholder="Имя"
              autoComplete="name"
              disabled={profileLoading || profileSaving}
              className={inputClass}
            />
            <input
              value={profilePhone}
              onChange={(event) => setProfilePhone(event.target.value)}
              placeholder="Телефон для входа"
              autoComplete="tel"
              inputMode="tel"
              disabled={profileLoading || profileSaving}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => void saveProfile()}
              disabled={profileSaving || profileLoading}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-[14.5px] font-semibold text-primary-foreground active:opacity-70 disabled:opacity-50"
            >
              {profileSaving ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : null}
              Сохранить данные
            </button>
          </Card>
        ) : null}

        {isOwner ? (
          <Link
            href="/owner"
            className="mt-3 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/15 px-4 py-3 active:opacity-70"
          >
            <UserCog className="h-5 w-5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="block text-[14.5px] font-semibold text-foreground">Вход в любой аккаунт</span>
              <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
                Открыть кабинет сотрудника или приложение водителя без их пароля
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-primary" />
          </Link>
        ) : null}

        {mustChangePassword ? (
          <p className="mt-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-[13px] text-warning">
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
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-[14.5px] font-semibold text-primary-foreground active:opacity-70 disabled:opacity-50"
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
          <p className="text-[12px] text-muted-foreground/80">
            <Link href="/dashboard?full=1" className="text-muted-foreground underline decoration-border">
              Полная версия для компьютера
            </Link>
            <span className="px-1.5">·</span>
            <Link href="/m/login" className="text-muted-foreground underline decoration-border">
              Приложение водителя
            </Link>
            <span className="px-1.5">·</span>
            <Link href="/docs" className="text-muted-foreground underline decoration-border">
              Документация
            </Link>
          </p>
          <p className="text-[12px] text-muted-foreground/80">Мобильная панель · админ и логист</p>
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
      <p className="mt-4 px-1 text-[12px] uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="mt-1.5 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {items.map((item) => {
          const Icon = item.icon
          return <LinkRow key={item.href} icon={<Icon className="h-4.5 w-4.5" />} label={item.label} href={item.href} />
        })}
      </div>
    </>
  )
}

const inputClass =
  "min-h-[48px] w-full rounded-xl border border-border bg-card px-3.5 text-[15px] text-foreground placeholder:text-muted-foreground/80 focus:border-primary/50 focus:outline-none"

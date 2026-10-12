"use client"

/**
 * Шапка штабных страниц.
 *
 * Показывает РЕАЛЬНО вошедшего пользователя (из серверной сессии), а не
 * захардкоженного «Ивана Логистова», и выполняет настоящий выход:
 * POST /api/auth/logout отзывает сессию в БД и удаляет httpOnly-cookie.
 *
 * Колокольчик уведомлений (SOS, новые фото, просрочки, догрузы) — живой:
 * он берёт данные из GET /api/notifications (см. components/notifications-bell.tsx).
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { AccountSwitchBanner } from "@/components/account-switch-banner"
import { NotificationsBell } from "@/components/notifications-bell"
import { Badge } from "@/components/ui/badge"
import { Building2, KeyRound, Loader2, LogOut, Menu, UserCog, Users } from "lucide-react"
import { MobileNav } from "@/components/mobile-nav"
import { toast } from "sonner"
import { formatGreeting, formatHumanDate } from "@/lib/ui/greeting"
import { useJsonApi } from "@/hooks/use-json-api"

const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  logist: "Логист",
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/**
 * Пункт «Вход в любой аккаунт» — только у владельца платформы.
 * Флаг приходит из /api/auth/session (см. app/api/auth/session/route.ts).
 */
function OwnerMenuItem() {
  const { data } = useJsonApi<{ isOwner?: boolean }>("/api/auth/session")
  if (!data?.isOwner) return null
  return (
    <DropdownMenuItem asChild>
      <Link href="/owner" className="flex items-center gap-2 cursor-pointer">
        <UserCog className="h-4 w-4" />
        Вход в любой аккаунт
      </Link>
    </DropdownMenuItem>
  )
}

export function Header() {
  const router = useRouter()
  const { user, logout, refresh } = useAuth()

  // Часы — только на клиенте: серверный рендер не должен «спорить» с
  // гидратацией из-за разного времени (приветствие по времени суток).
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => setNow(new Date()), [])

  const [isLoggingOut, setIsLoggingOut] = useState(false)
  // На телефоне боковой панели нет — разделы открываются выдвижным меню
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  // «Мой профиль»: свои имя и телефон + смена пароля в одном окне
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [profileName, setProfileName] = useState("")
  const [profilePhone, setProfilePhone] = useState("")
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [repeatPassword, setRepeatPassword] = useState("")
  const [isChanging, setIsChanging] = useState(false)

  // Форма профиля подставляется из базы (GET /api/auth/profile): в шапке
  // живёт сессия, а телефон в неё не входит.
  useEffect(() => {
    if (!isProfileOpen) return
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
        /* сеть недоступна — поля останутся пустыми, сохранение перезапишет */
      })
      .finally(() => {
        if (alive) setProfileLoading(false)
      })
    return () => {
      alive = false
    }
  }, [isProfileOpen])

  const handleSaveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setProfileSaving(true)
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: profileName, phone: profilePhone }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data?.success) {
        toast.error(data?.error || "Не удалось сохранить данные")
        return
      }
      toast.success("Данные сохранены")
      // Имя в шапке и приветствии должно обновиться сразу
      await refresh()
      setIsProfileOpen(false)
    } catch (error) {
      console.error("[header] сохранение профиля:", error)
      toast.error("Ошибка соединения")
    } finally {
      setProfileSaving(false)
    }
  }

  const handleLogout = async () => {
    setIsLoggingOut(true)
    try {
      await logout()
      router.replace("/login")
      router.refresh()
    } catch (error) {
      console.error("[header] ошибка выхода:", error)
      toast.error("Не удалось выйти. Обновите страницу")
    } finally {
      setIsLoggingOut(false)
    }
  }

  const handleChangePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (newPassword !== repeatPassword) {
      toast.error("Пароли не совпадают")
      return
    }

    setIsChanging(true)
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data?.success) {
        toast.error(data?.error || "Не удалось сменить пароль")
        return
      }

      toast.success("Пароль изменён. Остальные устройства вышли из системы")
      setIsProfileOpen(false)
      setCurrentPassword("")
      setNewPassword("")
      setRepeatPassword("")
    } catch (error) {
      console.error("[header] смена пароля:", error)
      toast.error("Ошибка соединения")
    } finally {
      setIsChanging(false)
    }
  }

  if (!user) {
    return (
      <>
        <header className="surface-glass sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border/70 px-4 lg:px-6">
          <button
            type="button"
            onClick={() => setIsMobileNavOpen(true)}
            aria-label="Открыть меню"
            className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-accent lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Проверяем доступ...
          </div>
        </header>
        <MobileNav open={isMobileNavOpen} onClose={() => setIsMobileNavOpen(false)} />
      </>
    )
  }

  return (
    <>
      {/* Владелец в чужом аккаунте: всегда видно, где ты, и как вернуться */}
      <AccountSwitchBanner />
      <header className="surface-glass sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border/70 px-4 lg:px-6">
        <button
          type="button"
          onClick={() => setIsMobileNavOpen(true)}
          aria-label="Открыть меню"
          className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-accent lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
      {/* Приветствие по времени суток: человек видит, что система «знает» его */}
      <div className="hidden lg:flex flex-col leading-tight min-w-0">
        <span className="text-sm font-semibold truncate">
          {now ? formatGreeting(user.name, now) : "Здравствуйте"}
        </span>
        <span className="text-xs text-muted-foreground truncate">
          {now ? formatHumanDate(now) : "\u00a0"}
        </span>
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <NotificationsBell />

        {user.mustChangePassword && (
          <Badge variant="outline" className="border-amber-500/40 text-amber-500 gap-1.5">
            <KeyRound className="h-3.5 w-3.5" />
            смените пароль
          </Badge>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 px-2">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                  {initials(user.name)}
                </AvatarFallback>
              </Avatar>
              <div className="hidden md:flex flex-col items-start">
                <span className="text-sm font-medium">{user.name}</span>
                <span className="text-xs text-muted-foreground">
                  {ROLE_LABELS[user.role] || user.role}
                  {user.organization?.name ? ` · ${user.organization.name}` : ""}
                </span>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="flex flex-col">
              <span>{user.name}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {user.email || "—"}
              </span>
              {user.organization?.name && (
                <span className="text-xs font-normal text-muted-foreground">
                  {user.organization.name}
                </span>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {/* Владелец платформы: вход в любой аккаунт одной кнопкой */}
            <OwnerMenuItem />

            <DropdownMenuItem asChild>
              <Link href="/organization" className="flex items-center gap-2 cursor-pointer">
                <Building2 className="h-4 w-4" />
                Организация
              </Link>
            </DropdownMenuItem>

            <DropdownMenuItem asChild>
              <Link href="/users" className="flex items-center gap-2 cursor-pointer">
                <Users className="h-4 w-4" />
                Сотрудники и доступ
              </Link>
            </DropdownMenuItem>

            <DropdownMenuItem
              className="flex items-center gap-2 cursor-pointer"
              onSelect={() => setIsProfileOpen(true)}
            >
              <UserCog className="h-4 w-4" />
              Мой профиль
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              className="text-destructive focus:text-destructive gap-2 cursor-pointer"
              disabled={isLoggingOut}
              onSelect={() => void handleLogout()}
            >
              {isLoggingOut ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              Выйти
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={isProfileOpen} onOpenChange={setIsProfileOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Мой профиль</DialogTitle>
            <DialogDescription>
              Имя и телефон — только свои. Роль и организацию меняет администратор.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Имя</Label>
              <Input
                id="profile-name"
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
                disabled={profileLoading || profileSaving}
                required
                minLength={2}
                maxLength={80}
                autoComplete="name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-phone">Телефон</Label>
              <Input
                id="profile-phone"
                value={profilePhone}
                onChange={(event) => setProfilePhone(event.target.value)}
                disabled={profileLoading || profileSaving}
                placeholder="+7 900 555-44-33"
                autoComplete="tel"
              />
              <p className="text-xs text-muted-foreground">
                {user?.role === "driver"
                  ? "Телефон — это вход в приложение водителя, убрать его нельзя."
                  : "Вход по-прежнему выполняется по email — телефон нужен для связи."}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-email">Email (логин)</Label>
              <Input id="profile-email" value={user?.email ?? ""} disabled readOnly />
            </div>

            <DialogFooter>
              <Button type="submit" disabled={profileSaving || profileLoading}>
                {profileSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Сохранить данные
              </Button>
            </DialogFooter>
          </form>

          <div className="border-t border-border pt-4">
            <DialogHeader>
              <DialogTitle className="text-base">Смена пароля</DialogTitle>
              <DialogDescription>
                После смены пароля все другие сессии будут завершены — на других
                устройствах потребуется войти заново.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleChangePassword} className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="current-password">Текущий пароль</Label>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="header-new-password">Новый пароль</Label>
                <Input
                  id="header-new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  minLength={8}
                />
                <p className="text-xs text-muted-foreground">Минимум 8 символов, буквы и цифры</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="header-repeat-password">Повторите новый пароль</Label>
                <Input
                  id="header-repeat-password"
                  type="password"
                  autoComplete="new-password"
                  value={repeatPassword}
                  onChange={(event) => setRepeatPassword(event.target.value)}
                  required
                  minLength={8}
                />
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsProfileOpen(false)}
                  disabled={isChanging}
                >
                  Закрыть
                </Button>
                <Button type="submit" disabled={isChanging || !currentPassword || !newPassword}>
                  {isChanging && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Сменить пароль
                </Button>
              </DialogFooter>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </header>
    <MobileNav open={isMobileNavOpen} onClose={() => setIsMobileNavOpen(false)} />
    </>
  )
}

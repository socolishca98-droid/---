"use client"

/**
 * Шапка штабных страниц.
 *
 * Показывает РЕАЛЬНО вошедшего пользователя (из серверной сессии), а не
 * захардкоженного «Ивана Логистова», и выполняет настоящий выход:
 * POST /api/auth/logout отзывает сессию в БД и удаляет httpOnly-cookie.
 *
 * Поиск и колокольчик уведомлений — предмет задачи 4 (каркас интерфейса):
 * до её выполнения они не отображаются, чтобы не выдавать нерабочие элементы
 * за работающие.
 */

import { useState } from "react"
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
import { Badge } from "@/components/ui/badge"
import { Building2, KeyRound, Loader2, LogOut, ShieldCheck, Users } from "lucide-react"
import { toast } from "sonner"

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

export function Header() {
  const router = useRouter()
  const { user, logout } = useAuth()

  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [isPasswordOpen, setIsPasswordOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [repeatPassword, setRepeatPassword] = useState("")
  const [isChanging, setIsChanging] = useState(false)

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
      setIsPasswordOpen(false)
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
      <header className="surface-glass sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border/70 px-6">
        <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Проверяем доступ...
        </div>
      </header>
    )
  }

  return (
    <header className="surface-glass sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border/70 px-6">
      <div className="flex items-center gap-2 ml-auto">
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
              onSelect={() => setIsPasswordOpen(true)}
            >
              <ShieldCheck className="h-4 w-4" />
              Сменить пароль
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

      <Dialog open={isPasswordOpen} onOpenChange={setIsPasswordOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Смена пароля</DialogTitle>
            <DialogDescription>
              После смены пароля все другие сессии будут завершены — на других устройствах
              потребуется войти заново.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleChangePassword} className="space-y-4">
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
                onClick={() => setIsPasswordOpen(false)}
                disabled={isChanging}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={isChanging || !currentPassword || !newPassword}>
                {isChanging && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Сменить пароль
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </header>
  )
}

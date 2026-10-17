"use client"

// components/owner/owner-profile-dialog.tsx
// «Мой профиль» в пульте владельца платформы.
//
// Зачем отдельно: пульт владельца живёт в своей оболочке (OwnerShell) и не
// показывает штабную шапку, где у обычных сотрудников есть «Мой профиль».
// Владелец — такая же учётная запись (email из OWNER_EMAIL), поэтому те же
// правила и тот же API: PATCH /api/auth/profile меняет имя и телефон,
// POST /api/auth/change-password — пароль. Роль и организацию отсюда не
// поменять: это делает администратор компании.

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
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

interface OwnerProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Email вошедшего владельца — только для показа, он же логин. */
  email: string | null
  /** Обновить имя в шапке пульта после сохранения. */
  onSaved: () => void | Promise<void>
}

export function OwnerProfileDialog({ open, onOpenChange, email, onSaved }: OwnerProfileDialogProps) {
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [repeatPassword, setRepeatPassword] = useState("")
  const [changing, setChanging] = useState(false)

  // Форма подставляется из базы: в сессии телефона нет.
  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    fetch("/api/auth/profile", { cache: "no-store" })
      .then((response) => response.json().catch(() => null))
      .then((data) => {
        if (!alive) return
        if (data?.success && data.profile) {
          setName(String(data.profile.name ?? ""))
          setPhone(String(data.profile.phone ?? ""))
        }
      })
      .catch(() => {
        /* сеть недоступна — поля останутся пустыми, сохранение перезапишет */
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open])

  async function handleSaveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data?.success) {
        toast.error(data?.error || "Не удалось сохранить данные")
        return
      }
      toast.success("Данные сохранены")
      // Имя в шапке пульта должно обновиться сразу, без перезагрузки страницы.
      await onSaved()
      onOpenChange(false)
    } catch (error) {
      console.error("[owner-profile] сохранение профиля:", error)
      toast.error("Ошибка соединения")
    } finally {
      setSaving(false)
    }
  }

  async function handleChangePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (newPassword !== repeatPassword) {
      toast.error("Пароли не совпадают")
      return
    }
    setChanging(true)
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
      onOpenChange(false)
      setCurrentPassword("")
      setNewPassword("")
      setRepeatPassword("")
    } catch (error) {
      console.error("[owner-profile] смена пароля:", error)
      toast.error("Ошибка соединения")
    } finally {
      setChanging(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Мой профиль</DialogTitle>
          <DialogDescription>
            Имя и телефон — только свои. Роль и организацию меняет администратор.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="owner-profile-name">Имя</Label>
            <Input
              id="owner-profile-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={loading || saving}
              required
              minLength={2}
              maxLength={80}
              autoComplete="name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="owner-profile-phone">Телефон</Label>
            <Input
              id="owner-profile-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              disabled={loading || saving}
              placeholder="+7 900 555-44-33"
              autoComplete="tel"
            />
            <p className="text-xs text-muted-foreground">
              Вход в пульт выполняется по email — телефон нужен для связи.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="owner-profile-email">Email (логин)</Label>
            <Input id="owner-profile-email" value={email ?? ""} disabled readOnly />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={saving || loading}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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

          <form onSubmit={handleChangePassword} className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="owner-current-password">Текущий пароль</Label>
              <Input
                id="owner-current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="owner-new-password">Новый пароль</Label>
              <Input
                id="owner-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                minLength={8}
              />
              <p className="text-xs text-muted-foreground">Не короче 8 символов.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="owner-repeat-password">Повторите пароль</Label>
              <Input
                id="owner-repeat-password"
                type="password"
                autoComplete="new-password"
                value={repeatPassword}
                onChange={(event) => setRepeatPassword(event.target.value)}
                required
                minLength={8}
              />
            </div>

            <DialogFooter>
              <Button type="submit" variant="outline" disabled={changing}>
                {changing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Сменить пароль
              </Button>
            </DialogFooter>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

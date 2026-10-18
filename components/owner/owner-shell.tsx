"use client"

// Общая оболочка экранов владельца платформы: шапка, навигация, выход.
// Стиль — тот же тёмный язык, что у компьютерной версии: карточки bg-card,
// тонкие границы, акцент primary.

import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Building2, Loader2, LogOut, ScrollText, ShieldCheck, Truck, UserCog } from "lucide-react"

import { AccountSwitchBanner } from "@/components/account-switch-banner"
import { OwnerProfileDialog } from "@/components/owner/owner-profile-dialog"
import { useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"

const NAV = [
  { href: "/owner", label: "Компании", icon: Building2, match: (p: string) => p === "/owner" || p.startsWith("/owner/org") },
  { href: "/owner/journal", label: "Журнал", icon: ScrollText, match: (p: string) => p.startsWith("/owner/journal") },
]

export function OwnerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/owner"
  const router = useRouter()
  const { user, organization, logout, refresh } = useStaffSession()
  const [isProfileOpen, setIsProfileOpen] = useState(false)

  // Пульт открывается только владельцу (сервер решает по сессии, которая
  // выпускается лишь после входа с email и паролем владельца). Всем
  // остальным — тихий уход на их обычный экран, без намёков на этот раздел.
  const gate = useJsonApi<{ isOwner?: boolean; session?: { user?: { role?: string } } }>(
    "/api/auth/session",
  )
  const isOwner = Boolean(gate.data?.isOwner)
  useEffect(() => {
    if (gate.loading) return
    if (gate.error) {
      router.replace("/login")
      return
    }
    if (gate.data && !gate.data.isOwner) {
      const role = gate.data.session?.user?.role
      router.replace(role === "logist" ? "/lm" : role === "driver" ? "/m" : "/dashboard")
    }
  }, [gate.loading, gate.error, gate.data, router])

  // Рабочий кабинет: логист — мобильная панель, админ — полная версия.
  // У владельца без своей компании кабинета нет — кнопку не показываем.
  const workHref = user?.role === "logist" ? "/lm" : "/dashboard"
  const hasOwnCompany = Boolean(organization)

  async function handleLogout() {
    await logout()
    router.replace("/login")
  }

  // Пока право не подтверждено — нейтральный экран загрузки (ничего не раскрываем)
  if (!isOwner) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 md:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <ShieldCheck className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0" title="Владелец платформы">
              {/* Имя владельца — то, что он сам задал в «Моём профиле»; роль
                  остаётся подписью, чтобы пульт не терял смысл. */}
              <p className="truncate text-[15px] font-semibold leading-tight">
                {user?.name?.trim() || "Владелец платформы"}
              </p>
              <p className="truncate text-[12px] text-muted-foreground">
                Владелец платформы · {user?.email ?? ""}
              </p>
            </div>
          </div>

          <nav className="ml-auto hidden items-center gap-1 rounded-lg border border-border p-1 md:flex">
            {NAV.map((item) => {
              const active = item.match(pathname)
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] transition-colors duration-200 ${
                    active
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <div className="flex items-center gap-2">
            {hasOwnCompany ? (
              // На кнопке видно, какая именно организация откроется: у владельца
              // может быть своя компания, а «Мой кабинет» без названия уводил
              // в непонятно куда — в том числе в тестовую организацию.
              <Link
                href={workHref}
                title={`Открыть кабинет организации «${organization?.name ?? ""}»`}
                className="inline-flex max-w-[46vw] items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px] text-foreground/90 transition-colors duration-200 hover:bg-secondary sm:max-w-[240px]"
              >
                <Truck className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden truncate sm:inline">Кабинет: {organization?.name ?? "моя компания"}</span>
                <span className="truncate sm:hidden">Кабинет</span>
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => setIsProfileOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors duration-200 hover:text-foreground active:opacity-70"
              aria-label="Мой профиль"
              title="Мой профиль — имя, телефон, пароль"
            >
              <UserCog className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors duration-200 hover:text-foreground active:opacity-70"
              aria-label="Выйти"
              title="Выйти"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Мобильная навигация — под шапкой */}
        <nav className="mx-auto flex max-w-6xl gap-1 px-4 pb-2 md:hidden">
          {NAV.map((item) => {
            const active = item.match(pathname)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-1 rounded-md px-3 py-2 text-center text-[13px] transition-colors duration-200 ${
                  active ? "bg-secondary text-foreground" : "text-muted-foreground"
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-6 md:px-8">
        <AccountSwitchBanner className="mb-4 rounded-lg border" />
        {children}
      </main>

      {/* Свои имя, телефон и пароль — без участия администратора компании. */}
      <OwnerProfileDialog
        open={isProfileOpen}
        onOpenChange={setIsProfileOpen}
        email={user?.email ?? null}
        onSaved={() => void refresh()}
      />
    </div>
  )
}

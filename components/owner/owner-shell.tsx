"use client"

// Общая оболочка экранов владельца платформы: шапка, навигация, выход.
// Стиль — тот же тёмный язык, что у компьютерной версии: карточки bg-card,
// тонкие границы, акцент primary.

import type { ReactNode } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Building2, LogOut, ScrollText, ShieldCheck, Truck } from "lucide-react"

import { AccountSwitchBanner } from "@/components/account-switch-banner"
import { useStaffSession } from "@/hooks/use-staff-session"

const NAV = [
  { href: "/owner", label: "Компании", icon: Building2, match: (p: string) => p === "/owner" || p.startsWith("/owner/org") },
  { href: "/owner/journal", label: "Журнал", icon: ScrollText, match: (p: string) => p.startsWith("/owner/journal") },
]

export function OwnerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/owner"
  const router = useRouter()
  const { user, logout } = useStaffSession()

  // Рабочий кабинет: логист — мобильная панель, админ — полная версия
  const workHref = user?.role === "logist" ? "/lm" : "/dashboard"

  async function handleLogout() {
    await logout()
    router.replace("/login")
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 md:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <ShieldCheck className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold leading-tight">Владелец платформы</p>
              <p className="truncate text-[12px] text-muted-foreground">{user?.email ?? ""}</p>
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
            <Link
              href={workHref}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px] text-foreground/90 transition-colors duration-200 hover:bg-secondary"
            >
              <Truck className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Мой кабинет</span>
              <span className="sm:hidden">Кабинет</span>
            </Link>
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
    </div>
  )
}

// components/logist-mobile/app-header.tsx
//
// Шапка мобильных экранов логиста: назад/заголовок, колокольчик уведомлений,
// аватар-переход в профиль. Липкая — на длинных списках всегда видно, где ты.
//
// Стрелка «назад» ведёт не по истории браузера, а по дереву разделов
// (mobileParentPath): у каждого экрана один и тот же родитель, куда ни зайди
// с телефона — после перезапуска приложения или по ссылке из уведомления.

"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowLeft, Bell } from "lucide-react"
import { useJsonApi } from "@/hooks/use-json-api"
import { mobileParentPath } from "@/lib/logist-mobile/routing"

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?"
}

export function LogistHeader({
  title,
  subtitle,
  back = false,
  userName,
}: {
  title: string
  subtitle?: string
  back?: boolean
  userName?: string | null
}) {
  const { data } = useJsonApi<{ unread: number }>("/api/notifications")
  const unread = data?.unread ?? 0
  const pathname = usePathname() ?? "/lm"

  return (
    <header
      className="sticky top-0 z-30 border-b border-white/8 bg-[#0b0b0e]/95 backdrop-blur"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-3">
        {back ? (
          <Link
            href={mobileParentPath(pathname)}
            aria-label="Назад"
            className="-ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full active:bg-white/8"
          >
            <ArrowLeft className="h-5 w-5 text-zinc-200" />
          </Link>
        ) : null}

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-semibold leading-tight text-white">{title}</h1>
          {subtitle ? <p className="truncate text-[12px] text-zinc-500">{subtitle}</p> : null}
        </div>

        <Link
          href="/lm/notifications"
          aria-label="Уведомления"
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full active:bg-white/8"
        >
          <Bell className="h-5 w-5 text-zinc-200" />
          {unread > 0 ? (
            <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-semibold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Link>

        <Link
          href="/lm/more"
          aria-label="Профиль"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-500/15 text-[12px] font-semibold text-orange-300"
        >
          {userName ? initials(userName) : "?"}
        </Link>
      </div>
    </header>
  )
}

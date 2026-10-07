// components/logist-mobile/ui.tsx
//
// Мелкие строительные блоки мобильных экранов логиста: карточки-показатели,
// заголовки секций, пустые состояния, скелетоны, строки-ссылки.
// Общие стили в одном месте — экраны остаются читаемыми.

"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { ChevronRight } from "lucide-react"

export function Card({
  children,
  className = "",
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-2xl border border-white/8 bg-white/[0.03] p-4 ${className}`}>{children}</div>
  )
}

/** Плитка-показатель: цифра + подпись, опционально ведёт на экран. */
export function KpiCard({
  label,
  value,
  hint,
  href,
  tone = "default",
}: {
  label: string
  value: string | number
  hint?: string
  href?: string
  tone?: "default" | "warn" | "good" | "accent"
}) {
  const tones: Record<string, string> = {
    default: "text-white",
    warn: "text-amber-300",
    good: "text-emerald-300",
    accent: "text-orange-300",
  }

  // «1 052 000 ₽» не влезает в плитку двойным кеглем — уменьшаем длинные значения
  const valueText = String(value)
  const valueSize = valueText.length > 9 ? "text-[20px]" : "text-2xl"

  const content = (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3.5 active:bg-white/[0.06]">
      <div className={`${valueSize} font-semibold leading-none ${tones[tone]}`}>{value}</div>
      <div className="mt-1.5 text-[13px] leading-snug text-zinc-400">{label}</div>
      {hint ? <div className="mt-1 text-[11px] text-zinc-500">{hint}</div> : null}
    </div>
  )

  if (href) {
    return (
      <Link href={href} className="block">
        {content}
      </Link>
    )
  }
  return content
}

export function SectionTitle({
  title,
  action,
}: {
  title: string
  /** Ссылка «все заказы» или своя кнопка — что уместнее на экране */
  action?: ReactNode | { label: string; href: string }
}) {
  const isLink =
    action !== null &&
    typeof action === "object" &&
    !Array.isArray(action) &&
    "href" in (action as Record<string, unknown>) &&
    "label" in (action as Record<string, unknown>)

  return (
    <div className="mb-2.5 mt-6 flex items-baseline justify-between gap-3">
      <h2 className="text-[15px] font-semibold text-white">{title}</h2>
      {action ? (
        <div className="shrink-0 text-[13px] font-medium text-orange-400">
          {isLink ? (
            <Link href={(action as { label: string; href: string }).href}>
              {(action as { label: string; href: string }).label}
            </Link>
          ) : (
            (action as ReactNode)
          )}
        </div>
      ) : null}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-white/8 bg-white/[0.02] px-6 py-10 text-center">
      {icon ? <div className="mb-3 text-zinc-500">{icon}</div> : null}
      <p className="text-[15px] font-medium text-zinc-200">{title}</p>
      {description ? <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-[76px] animate-pulse rounded-2xl bg-white/[0.04]" />
      ))}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.07] p-4">
      <p className="text-[13px] text-red-200">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg bg-white/10 px-3 py-1.5 text-[13px] font-medium text-white active:bg-white/15"
        >
          Повторить
        </button>
      ) : null}
    </div>
  )
}

/** Строка-ссылка: иконка, подпись, значение, стрелка. */
export function LinkRow({
  icon,
  label,
  value,
  href,
  onClick,
  danger = false,
}: {
  icon?: ReactNode
  label: string
  value?: string
  href?: string
  onClick?: () => void
  danger?: boolean
}) {
  const inner = (
    <>
      {icon ? <span className="shrink-0 text-zinc-400">{icon}</span> : null}
      <span className={`flex-1 text-[15px] ${danger ? "text-red-300" : "text-zinc-100"}`}>{label}</span>
      {value ? <span className="text-[13px] text-zinc-500">{value}</span> : null}
      {href ? <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" /> : null}
    </>
  )

  const className =
    "flex min-h-[52px] w-full items-center gap-3 border-b border-white/5 px-4 text-left last:border-b-0 active:bg-white/[0.04]"

  if (href) {
    return (
      <Link href={href} className={className}>
        {inner}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {inner}
    </button>
  )
}

/** Действие в карточке: крупная кнопка под палец. */
export function ActionButton({
  children,
  onClick,
  tone = "default",
  disabled = false,
  full = false,
}: {
  children: ReactNode
  onClick?: () => void
  tone?: "default" | "primary" | "danger"
  disabled?: boolean
  full?: boolean
}) {
  const tones: Record<string, string> = {
    default: "bg-white/8 text-white active:bg-white/12",
    primary: "bg-orange-500 text-white active:bg-orange-600",
    danger: "bg-red-500/15 text-red-200 border border-red-500/30 active:bg-red-500/25",
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[14px] font-medium transition-colors disabled:opacity-40 ${tones[tone]} ${full ? "w-full" : ""}`}
    >
      {children}
    </button>
  )
}

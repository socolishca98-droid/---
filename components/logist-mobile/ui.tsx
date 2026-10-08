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
    <div className={`rounded-xl border border-border bg-card shadow-sm p-4 ${className}`}>{children}</div>
  )
}

/** Плитка-показатель: цифра + подпись, опционально ведёт на экран. */
export function KpiCard({
  label,
  value,
  hint,
  href,
  tone = "default",
  loading = false,
}: {
  label: string
  value: string | number
  hint?: string
  href?: string
  tone?: "default" | "warn" | "good" | "accent"
  /** Пока данные не пришли, вместо нуля — пульсирующая заглушка */
  loading?: boolean
}) {
  const tones: Record<string, string> = {
    default: "text-foreground",
    warn: "text-warning",
    good: "text-success",
    accent: "text-primary",
  }

  // «1 052 000 ₽» не влезает в плитку двойным кеглем — уменьшаем длинные значения
  const valueText = String(value)
  const valueSize = valueText.length > 9 ? "text-[20px]" : "text-2xl"

  const content = (
    <div className="rounded-xl border border-border bg-card shadow-sm p-3.5 active:opacity-70">
      {loading ? (
        <div className="h-6 w-12 animate-pulse rounded-md bg-secondary" />
      ) : (
        <div className={`${valueSize} font-semibold leading-none ${tones[tone]}`}>{value}</div>
      )}
      <div className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{label}</div>
      {hint ? <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div> : null}
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
      <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
      {action ? (
        <div className="shrink-0 text-[13px] font-medium text-primary">
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
    <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card shadow-sm/60 px-6 py-10 text-center">
      {icon ? <div className="mb-3 text-muted-foreground">{icon}</div> : null}
      <p className="text-[15px] font-medium text-foreground">{title}</p>
      {description ? <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-[76px] animate-pulse rounded-xl bg-secondary" />
      ))}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-destructive/20 bg-destructive/[0.07] p-4">
      <p className="text-[13px] text-destructive">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg bg-secondary px-3 py-1.5 text-[13px] font-medium text-foreground active:opacity-70"
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
      {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
      <span className={`flex-1 text-[15px] ${danger ? "text-destructive" : "text-foreground"}`}>{label}</span>
      {value ? <span className="text-[13px] text-muted-foreground">{value}</span> : null}
      {href ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/80" /> : null}
    </>
  )

  const className =
    "flex min-h-[52px] w-full items-center gap-3 border-b border-border px-4 text-left last:border-b-0 active:opacity-70"

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
    default: "bg-secondary text-foreground active:opacity-70",
    primary: "bg-primary text-primary-foreground active:opacity-70-600",
    danger: "bg-destructive/15 text-destructive border border-destructive/30 active:opacity-70-500/25",
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

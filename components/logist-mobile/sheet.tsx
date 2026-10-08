// components/logist-mobile/sheet.tsx
//
// Нижняя шторка мобильной панели: подтверждение действия и небольшие формы.
//
// Зачем своя, а не window.confirm: на телефоне системное окно показывает адрес
// страницы, обрезает текст и не даёт сказать «что произойдёт». Здесь заголовок,
// объяснение последствий и одна большая кнопка — палец попадает без прицела.
//
// Шторка живёт в портале к <body>: у экранов бывают свои transform/overflow,
// и внутри карточки fixed-элемент мог бы уехать вместе с прокруткой.

"use client"

import { useEffect } from "react"
import { createPortal } from "react-dom"
import { Loader2, X } from "lucide-react"

export function Sheet({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: React.ReactNode
}) {
  // Закрытие по Esc — для тех, кто подключил клавиатуру к планшету
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open || typeof document === "undefined") return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Закрыть"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />
      <div
        className="relative w-full max-w-md rounded-t-3xl border-t border-border bg-card pb-[calc(16px+env(safe-area-inset-bottom))] shadow-2xl"
        style={{ animation: "sheet-up 180ms ease-out" }}
      >
        <div className="flex items-start gap-3 px-4 pt-4">
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-semibold leading-snug text-foreground">{title}</p>
            {description ? (
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть шторку"
            className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground active:opacity-70"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="px-4 pb-1 pt-3.5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/** Подтверждение перехода: объясняем, что произойдёт, и просим одно «да». */
export function ConfirmSheet({
  open,
  title,
  description,
  confirmLabel,
  tone = "primary",
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  description?: string
  confirmLabel: string
  tone?: "primary" | "danger" | "success"
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const tones: Record<string, string> = {
    primary: "bg-primary text-primary-foreground active:opacity-70-600",
    success: "bg-success/90 text-foreground active:opacity-70-600",
    danger: "bg-destructive/90 text-foreground active:opacity-70-600",
  }

  return (
    <Sheet open={open} title={title} description={description} onClose={onClose}>
      <button
        type="button"
        disabled={busy}
        onClick={onConfirm}
        className={`flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold disabled:opacity-50 ${tones[tone]}`}
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
        {busy ? "Сохраняю…" : confirmLabel}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-xl text-[14px] font-medium text-muted-foreground active:opacity-70"
      >
        Не сейчас
      </button>
    </Sheet>
  )
}

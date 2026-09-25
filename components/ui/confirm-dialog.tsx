"use client"

// components/ui/confirm-dialog.tsx
//
// Единое подтверждение опасных действий вместо window.confirm.
//
// Системное окно браузера выбивается из интерфейса: его нельзя оформить,
// на телефоне оно выглядит чужеродно, а текст нельзя разбить на заголовок и
// пояснение. Здесь тот же AlertDialog, что и у подтверждения отказа от заказа.
//
// Использование:
//   const confirm = useConfirm()
//   if (!(await confirm("Удалить транспорт?"))) return
//   if (!(await confirm({ title: "Завершить рейс?", description: "...", confirmLabel: "Завершить" }))) return

import * as React from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"

export interface ConfirmOptions {
  /** Короткий вопрос: «Удалить транспорт?» */
  title: string
  /** Что именно произойдёт — если действие неочевидно */
  description?: string
  /** Подпись кнопки согласия, например «Завершить рейс» */
  confirmLabel?: string
  cancelLabel?: string
  /** Опасное действие — кнопка подтверждения становится красной */
  destructive?: boolean
}

export type ConfirmAsk = (options: ConfirmOptions | string) => Promise<boolean>

const ConfirmContext = React.createContext<ConfirmAsk | null>(null)

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = React.useState<ConfirmOptions | null>(null)
  const pending = React.useRef<((value: boolean) => void) | null>(null)

  const ask = React.useCallback<ConfirmAsk>((input) => {
    const next: ConfirmOptions = typeof input === "string" ? { title: input } : input
    return new Promise<boolean>((resolve) => {
      // Если предыдущий вопрос ещё висел (быстрый повторный вызов) — закрываем
      // его отказом, чтобы промис не остался неразрешённым
      pending.current?.(false)
      pending.current = resolve
      setOptions(next)
    })
  }, [])

  const close = React.useCallback((value: boolean) => {
    const resolve = pending.current
    pending.current = null
    setOptions(null)
    resolve?.(value)
  }, [])

  return (
    <ConfirmContext.Provider value={ask}>
      {children}

      <AlertDialog
        open={options !== null}
        onOpenChange={(open) => {
          // Escape и клик по фону — это отказ, а не согласие
          if (!open) close(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{options?.title}</AlertDialogTitle>
            {options?.description ? (
              <AlertDialogDescription>{options.description}</AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => close(false)}>
              {options?.cancelLabel ?? "Отмена"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => close(true)}
              className={cn(
                options?.destructive &&
                  "bg-destructive text-destructive-foreground hover:bg-destructive/90",
              )}
            >
              {options?.confirmLabel ?? "Подтвердить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  )
}

/** Спросить подтверждение. Возвращает true, только если человек согласился. */
export function useConfirm(): ConfirmAsk {
  const context = React.useContext(ConfirmContext)
  if (!context) {
    throw new Error("useConfirm: приложение должно быть обёрнуто в <ConfirmProvider>")
  }
  return context
}

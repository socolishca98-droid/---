'use client'

import { useToast } from '@/components/ui/use-toast'
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast'

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({
        id,
        title,
        description,
        action,
        variant,
        ...props
      }) {
        return (
          <Toast
            key={id}
            {...props}
            variant={variant}
            className="w-full text-[13px]"
          >
            <div className="grid min-w-0 flex-1 gap-0.5">
              {title && (
                <ToastTitle className="text-[13px] font-semibold">
                  {title}
                </ToastTitle>
              )}
              {description && (
                <ToastDescription className="text-[11px] opacity-75">
                  {description}
                </ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      {/* Тосты снизу по центру — как шторка iOS */}
      <ToastViewport className="fixed bottom-4 left-1/2 z-[100] flex w-full max-w-[400px] -translate-x-1/2 flex-col gap-2 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]" />
    </ToastProvider>
  )
}

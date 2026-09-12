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
        ...props
      }) {
        return (
          <Toast
            key={id}
            {...props}
            className="bg-[#18181b]/95 border border-gray-700 text-sm text-gray-100 shadow-lg shadow-black/40"
          >
            <div className="grid gap-1 pr-6">
              {title && (
                <ToastTitle className="text-[13px] font-semibold">
                  {title}
                </ToastTitle>
              )}
              {description && (
                <ToastDescription className="text-[11px] text-gray-400">
                  {description}
                </ToastDescription>
              )}
            </div>
            {action}
            <ToastClose className="text-gray-500 hover:text-gray-200" />
          </Toast>
        )
      })}
      {/* Тосты снизу по центру */}
      <ToastViewport className="fixed bottom-4 left-1/2 -translate-x-1/2 flex flex-col gap-2 w-full max-w-sm z-[100]" />
    </ToastProvider>
  )
}
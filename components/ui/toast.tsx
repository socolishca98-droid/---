'use client'

import * as React from 'react'
import * as ToastPrimitives from '@radix-ui/react-toast'
import { cva, type VariantProps } from 'class-variance-authority'
import { Check, Info, TriangleAlert, X } from 'lucide-react'

import { cn } from '@/lib/utils'

const ToastProvider = ToastPrimitives.Provider

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      'fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]',
      className,
    )}
    {...props}
  />
))
ToastViewport.displayName = ToastPrimitives.Viewport.displayName

// Иконки-«глазки» уведомлений (как в iOS — иконка статуса слева).
const toastIcons = {
  default: Info,
  destructive: TriangleAlert,
  success: Check,
} as const

const toastVariants = cva(
  [
    // «Прозрачное стекло» iOS: размытие подложки, лёгкая световая граница,
    // мягкая глубокая тень, крупное скругление.
    'group pointer-events-auto relative flex w-full items-center gap-3 overflow-hidden',
    'rounded-2xl border border-white/15 p-4 pr-9',
    'backdrop-blur-xl backdrop-saturate-150',
    'shadow-[0_8px_32px_rgba(0,0,0,0.36)] ring-1 ring-inset ring-white/10',
    'transition-all',
    'data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none',
    'data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out',
    'data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full',
    'data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full',
    'data-[state=open]:duration-300',
  ],
  {
    variants: {
      variant: {
        default: 'bg-white/10 text-foreground',
        destructive:
          'destructive group border-red-400/25 bg-red-950/45 text-red-50',
        success:
          'border-emerald-400/25 bg-emerald-950/40 text-emerald-50',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> &
    VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => {
  const Icon = toastIcons[(variant ?? 'default') as keyof typeof toastIcons]
  return (
    <ToastPrimitives.Root
      ref={ref}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    >
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full backdrop-blur-sm',
          variant === 'destructive'
            ? 'bg-red-400/20 text-red-200'
            : variant === 'success'
              ? 'bg-emerald-400/20 text-emerald-200'
              : 'bg-white/15 text-foreground/80',
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
    </ToastPrimitives.Root>
  )
})
Toast.displayName = ToastPrimitives.Root.displayName

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      'inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 px-3 text-[12px] font-medium backdrop-blur-sm transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
      className,
    )}
    {...props}
  />
))
ToastAction.displayName = ToastPrimitives.Action.displayName

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      'absolute right-2.5 top-2.5 rounded-full p-1 text-foreground/40 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100 group-[.destructive]:text-red-300/70 group-[.destructive]:hover:text-red-100 group-[.success]:text-emerald-300/70 group-[.success]:hover:text-emerald-100',
      className,
    )}
    toast-close=""
    {...props}
  >
    <X className="h-3.5 w-3.5" />
  </ToastPrimitives.Close>
))
ToastClose.displayName = ToastPrimitives.Close.displayName

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={cn('text-[13px] font-semibold leading-tight', className)}
    {...props}
  />
))
ToastTitle.displayName = ToastPrimitives.Title.displayName

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn('text-[11px] leading-snug opacity-75', className)}
    {...props}
  />
))
ToastDescription.displayName = ToastPrimitives.Description.displayName

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>

type ToastActionElement = React.ReactElement<typeof ToastAction>

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
}

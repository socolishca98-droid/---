// lib/sentry.ts - P2-2 Sentry wrapper, no-op if DSN not set
import * as Sentry from "@sentry/nextjs"

export function captureException(error: unknown, context?: Record<string, unknown>) {
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN
  if (!dsn) {
    console.error("[Sentry disabled] captureException:", error, context)
    return
  }
  if (context) {
    Sentry.captureException(error, { extra: context })
  } else {
    Sentry.captureException(error)
  }
}

export function captureMessage(message: string, level: Sentry.SeverityLevel = "info") {
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN
  if (!dsn) {
    console.log(`[Sentry disabled] ${level}:`, message)
    return
  }
  Sentry.captureMessage(message, level)
}

export function setUser(user: { id?: string; email?: string } | null) {
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN
  if (!dsn) return
  Sentry.setUser(user)
}

export { Sentry }

// sentry.client.config.ts - P2-2 Sentry client config
import * as Sentry from "@sentry/nextjs"

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    debug: false,
    environment: process.env.NODE_ENV,
    // Only send errors in production
    enabled: process.env.NODE_ENV === "production",
  })
  console.log("[Sentry] Client initialized")
} else {
  console.log("[Sentry] No DSN, client disabled")
}

// next.config.mjs - P0 hardened + P2-2 Sentry
import { withSentryConfig } from "@sentry/nextjs"

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: false, // P1-1: strict - no implicit any allowed
  },
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
  // tesseract.js запускает воркер из своей папки в node_modules. Внутри
  // сборки Next (standalone/трейсинг) путь к воркеру ломается — «Cannot find
  // module .../tesseract.js/src/worker-script/node/index.js». Поэтому пакет
  // оставляем внешним: он подключается из node_modules как есть.
  serverExternalPackages: ["tesseract.js"],
  experimental: {
    optimizePackageImports: ['lucide-react', '@dnd-kit/core', '@dnd-kit/sortable'],
  },
}

const sentryWebpackPluginOptions = {
  silent: true, // Suppresses all logs
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Only upload sourcemaps in production if auth token present
  authToken: process.env.SENTRY_AUTH_TOKEN,
}

export default process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, sentryWebpackPluginOptions)
  : nextConfig

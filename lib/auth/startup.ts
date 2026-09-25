// lib/auth/startup.ts — проверка обязательной конфигурации при старте сервера.
//
// Зачем отдельный файл: getAuthSecret() (lib/auth/token.ts) падает лениво — в
// момент первого обращения к секрету. Процесс при этом успевает стартовать, а
// middleware (proxy.ts) начинает отвечать 503 «Сервер не настроен». Формально
// система закрыта, но «сервер отказывается стартовать без AUTH_SECRET» — нет.
//
// Здесь та же проверка выполняется ДО подъёма приложения: instrumentation.ts
// вызывает collectStartupIssues() и, если есть проблемы, печатает их и завершает
// процесс. Файл намеренно чистый (без Next.js, Prisma и node:*), чтобы его можно
// было собрать и покрыть тестами вместе с остальными модулями авторизации.

import { getAuthSecret } from "./token"

export type StartupIssueCode = "auth_secret"

export interface StartupIssue {
  code: StartupIssueCode
  /** Текст из getAuthSecret: что не так и как починить */
  message: string
}

/**
 * Все проблемы конфигурации, с которыми сервер поднимать нельзя.
 * Возвращает пустой массив, если запускаться можно.
 */
export function collectStartupIssues(
  env: NodeJS.ProcessEnv = process.env,
): StartupIssue[] {
  const issues: StartupIssue[] = []

  try {
    getAuthSecret(env)
  } catch (error) {
    issues.push({
      code: "auth_secret",
      message: error instanceof Error ? error.message : String(error),
    })
  }

  return issues
}

/** Человекочитаемый текст отказа: что не задано и какой командой это исправить. */
export function formatStartupFailure(issues: StartupIssue[]): string {
  const lines = [
    "",
    "═".repeat(72),
    "СЕРВЕР НЕ ЗАПУЩЕН: обязательная конфигурация не задана",
    "═".repeat(72),
  ]
  for (const issue of issues) lines.push(`  ✗ ${issue.message}`)
  lines.push(
    "",
    "  Без AUTH_SECRET подписывать и проверять сессии невозможно: приложение",
    "  стартовало бы «открытым» (любой мог бы подделать cookie сессии).",
    "  Задайте секрет в .env и повторите запуск:",
    "",
    "    node -e \"console.log(require('node:crypto').randomBytes(48).toString('hex'))\"",
    "",
    "  Скопируйте результат в .env строкой AUTH_SECRET=… (см. .env.example).",
    "  Для каждой среды — свой секрет; при смене секрета все сессии истекут.",
    "═".repeat(72),
    "",
  )
  return lines.join("\n")
}

/**
 * Бросает ошибку, если конфигурация неполная. Используется там, где процесс
 * завершать нельзя (тесты, скрипты) — instrumentation.ts вместо этого вызывает
 * collectStartupIssues + process.exit(1), чтобы отказ был мгновенным и понятным.
 */
export function assertStartupConfig(env: NodeJS.ProcessEnv = process.env): void {
  const issues = collectStartupIssues(env)
  if (issues.length > 0) throw new Error(formatStartupFailure(issues))
}

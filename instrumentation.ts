// instrumentation.ts — точки входа Next.js: Sentry-инициализация и отчёт
// о необработанных серверных ошибках.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Отказ стартовать без AUTH_SECRET — до Sentry и до первого запроса.
    //
    // На фазе сборки не проверяем: `next build` в Docker/CI идёт без .env,
    // а образ без секретов собрать должно быть можно (секрет задаётся в рантайме).
    // Рантайм-фазы Next: phase-development-server / phase-production-server.
    const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build"
    if (!isBuildPhase) {
      const { collectStartupIssues, formatStartupFailure } = await import(
        "./lib/auth/startup"
      )
      const issues = collectStartupIssues()
      if (issues.length > 0) {
        console.error(formatStartupFailure(issues))
        process.exit(1)
      }
    }

    await import("./sentry.server.config")
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config")
  }
}

/**
 * Вызывается Next.js для любой необработанной ошибки серверного рендера
 * или API-роута. Единая точка — не нужно добавлять Sentry в каждый catch.
 * Без SENTRY_DSN captureException просто логирует ошибку в консоль.
 */
export async function onRequestError(
  error: unknown,
  request: { path?: string; method?: string },
  context?: Record<string, unknown>,
) {
  const { captureException } = await import("./lib/sentry")
  captureException(error, {
    path: request?.path,
    method: request?.method,
    ...(context || {}),
  })
}

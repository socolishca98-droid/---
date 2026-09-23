// instrumentation.ts — точки входа Next.js: Sentry-инициализация и отчёт
// о необработанных серверных ошибках.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
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

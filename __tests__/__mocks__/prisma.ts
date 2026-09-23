// __tests__/__mocks__/prisma.ts
//
// Заглушка Prisma-клиента для unit-тестов (vitest.config.ts подменяет ею
// "@/lib/prisma"). Причины:
//   * тесты чистых функций не должны требовать `prisma generate` и базу данных —
//     их можно гонять где угодно, в том числе в CI до создания БД;
//   * любой случайный запрос к БД в unit-тесте должен падать громко, а не
//     молча ходить в dev.db разработчика.
//
// Тесты, которым нужна настоящая база, живут в scripts/verify-*.mjs и
// запускаются против живого сервера.

const MODEL_HANDLER: ProxyHandler<Record<string, unknown>> = {
  get(_target, property) {
    throw new Error(
      `prisma.${String(property)} вызван в unit-тесте. ` +
        "Unit-тесты работают без базы данных; для проверок с БД используйте scripts/verify-*.mjs",
    )
  },
}

function makeModelProxy(): unknown {
  return new Proxy({}, MODEL_HANDLER)
}

export const prisma = new Proxy(
  {},
  {
    get(_target, property) {
      if (property === "$disconnect" || property === "$connect") {
        return async () => undefined
      }
      return makeModelProxy()
    },
  },
)

export default prisma

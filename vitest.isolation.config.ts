// vitest.isolation.config.ts
//
// Отдельный прогон функциональных тестов изоляции данных по организациям
// (__tests__/isolation/**). Отличие от vitest.config.ts: "@/lib/prisma"
// подменяется не «громкой» заглушкой, а in-memory клиентом
// (__tests__/__mocks__/prisma-memory.ts), чтобы настоящие API-роуты можно
// было вызвать как есть и проверить, что они возвращают и меняют данные
// только своей организации.
//
// Запуск: npm run test:isolation

import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["__tests__/isolation/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", ".next", "dist", ".test-build", "tests"],
    // Тесты делят одну in-memory базу: параллельные воркеры смешали бы данные
    fileParallelism: false,
  },
  resolve: {
    alias: [
      {
        find: /^@\/lib\/prisma$/,
        replacement: path.resolve(__dirname, "__tests__/__mocks__/prisma-memory.ts"),
      },
      {
        find: /^server-only$/,
        replacement: path.resolve(__dirname, "__tests__/__mocks__/server-only.ts"),
      },
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, "./") + "/$1" },
    ],
  },
})

import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // В проекте три набора тестов:
    //   tests/*.test.mjs        — node:test (npm run test:unit, нужен npm run test:build)
    //   __tests__/**            — vitest (npm run test:vitest)
    //   __tests__/isolation/**  — витрина изоляции организаций, отдельный конфиг
    //                             (npm run test:isolation): там "@/lib/prisma"
    //                             подменён in-memory клиентом, а не заглушкой
    include: ["__tests__/**/*.{test,spec}.{ts,tsx,js,mjs}"],
    exclude: [
      "node_modules",
      ".next",
      "dist",
      ".test-build",
      "tests",
      "__tests__/isolation/**",
    ],
  },
  resolve: {
    alias: [
      // unit-тесты идут с заглушкой Prisma-клиента: не нужен prisma generate и dev.db
      {
        find: /^@\/lib\/prisma$/,
        replacement: path.resolve(__dirname, "__tests__/__mocks__/prisma.ts"),
      },
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, "./") + "/$1" },
    ],
  },
})

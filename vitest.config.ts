import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // В проекте два набора тестов:
    //   tests/*.test.mjs  — node:test (npm run test:unit, нужен npm run test:build)
    //   __tests__/**      — vitest (npm run test:vitest)
    // vitest берёт только свой каталог, чтобы не подхватывать node:test-набор.
    include: ["__tests__/**/*.{test,spec}.{ts,tsx,js,mjs}"],
    exclude: ["node_modules", ".next", "dist", ".test-build", "tests"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
})

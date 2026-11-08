// __tests__/isolation/setup.ts
//
// setupFiles для vitest.isolation.config.ts: единая точка сброса состояния
// между тестами изоляции.
//   * in-memory база (заглушка Prisma) — каждый тест начинает с чистого
//     мира; свой набор данных тесты садят сами (helpers.seedWorld);
//   * память геокодера в процессе — иначе координаты, найденные одним
//     тестом, отдавались бы другим как memory-hit без единого запроса.

import { beforeEach } from "vitest"

import { memoryDb } from "../__mocks__/prisma-memory"
import { resetGeocodeMemoryForTests } from "@/lib/geo/geocode"

beforeEach(() => {
  memoryDb.reset()
  resetGeocodeMemoryForTests()
})

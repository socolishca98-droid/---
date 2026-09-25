/**
 * Тесты клиентского кеша запросов (lib/client-cache-core.ts).
 *
 * Зачем: кеш экономит запросы, но если он «залипает», пользователь видит
 * устаревшие суммы и списки. Здесь проверяем правила, на которых он держится:
 * свежие данные не перезапрашиваются, параллельные вызовы склеиваются,
 * ошибка не кешируется, а после изменений кеш сбрасывается по префиксу.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  fetchJsonCached,
  invalidateCache,
  isFresh,
  peekCache,
  writeCache,
} = require("../.test-build/lib/client-cache-core.js")

/** Подменяет глобальный fetch на время теста и считает вызовы. */
function stubFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push(String(url))
    return handler(String(url), init)
  }
  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

test("положили и прочитали: данные возвращаются из кеша", () => {
  invalidateCache()
  writeCache("/api/test/one", { success: true, value: 1 })

  assert.deepEqual(peekCache("/api/test/one").data, { success: true, value: 1 })
  assert.equal(isFresh("/api/test/one", 60_000), true)
  assert.equal(peekCache("/api/test/missing"), null)
})

test("свежие данные не перезапрашиваются", async () => {
  invalidateCache()
  const stub = stubFetch(async () => jsonResponse({ success: true, value: 7 }))
  try {
    const first = await fetchJsonCached("/api/test/fresh", { ttlMs: 60_000 })
    const second = await fetchJsonCached("/api/test/fresh", { ttlMs: 60_000 })

    assert.equal(first.value, 7)
    assert.equal(second.value, 7)
    assert.equal(stub.calls.length, 1, "второй запрос должен взяться из кеша")
  } finally {
    stub.restore()
  }
})

test("просроченные данные обновляются, старые остаются до ответа", async () => {
  invalidateCache()
  let counter = 0
  const stub = stubFetch(async () => jsonResponse({ success: true, value: ++counter }))
  try {
    writeCache("/api/test/ttl", { success: true, value: 0 })
    const fresh = await fetchJsonCached("/api/test/ttl", { ttlMs: 0 })

    assert.equal(fresh.value, 1, "ttl 0 — идём в сеть")
    assert.equal(peekCache("/api/test/ttl").data.value, 1)
  } finally {
    stub.restore()
  }
})

test("параллельные запросы одного адреса склеиваются в один", async () => {
  invalidateCache()
  const stub = stubFetch(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
    return jsonResponse({ success: true, value: "shared" })
  })
  try {
    const [a, b, c] = await Promise.all([
      fetchJsonCached("/api/test/parallel"),
      fetchJsonCached("/api/test/parallel"),
      fetchJsonCached("/api/test/parallel"),
    ])

    assert.equal(a.value, "shared")
    assert.equal(b.value, "shared")
    assert.equal(c.value, "shared")
    assert.equal(stub.calls.length, 1, "три вызова — один запрос в сеть")
  } finally {
    stub.restore()
  }
})

test("ошибка не кешируется, а прежние данные остаются", async () => {
  invalidateCache()
  writeCache("/api/test/error", { success: true, value: "старое" })

  const failing = stubFetch(async () => jsonResponse({ success: false, error: "Сбой" }, 500))
  try {
    await assert.rejects(
      () => fetchJsonCached("/api/test/error", { force: true }),
      /Сбой/,
    )
  } finally {
    failing.restore()
  }

  assert.equal(
    peekCache("/api/test/error").data.value,
    "старое",
    "последнее известное состояние не должно пропадать",
  )

  const recovered = stubFetch(async () => jsonResponse({ success: true, value: "новое" }))
  try {
    const data = await fetchJsonCached("/api/test/error", { force: true })
    assert.equal(data.value, "новое")
  } finally {
    recovered.restore()
  }
})

test("сброс по префиксу чистит только свои адреса", () => {
  invalidateCache()
  writeCache("/api/clients?limit=500", { success: true })
  writeCache("/api/fleet", { success: true })
  writeCache("/api/payments?tab=pending", { success: true })

  invalidateCache("/api/clients")

  assert.equal(peekCache("/api/clients?limit=500"), null)
  assert.notEqual(peekCache("/api/fleet"), null)
  assert.notEqual(peekCache("/api/payments?tab=pending"), null)

  invalidateCache()
  assert.equal(peekCache("/api/fleet"), null)
})

test("force игнорирует свежий кеш", async () => {
  invalidateCache()
  writeCache("/api/test/force", { success: true, value: "кеш" })
  const stub = stubFetch(async () => jsonResponse({ success: true, value: "сеть" }))
  try {
    const data = await fetchJsonCached("/api/test/force", { force: true })
    assert.equal(data.value, "сеть")
    assert.equal(stub.calls.length, 1)
  } finally {
    stub.restore()
  }
})

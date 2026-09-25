/**
 * Тесты подписанных сессионных токенов (JWT-подобный формат, HMAC-SHA256 на Web Crypto).
 * Запуск: npm test
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

const SECRET = "test-secret-0123456789abcdefghijklmnopqrstuvwxyz"
process.env.AUTH_SECRET = SECRET

const {
  signSessionToken,
  verifySessionToken,
  buildTokenPayload,
  getAuthSecret,
  AuthSecretError,
} = require("../.test-build/lib/auth/token.js")

function payload(overrides = {}) {
  return buildTokenPayload({
    userId: "user_1",
    role: "logist",
    kind: "staff",
    sessionId: "ses_abc",
    name: "Иван Петров",
    ttlMs: 60 * 60 * 1000,
    ...overrides,
  })
}

test("подписанный токен проходит проверку и сохраняет payload", async () => {
  const original = payload()
  const token = await signSessionToken(original, SECRET)

  assert.equal(token.split(".").length, 3, "формат header.payload.signature")

  const decoded = await verifySessionToken(token, SECRET)
  assert.ok(decoded)
  assert.equal(decoded.sub, "user_1")
  assert.equal(decoded.role, "logist")
  assert.equal(decoded.kind, "staff")
  assert.equal(decoded.jti, "ses_abc")
  assert.equal(decoded.name, "Иван Петров")
})

test("токен водителя содержит driverId", async () => {
  const token = await signSessionToken(
    payload({ role: "driver", kind: "driver", driverId: "driver_7" }),
    SECRET,
  )
  const decoded = await verifySessionToken(token, SECRET)
  assert.equal(decoded.role, "driver")
  assert.equal(decoded.kind, "driver")
  assert.equal(decoded.driverId, "driver_7")
})

test("подделка payload не проходит", async () => {
  const token = await signSessionToken(payload(), SECRET)
  const [header, , signature] = token.split(".")

  const forgedPayload = Buffer.from(
    JSON.stringify({ ...payload(), sub: "admin_1", role: "admin" }),
    "utf8",
  ).toString("base64url")

  assert.equal(await verifySessionToken(`${header}.${forgedPayload}.${signature}`, SECRET), null)
})

test("подделка подписи не проходит", async () => {
  const token = await signSessionToken(payload(), SECRET)
  const [header, body] = token.split(".")
  const fakeSignature = Buffer.from("x".repeat(32), "utf8").toString("base64url")
  assert.equal(await verifySessionToken(`${header}.${body}.${fakeSignature}`, SECRET), null)
})

test("токен с чужим секретом не проходит", async () => {
  const token = await signSessionToken(payload(), SECRET)
  assert.equal(await verifySessionToken(token, "другой-секрет-0123456789abcdefghij"), null)
})

test("просроченный токен не проходит", async () => {
  const expired = buildTokenPayload({
    userId: "user_1",
    role: "logist",
    kind: "staff",
    sessionId: "ses_old",
    ttlMs: -1000,
  })
  const token = await signSessionToken(expired, SECRET)
  assert.equal(await verifySessionToken(token, SECRET), null)
})

test("токен из будущего не проходит (сдвиг часов)", async () => {
  const future = { ...payload(), iat: Math.floor(Date.now() / 1000) + 3600 }
  const token = await signSessionToken(future, SECRET)
  assert.equal(await verifySessionToken(token, SECRET), null)
})

test("мусор вместо токена не роняет проверку", async () => {
  assert.equal(await verifySessionToken("", SECRET), null)
  assert.equal(await verifySessionToken(undefined, SECRET), null)
  assert.equal(await verifySessionToken(null, SECRET), null)
  assert.equal(await verifySessionToken("abc", SECRET), null)
  assert.equal(await verifySessionToken("a.b", SECRET), null)
  assert.equal(await verifySessionToken("a.b.c", SECRET), null)
  assert.equal(await verifySessionToken("!!!.@@@.###", SECRET), null)
  assert.equal(await verifySessionToken("{}".repeat(100), SECRET), null)
})

test("payload без обязательных полей отклоняется", async () => {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }), "utf8").toString(
    "base64url",
  )
  const body = Buffer.from(JSON.stringify({ sub: "user_1" }), "utf8").toString("base64url")
  const token = await signSessionToken(payload(), SECRET)
  const signature = token.split(".")[2]

  assert.equal(await verifySessionToken(`${header}.${body}.${signature}`, SECRET), null)
})

test("другой алгоритм в заголовке отклоняется", async () => {
  const token = await signSessionToken(payload(), SECRET)
  const [, body, signature] = token.split(".")
  const noneHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }), "utf8").toString(
    "base64url",
  )
  assert.equal(await verifySessionToken(`${noneHeader}.${body}.${signature}`, SECRET), null)
})

test("AUTH_SECRET обязателен и достаточно длинный", () => {
  assert.equal(getAuthSecret(), SECRET)

  const saved = process.env.AUTH_SECRET
  try {
    process.env.AUTH_SECRET = ""
    assert.throws(() => getAuthSecret(), AuthSecretError)

    process.env.AUTH_SECRET = "короткий"
    assert.throws(() => getAuthSecret(), AuthSecretError)

    delete process.env.AUTH_SECRET
    assert.throws(() => getAuthSecret(), AuthSecretError)
  } finally {
    process.env.AUTH_SECRET = saved
  }
})

test("exp соответствует заданному TTL", async () => {
  const before = Math.floor(Date.now() / 1000)
  const p = buildTokenPayload({
    userId: "u",
    role: "logist",
    kind: "staff",
    sessionId: "s",
    ttlMs: 12 * 60 * 60 * 1000,
  })
  assert.ok(p.exp - p.iat === 12 * 60 * 60)
  assert.ok(p.iat >= before)
})

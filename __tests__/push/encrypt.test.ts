// __tests__/push/encrypt.test.ts
//
// Шифрование payload пуша (RFC 8188/8291). Проверяем round-trip: то, что
// написали, должно читаться обратно теми же примитивами — иначе браузер
// получит мусор вместо уведомления, а «пуши работают» будет проверять
// невозможно.

import { createECDH, randomBytes } from "node:crypto"
import { describe, expect, it } from "vitest"

import { decryptPushPayload, encryptPushPayload } from "@/lib/push/encrypt"
import { fromBase64Url, toBase64Url } from "@/lib/push/vapid"

/** Пара ключей «браузера» — как будто её выдал pushManager.subscribe(). */
function browserKeys() {
  const ecdh = createECDH("prime256v1")
  ecdh.generateKeys()
  return {
    ecdh,
    publicKey: toBase64Url(ecdh.getPublicKey()),
    auth: toBase64Url(randomBytes(16)),
    privateKey: ecdh.getPrivateKey(),
  }
}

describe("encryptPushPayload", () => {
  it("round-trip: сообщение читается обратно", () => {
    const browser = browserKeys()
    const server = createECDH("prime256v1")
    server.generateKeys()

    const text = JSON.stringify({ title: "Назначен рейс", body: "Рейс «Москва — Тула»" })
    const encrypted = encryptPushPayload({
      payload: text,
      clientPublicKey: browser.publicKey,
      clientAuth: browser.auth,
      ephemeralKeyPair: server,
    })

    expect(encrypted.encoding).toBe("aes128gcm")
    // Тело = соль(16) + публичный ключ(65) + шифротекст(payload + разделитель + тег 16)
    expect(encrypted.body.length).toBe(16 + 65 + Buffer.byteLength(text) + 1 + 16)

    const decrypted = decryptPushPayload(
      encrypted.body,
      browser.auth,
      browser.publicKey,
      server.getPrivateKey(),
    )
    expect(decrypted.toString("utf8")).toBe(text)
  })

  it("шифротекст не содержит исходный текст", () => {
    const browser = browserKeys()
    const server = createECDH("prime256v1")
    server.generateKeys()

    const text = "секретное сообщение"
    const encrypted = encryptPushPayload({
      payload: text,
      clientPublicKey: browser.publicKey,
      clientAuth: browser.auth,
      ephemeralKeyPair: server,
    })

    expect(encrypted.body.toString("utf8")).not.toContain(text)
    expect(encrypted.body.toString("latin1")).not.toContain(text)
  })

  it("разная соль — разный шифротекст для одного текста", () => {
    const browser = browserKeys()
    const server = createECDH("prime256v1")
    server.generateKeys()

    const encrypt = (salt: Buffer) =>
      encryptPushPayload({
        payload: "один и тот же текст",
        clientPublicKey: browser.publicKey,
        clientAuth: browser.auth,
        salt,
        ephemeralKeyPair: server,
      }).body.toString("base64")

    expect(encrypt(randomBytes(16))).not.toBe(encrypt(randomBytes(16)))
  })

  it("чужой секрет аутентификации не расшифровывает сообщение", () => {
    const browser = browserKeys()
    const server = createECDH("prime256v1")
    server.generateKeys()

    const encrypted = encryptPushPayload({
      payload: "только для браузера",
      clientPublicKey: browser.publicKey,
      clientAuth: browser.auth,
      ephemeralKeyPair: server,
    })

    const wrongAuth = toBase64Url(randomBytes(16))
    expect(() =>
      decryptPushPayload(encrypted.body, wrongAuth, browser.publicKey, server.getPrivateKey()),
    ).toThrow()
  })

  it("битые ключи подписки — понятная ошибка, а не молчаливый мусор", () => {
    const browser = browserKeys()
    const server = createECDH("prime256v1")
    server.generateKeys()

    const shortKey = toBase64Url(Buffer.alloc(10))
    expect(() =>
      encryptPushPayload({
        payload: "текст",
        clientPublicKey: shortKey,
        clientAuth: browser.auth,
        ephemeralKeyPair: server,
      }),
    ).toThrow(/P-256/)

    expect(() =>
      encryptPushPayload({
        payload: "текст",
        clientPublicKey: browser.publicKey,
        clientAuth: toBase64Url(Buffer.alloc(8)),
        ephemeralKeyPair: server,
      }),
    ).toThrow(/16 байт/)
  })

  it("unicode в уведомлении не ломает шифрование", () => {
    const browser = browserKeys()
    const server = createECDH("prime256v1")
    server.generateKeys()

    const text = JSON.stringify({ title: "Погрузка", body: "Водитель: Иванов И. ✓ 🚚" })
    const encrypted = encryptPushPayload({
      payload: text,
      clientPublicKey: browser.publicKey,
      clientAuth: browser.auth,
      ephemeralKeyPair: server,
    })
    const decrypted = decryptPushPayload(
      encrypted.body,
      browser.auth,
      browser.publicKey,
      server.getPrivateKey(),
    )
    expect(decrypted.toString("utf8")).toBe(text)
  })

  it("base64url преобразования обратны друг другу", () => {
    const bytes = randomBytes(32)
    expect(Array.from(fromBase64Url(toBase64Url(bytes)))).toEqual(Array.from(bytes))
    // base64url не содержит символов, недопустимых в URL и в заголовках
    expect(toBase64Url(bytes)).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

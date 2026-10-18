// __tests__/push/vapid.test.ts
//
// VAPID: подпись запроса к push-сервису. Здесь важно не «красивое», а
// corrispondenza стандарту: браузерные push-сервисы молча отвергают запросы
// с неправильным audience или без контакта отправителя.

import { describe, expect, it } from "vitest"

import {
  buildVapidHeaders,
  fromBase64Url,
  hasVapidKeys,
  toBase64Url,
  vapidAudience,
} from "@/lib/push/vapid"

const signer = (input: string) => `signed(${input.length})`

const base = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  subject: "mailto:admin@loginex.local",
  publicKey: "PUBLIC_KEY",
  privateKey: "PRIVATE_KEY",
  sign: signer,
  now: new Date("2026-10-13T10:00:00.000Z"),
}

describe("vapidAudience", () => {
  it("оставляет только origin адреса сервиса", () => {
    expect(vapidAudience("https://fcm.googleapis.com/fcm/send/abc")).toBe(
      "https://fcm.googleapis.com",
    )
    expect(vapidAudience("https://updates.push.services.mozilla.com/wpush/v2/xyz")).toBe(
      "https://updates.push.services.mozilla.com",
    )
  })

  it("мусорный адрес — ошибка", () => {
    expect(() => vapidAudience("не адрес")).toThrow(/Некорректный/)
  })
})

describe("buildVapidHeaders", () => {
  it("собирает JWT с audience, сроком и контактом", () => {
    const headers = buildVapidHeaders(base)
    const token = headers.Authorization.replace("vapid t=", "").split(",")[0]

    const [headerB64, payloadB64] = token.split(".")
    const header = JSON.parse(Buffer.from(fromBase64Url(headerB64)).toString("utf8"))
    const payload = JSON.parse(Buffer.from(fromBase64Url(payloadB64)).toString("utf8"))

    expect(header).toEqual({ typ: "JWT", alg: "ES256" })
    expect(payload.aud).toBe("https://fcm.googleapis.com")
    expect(payload.sub).toBe("mailto:admin@loginex.local")
    // Сутки по умолчанию — иначе длинные очереди пуша отвергаются
    expect(payload.exp - Math.floor(base.now.getTime() / 1000)).toBe(12 * 60 * 60)
  })

  it("подпись считается по строке «header.payload»", () => {
    const headers = buildVapidHeaders(base)
    const [tokenPart, keyPart] = headers.Authorization.replace("vapid ", "").split(", ")
    const [headerB64, payloadB64] = tokenPart.replace("t=", "").split(".")

    expect(tokenPart).toBe(`t=${headerB64}.${payloadB64}.signed(${headerB64.length + payloadB64.length + 1})`)
    expect(keyPart).toBe("k=PUBLIC_KEY")
    expect(headers["Crypto-Key"]).toBe("p256ecdsa=PUBLIC_KEY")
  })

  it("контакт без mailto: получает префикс", () => {
    const headers = buildVapidHeaders({ ...base, subject: "admin@loginex.local" })
    const payloadB64 = headers.Authorization.split(".")[1]
    const payload = JSON.parse(Buffer.from(fromBase64Url(payloadB64)).toString("utf8"))
    expect(payload.sub).toBe("mailto:admin@loginex.local")
  })

  it("https-контакт остаётся как есть", () => {
    const headers = buildVapidHeaders({ ...base, subject: "https://loginex.local" })
    const payloadB64 = headers.Authorization.split(".")[1]
    const payload = JSON.parse(Buffer.from(fromBase64Url(payloadB64)).toString("utf8"))
    expect(payload.sub).toBe("https://loginex.local")
  })

  it("срок жизни переопределяется", () => {
    const headers = buildVapidHeaders({ ...base, expirationMinutes: 5 })
    const payloadB64 = headers.Authorization.split(".")[1]
    const payload = JSON.parse(Buffer.from(fromBase64Url(payloadB64)).toString("utf8"))
    expect(payload.exp - Math.floor(base.now.getTime() / 1000)).toBe(300)
  })

  it("без ключей и без подписи — отказ, а не запрос-невидимка", () => {
    expect(() => buildVapidHeaders({ ...base, publicKey: "" })).toThrow(/VAPID-ключи/)
    expect(() => buildVapidHeaders({ ...base, privateKey: "" })).toThrow(/VAPID-ключи/)
    expect(() => buildVapidHeaders({ ...base, endpoint: "" })).toThrow(/адрес push-сервиса/)
    expect(() => buildVapidHeaders({ ...base, sign: () => "" })).toThrow(/подпись/)
  })
})

describe("hasVapidKeys", () => {
  it("ключи считаются настроенными только парами", () => {
    expect(hasVapidKeys({ VAPID_PUBLIC_KEY: "a", VAPID_PRIVATE_KEY: "b" })).toBe(true)
    expect(hasVapidKeys({ VAPID_PUBLIC_KEY: "a" })).toBe(false)
    expect(hasVapidKeys({ VAPID_PUBLIC_KEY: "  ", VAPID_PRIVATE_KEY: "b" })).toBe(false)
    expect(hasVapidKeys({})).toBe(false)
  })
})

describe("base64url", () => {
  it("не содержит символов, ломающих заголовки и URL", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255])
    const encoded = toBase64Url(bytes)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/)
    expect(Array.from(fromBase64Url(encoded))).toEqual(Array.from(bytes))
  })
})

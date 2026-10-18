// __tests__/push/keys.test.ts
//
// VAPID-ключи: перевод форматов и подпись. Здесь легко получить «пуши молча
// не доходят» — сервис отвечает 401, а причина в том, что подпись в DER,
// а не в r||s. Проверяем разбор, подпись и генерацию на настоящих ключах.

import { createECDH, createPublicKey, sign, verify } from "node:crypto"
import { describe, expect, it } from "vitest"

import {
  createVapidSigner,
  derSignatureToRaw,
  generateVapidKeyPair,
  rawSignatureToDer,
  vapidJwk,
} from "@/lib/push/keys"
import { fromBase64Url, toBase64Url } from "@/lib/push/vapid"

function freshPair() {
  return generateVapidKeyPair()
}

describe("vapidJwk", () => {
  it("разбирает публичный ключ в x и y", () => {
    const pair = freshPair()
    const jwk = vapidJwk(pair)

    expect(jwk.kty).toBe("EC")
    expect(jwk.crv).toBe("P-256")
    expect(String(jwk.d)).toBe(pair.privateKey)
    // x и y — это ровно те байты, что были после 0x04 в публичном ключе
    const publicBytes = fromBase64Url(pair.publicKey)
    expect(fromBase64Url(String(jwk.x))).toEqual(publicBytes.subarray(1, 33))
    expect(fromBase64Url(String(jwk.y))).toEqual(publicBytes.subarray(33, 65))
  })

  it("мусорный публичный ключ — ошибка", () => {
    expect(() => vapidJwk({ publicKey: toBase64Url(Buffer.alloc(10)), privateKey: "d" })).toThrow(
      /P-256/,
    )
  })
})

describe("der ↔ raw", () => {
  it("преобразования обратны друг другу", () => {
    const raw = Buffer.concat([Buffer.alloc(31, 7), Buffer.from([0xff]), Buffer.alloc(32, 3)])
    expect(Array.from(derSignatureToRaw(rawSignatureToDer(raw)))).toEqual(Array.from(raw))
  })

  it("держит ведущий ноль DER-целого", () => {
    // Число со старшим битом: DER добавляет 0x00, raw должен остаться 32 байта
    const r = Buffer.concat([Buffer.from([0x80]), Buffer.alloc(31, 1)])
    const s = Buffer.alloc(32, 2)
    const der = rawSignatureToDer(Buffer.concat([r, s]))
    expect(der[4]).toBe(0x00) // ведущий ноль на месте
    expect(Array.from(derSignatureToRaw(der))).toEqual(Array.from(Buffer.concat([r, s])))
  })
})

describe("createVapidSigner", () => {
  it("подпись сходится с публичным ключом", () => {
    const pair = freshPair()
    const signer = createVapidSigner(pair)
    const input = "header.payload"

    const signature = signer(input)
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(fromBase64Url(signature)).toHaveLength(64) // r||s

    const publicKey = createPublicKey({ key: vapidJwk(pair), format: "jwk" })
    const der = rawSignatureToDer(Buffer.from(fromBase64Url(signature)))
    expect(verify(null, Buffer.from(input, "utf8"), publicKey, der)).toBe(true)
  })

  it("подпись разная для разного текста", () => {
    const signer = createVapidSigner(freshPair())
    expect(signer("первый")).not.toBe(signer("второй"))
  })

  it("рассогласованные ключи — отказ сразу", () => {
    const pair = freshPair()
    // Приватный ключ от другой пары: подпись не сойдётся с публичным
    const other = freshPair()
    expect(() => createVapidSigner({ publicKey: pair.publicKey, privateKey: other.privateKey })).toThrow(
      /не согласованы/,
    )
  })
})

describe("generateVapidKeyPair", () => {
  it("выдаёт рабочую пару base64url без паддинга", () => {
    const pair = freshPair()
    // 65 байт (0x04 + X + Y) → 87 символов base64url без паддинга
    expect(pair.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/)
    expect(pair.privateKey).toMatch(/^[A-Za-z0-9_-]{43}$/) // 32 байта
    expect(pair.publicKey).not.toContain("=")
  })

  it("каждый раз — новые ключи", () => {
    expect(freshPair().publicKey).not.toBe(freshPair().publicKey)
  })
})

describe("подпись ключами браузера (для сравнения)", () => {
  it("ECDH-пара браузера тоже даёт точку P-256", () => {
    const ecdh = createECDH("prime256v1")
    ecdh.generateKeys()
    const point = ecdh.getPublicKey()
    expect(point[0]).toBe(0x04)
    expect(point).toHaveLength(65)
  })
})

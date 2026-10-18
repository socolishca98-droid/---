// lib/push/keys.ts
//
// VAPID-ключи: разбор, подпись, генерация.
//
// Зачем отдельно: приватный ключ VAPID — это 32 байта «сырой» кривой P-256,
// а Node для ES256 просит JWK. Перевод между форматами (и обратно DER → r||s,
// как требует JWS) — ровно то место, где легко получить «подпись неверна» без
// внятной причины. Здесь это делается один раз и проверяется тестом.

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type JsonWebKey as NodeJsonWebKey,
} from "node:crypto"

import { fromBase64Url, toBase64Url } from "./vapid"

export type VapidKeyPair = {
  /** base64url — уходит браузеру при подписке. */
  publicKey: string
  /** base64url — только на сервере, в окружении. */
  privateKey: string
}

/** JWK для P-256 из пары VAPID-ключей (публичный задаёт x и y). */
export function vapidJwk(pair: VapidKeyPair): NodeJsonWebKey {
  const publicBytes = fromBase64Url(pair.publicKey)
  if (publicBytes.length !== 65 || publicBytes[0] !== 0x04) {
    throw new Error("Публичный VAPID-ключ должен быть точкой P-256 в uncompressed form")
  }
  return {
    kty: "EC",
    crv: "P-256",
    x: toBase64Url(publicBytes.subarray(1, 33)),
    y: toBase64Url(publicBytes.subarray(33, 65)),
    d: pair.privateKey,
    ext: true,
  }
}

/**
 * DER-подпись ECDSA → r||s (64 байта), как требует JWS.
 * Node отдаёт DER (0x30 … 0x02 r … 0x02 s), а JWT ждёт плоскую запись.
 */
export function derSignatureToRaw(der: Buffer): Buffer {
  let offset = 0
  if (der[offset++] !== 0x30) throw new Error("Ожидалась DER-последовательность")
  const sequenceLength = der[offset++]

  const readInteger = (): Buffer => {
    if (der[offset++] !== 0x02) throw new Error("Ожидалось DER-целое")
    const length = der[offset++]
    const value = der.subarray(offset, offset + length)
    offset += length
    return value
  }

  const r = readInteger()
  const s = readInteger()
  void sequenceLength

  // DER мог оставить ведущий ноль (знаковый байт) — убираем, затем добиваем до 32
  const normalize = (value: Buffer) => {
    const trimmed = value[0] === 0 ? value.subarray(1) : value
    if (trimmed.length > 32) throw new Error("Компонент подписи длиннее 32 байт")
    return Buffer.concat([Buffer.alloc(32 - trimmed.length), trimmed])
  }

  return Buffer.concat([normalize(r), normalize(s)])
}

/**
 * Обратное преобразование: r||s (64 байта) → DER, как ждёт Node.
 * Нужно, чтобы проверить подпись публичным ключом.
 */
export function rawSignatureToDer(raw: Buffer): Buffer {
  if (raw.length !== 64) throw new Error("Подпись ES256 должна быть 64 байта (r||s)")
  const encodeInteger = (part: Buffer) => {
    // DER-целое знаковое: ведущий ноль, если старший бит установлен
    const needsPad = part[0] & 0x80
    const body = needsPad ? Buffer.concat([Buffer.from([0]), part]) : part
    return Buffer.concat([Buffer.from([0x02, body.length]), body])
  }
  const content = Buffer.concat([
    encodeInteger(raw.subarray(0, 32)),
    encodeInteger(raw.subarray(32, 64)),
  ])
  return Buffer.concat([Buffer.from([0x30, content.length]), content])
}

/**
 * Подписывающая функция для buildVapidHeaders.
 * Проверяет саму себя: если подпись не сходится с публичным ключом, лучше
 * упасть сразу, чем молча слать невалидные пуши.
 */
export function createVapidSigner(pair: VapidKeyPair): (input: string) => string {
  const jwk = vapidJwk(pair)
  const privateKey = createPrivateKey({ key: jwk, format: "jwk" })
  const publicKey = createPublicKey({ key: jwk, format: "jwk" })

  const signer = (input: string) => {
    const der = sign(null, Buffer.from(input, "utf8"), privateKey)
    return toBase64Url(derSignatureToRaw(der))
  }

  // Самопроверка: подпись короткой строки должна сходиться с публичным ключом
  const probe = signer("vapid-self-check")
  const valid = verify(
    null,
    Buffer.from("vapid-self-check", "utf8"),
    publicKey,
    rawSignatureToDer(Buffer.from(fromBase64Url(probe))),
  )
  if (!valid) {
    throw new Error("VAPID-ключи не согласованы: подпись не сходится с публичным ключом")
  }

  return signer
}

/**
 * Новая пара VAPID-ключов. Нужна один раз при настройке push; в проде ключи
 * задаются в переменных окружения, а не генерируются на каждом запуске.
 */
export function generateVapidKeyPair(): VapidKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })

  const jwkPrivate = privateKey.export({ format: "jwk" }) as NodeJsonWebKey
  const jwkPublic = publicKey.export({ format: "jwk" }) as NodeJsonWebKey

  const point = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(fromBase64Url(String(jwkPublic.x))),
    Buffer.from(fromBase64Url(String(jwkPublic.y))),
  ])

  return {
    publicKey: toBase64Url(point),
    privateKey: String(jwkPrivate.d),
  }
}

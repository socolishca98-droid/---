// lib/push/encrypt.ts
//
// Шифрование payload для Web Push (RFC 8188 «aes128gcm» + RFC 8291).
//
// Зачем: push-сервис доставляет сообщение, но не имеет права его прочитать —
// содержимое шифруется на нашем сервере ключом браузера. Без этого шага пуши
// получаются «пустыми»: браузер показывает только заголовок, который пришёл
// незашифрованным, то есть вообще ничего осмысленного.
//
// Схема (упрощённо):
//   1. общий секрет = ECDH(наш эфемерный ключ, публичный ключ браузера);
//   2. ключ и nonce выводятся через HKDF из общего секрета, секрета
//      аутентификации браузера и соли;
//   3. payload шифруется AES-128-GCM, а перед ним идёт разделитель 0x02 —
//      после него допускается дописывать данные, поэтому padding обязателен.
//
// Тело запроса = salt(16) || наш публичный ключ(65) || шифротекст.

import { createCipheriv, createDecipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto"
import type { ECDH } from "node:crypto"

import { fromBase64Url, toBase64Url } from "./vapid"

/** Имя кодировки содержимого — оно же подпись в AAD и в derive. */
const CONTENT_ENCODING = "aes128gcm"

/** Разделитель последнего «записи» в payload (RFC 8188). */
const RECORD_DELIMITER = 0x02

/** Соль по умолчанию — 16 случайных байт (на неё тратится ровно столько). */
const SALT_BYTES = 16

/**
 * HKDF-SHA256. Обёртка, чтобы не таскать пять аргументов по коду.
 */
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  return Buffer.from(hkdfSync("sha256", ikm, salt, info, length))
}

export type EncryptedPush = {
  /** Что уходит в теле POST-запроса. */
  body: Buffer
  /** Соль в base64url — для отладки и тестов. */
  salt: string
  /** Наш эфемерный публичный ключ (первые 65 байт тела) в base64url. */
  publicKey: string
  /** Content-Encoding для заголовка запроса. */
  encoding: typeof CONTENT_ENCODING
}

export type EncryptParams = {
  /** Текст уведомления (JSON) — его и шифруем. */
  payload: string | Uint8Array
  /** Публичный ключ браузера (p256dh подписки) в base64url. */
  clientPublicKey: string
  /** Секрет аутентификации браузера (auth подписки) в base64url. */
  clientAuth: string
  /** Своя соль — для тестов; иначе случайная. */
  salt?: Buffer
  /**
   * Готовая эфемерная пара — для тестов: иначе приватный ключ теряется внутри
   * функции и расшифровать результат нечем. В рантайме не передаётся.
   */
  ephemeralKeyPair?: ECDH
}

/**
 * Шифрует payload для конкретной подписки.
 * Кидает ошибку, если ключи браузера повреждены: такой подписке не отправлять.
 */
export function encryptPushPayload(params: EncryptParams): EncryptedPush {
  const { payload, clientPublicKey, clientAuth } = params

  const plaintext = typeof payload === "string" ? Buffer.from(payload, "utf8") : Buffer.from(payload)
  const userPublicKey = Buffer.from(fromBase64Url(clientPublicKey))
  const userAuth = Buffer.from(fromBase64Url(clientAuth))

  if (userPublicKey.length !== 65 || userPublicKey[0] !== 0x04) {
    throw new Error("Публичный ключ подписки должен быть точкой P-256 в uncompressed form")
  }
  if (userAuth.length !== 16) {
    throw new Error("Секрет аутентификации подписки должен быть 16 байт")
  }

  const salt = params.salt ?? randomBytes(SALT_BYTES)

  // 1. Эфемерная пара + общий секрет
  const ecdh = params.ephemeralKeyPair ?? createECDH("prime256v1")
  if (!params.ephemeralKeyPair) ecdh.generateKeys()
  const serverPublicKey = ecdh.getPublicKey() // 65 байт, 0x04…
  const sharedSecret = ecdh.computeSecret(userPublicKey) // 32 байта

  // 2. IKM: секрет аутентификации «примешивается» к общему секрету
  const authInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "utf8"),
    userPublicKey,
    serverPublicKey,
  ])
  const prk = hkdf(
    userAuth,
    sharedSecret,
    Buffer.from(`Content-Encoding: ${CONTENT_ENCODING}\0`, "utf8"),
    32,
  )
  const ikm = hkdf(prk, Buffer.alloc(0), authInfo, 32)

  // 3. Ключ и nonce — из соли и IKM
  const contentEncodingInfo = Buffer.from(`Content-Encoding: ${CONTENT_ENCODING}\0`, "utf8")
  const key = hkdf(salt, ikm, contentEncodingInfo, 16)
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0", "utf8"), 12)

  // 4. AES-128-GCM: AAD — имя кодировки, данные — payload + разделитель
  const aad = contentEncodingInfo
  const cipher = createCipheriv("aes-128-gcm", key, nonce)
  cipher.setAAD(aad)
  // Запись обязана заканчиваться разделителем 0x02 (RFC 8188): после него
  // допускается дописывать данные. Без него браузер не примет сообщение.
  const encrypted = Buffer.concat([
    cipher.update(plaintext),
    cipher.update(Buffer.from([RECORD_DELIMITER])),
    cipher.final(),
    cipher.getAuthTag(),
  ])

  return {
    body: Buffer.concat([salt, serverPublicKey, encrypted]),
    salt: toBase64Url(salt),
    publicKey: toBase64Url(serverPublicKey),
    encoding: CONTENT_ENCODING,
  }
}

/**
 * Расшифровка — только для тестов и отладки: в рантайме расшифровывает браузер.
 * Нужна, чтобы проверять encryptPushPayload без настоящего push-сервиса:
 * если шифрование сделано не по стандарту, round-trip не сойдётся.
 */
export function decryptPushPayload(
  body: Buffer,
  clientAuth: string,
  browserPublicKeyB64u: string,
  serverPrivateKey: Buffer,
): Buffer {
  const salt = body.subarray(0, SALT_BYTES)
  const serverPublicKey = body.subarray(SALT_BYTES, SALT_BYTES + 65)
  const encrypted = body.subarray(SALT_BYTES + 65)

  const userAuth = Buffer.from(fromBase64Url(clientAuth))
  const browserPublicKey = Buffer.from(fromBase64Url(browserPublicKeyB64u))

  // Наш эфемерный приватный ключ + публичный ключ браузера → общий секрет
  const ecdh = createECDH("prime256v1")
  ecdh.setPrivateKey(serverPrivateKey)
  const sharedSecret = ecdh.computeSecret(browserPublicKey)

  const authInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "utf8"),
    browserPublicKey,
    serverPublicKey,
  ])
  const prk = hkdf(
    userAuth,
    sharedSecret,
    Buffer.from(`Content-Encoding: ${CONTENT_ENCODING}\0`, "utf8"),
    32,
  )
  const ikm = hkdf(prk, Buffer.alloc(0), authInfo, 32)
  const contentEncodingInfo = Buffer.from(`Content-Encoding: ${CONTENT_ENCODING}\0`, "utf8")
  const key = hkdf(salt, ikm, contentEncodingInfo, 16)
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0", "utf8"), 12)

  const tag = encrypted.subarray(encrypted.length - 16)
  const data = encrypted.subarray(0, encrypted.length - 16)
  const decipher = createDecipheriv("aes-128-gcm", key, nonce)
  decipher.setAAD(contentEncodingInfo)
  decipher.setAuthTag(tag)
  const padded = Buffer.concat([decipher.update(data), decipher.final()])

  // Отрезаем хвост после разделителя записи
  const delimiter = padded.lastIndexOf(RECORD_DELIMITER)
  return delimiter === -1 ? padded : padded.subarray(0, delimiter)
}

/** Соль в теле — ровно 16 байт. */
export const PUSH_SALT_BYTES = SALT_BYTES

/** Разделитель записи в payload (RFC 8188). */
export const PUSH_RECORD_DELIMITER = RECORD_DELIMITER

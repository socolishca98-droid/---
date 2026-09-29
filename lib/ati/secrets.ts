// lib/ati/secrets.ts
//
// Шифрование секретов организации (токены ATI.SU) перед сохранением в БД.
// AES-256-GCM: ключ — SHA-256 от AUTH_SECRET (тот же секрет, что подписывает
// сессии), каждый секрет получает свежие IV и тег подлинности.
//
// Формат: v1.<iv base64>.<tag base64>.<cipher base64>
//
// Токен организации — это доступ к ЕЁ аккаунту ATI: даже утечка дампа БД
// не должна отдавать чужие токены, поэтому в открытом виде они не хранятся
// и в ответах API не возвращаются никогда.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto"

const PREFIX = "v1"

function key(): Buffer {
  const secret = process.env.AUTH_SECRET || ""
  if (!secret) {
    throw new Error("AUTH_SECRET не задан: секреты ATI нельзя ни шифровать, ни расшифровать")
  }
  return createHash("sha256").update(secret).digest()
}

/** Шифрует секрет. Пустые значения не принимаются — вызывающий проверяет сам. */
export function encryptSecret(plain: string): string {
  if (!plain) throw new Error("encryptSecret: пустое значение")
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [PREFIX, iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".")
}

/** Расшифровывает секрет; мусор и подмена — null (а не исключение в проде). */
export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null
  const parts = payload.split(".")
  if (parts.length !== 4 || parts[0] !== PREFIX) return null
  try {
    const iv = Buffer.from(parts[1], "base64")
    const tag = Buffer.from(parts[2], "base64")
    const data = Buffer.from(parts[3], "base64")
    const decipher = createDecipheriv("aes-256-gcm", key(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8")
  } catch {
    return null
  }
}

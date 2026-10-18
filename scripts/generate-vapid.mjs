#!/usr/bin/env node
// scripts/generate-vapid.mjs
//
// Генерация пары VAPID-ключей для Web Push. Запуск:
//
//   npm run db:push -- ... (не нужно) → просто: npm run vapid:generate
//
// Ключи нужны один раз: публичный уходит браузеру при подписке, приватный
// подписывает запросы к push-сервису. В проде их задают в переменных
// окружения (Vercel → Settings → Environment Variables) и больше не меняют:
// смена ключа молча отписывает все устройства.
//
// Node 20 не умеет импортировать TypeScript, поэтому здесь дублируется только
// вызов generateKeyPairSync — вся остальная логика в lib/push/keys.ts.

import { generateKeyPairSync } from "node:crypto"

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })

const jwkPrivate = privateKey.export({ format: "jwk" })
const jwkPublic = publicKey.export({ format: "jwk" })

/** base64url из буфера (без паддинга). */
const toBase64Url = (buffer) =>
  Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

const point = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(jwkPublic.x, "base64url"),
  Buffer.from(jwkPublic.y, "base64url"),
])

console.log("Добавьте в .env (и в переменные окружения на проде):\n")
console.log(`VAPID_PUBLIC_KEY=${toBase64Url(point)}`)
console.log(`VAPID_PRIVATE_KEY=${jwkPrivate.d}`)
console.log(`VAPID_SUBJECT=mailto:admin@example.com`)
console.log("\nВнимание: приватный ключ — секрет. В git и в чат его отправлять не нужно.")

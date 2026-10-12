// lib/storage.ts
//
// Хранилище фотографий: одно место, из которого фото уходят на диск и
// берутся обратно.
//
// Зачем: раньше файлы писались прямо в public/uploads, а читались оттуда же —
// прямо в роутах и в OCR. Это работало на одном сервере, но на Vercel и любом
// другом serverless файловая система эфемерна: фото после загрузки просто
// исчезает, а реплики не видят файлов друг друга. Поэтому здесь единый
// интерфейс «положить / прочитать / удалить», а за ним два драйвера:
//
//   local (по умолчанию) — public/uploads, как раньше. Для одного сервера,
//   Docker и песочницы ничего настраивать не нужно.
//   s3                  — любой S3-совместимый объектный хранилище
//   (Yandex Object Storage, Cloudflare R2, Supabase Storage, MinIO, AWS).
//   Включается STORAGE_DRIVER=s3 и ключами STORAGE_S3_*.
//
// Важное решение: ссылка в базе (Photo.url) остаётся прежней —
// «/uploads/<организация>/<дата>/<имя>», и файл по-прежнему отдаёт роут
// /api/photos/file после проверки организации. Драйвер меняет только то,
// ГДЕ лежат байты, но не то, КТО может их получить: прямой публичный доступ
// к объектам не включается, доступ всегда через приложение и проверку
// организации. Так переезд на S3 не меняет модель безопасности.

import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

/** Префикс ссылки на фото в базе и в браузере. */
export const PHOTO_URL_PREFIX = "/uploads/"

/** Какой драйвер использовать: local (по умолчанию) или s3. */
export type StorageKind = "local" | "s3"

/** Ошибки хранилища — с человеческим объяснением (показываем в интерфейсе). */
export class StorageError extends Error {
  readonly status: number
  constructor(message: string, status = 500) {
    super(message)
    this.name = "StorageError"
    this.status = status
  }
}

// ---------------------------------------------------------------------------
// Ключи и ссылки
// ---------------------------------------------------------------------------

/**
 * Допустимый сегмент ключа: организация, дата, имя файла.
 *
 * Ограничение не косметическое: ключ попадает и в путь на диске, и в URL
 * объектного хранилища. Пробелы, «..», ведущий слэш и управляющие символы
 * отсюда нужно убирать ещё до того, как ключ куда-либо попадёт.
 */
const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Ключ фото всегда ровно из трёх сегментов: <организация>/<дата>/<имя>.
 * Сторонние ссылки с лишними или недостающими сегментами не принимаем.
 */
const KEY_SEGMENTS = 3

/**
 * Собирает ключ фото: <организация>/<дата>/<имя файла>.
 * Возвращает null, если хоть одна часть недопустима.
 */
export function buildStorageKey(params: {
  organizationId: string
  dateKey: string
  fileName: string
}): string | null {
  const parts = [params.organizationId, params.dateKey, params.fileName].map((part) =>
    String(part ?? "").trim(),
  )
  if (parts.some((part) => !SEGMENT_PATTERN.test(part))) return null
  return parts.join("/")
}

/**
 * Проверяет и нормализует готовый ключ (из базы, из query-параметра, из
 * ссылки). Отсекается всё, что не похоже на наш собственный ключ фото:
 * чужие ссылки, «../», абсолютные пути, пустые сегменты.
 */
export function normalizeStorageKey(raw: string): string | null {
  const value = String(raw ?? "").trim()
  if (!value) return null

  const withoutQuery = value.split("?")[0].split("#")[0]
  const relative = withoutQuery.startsWith(PHOTO_URL_PREFIX)
    ? withoutQuery.slice(PHOTO_URL_PREFIX.length)
    : withoutQuery

  if (!relative || relative.startsWith("/") || relative.includes("\\")) return null

  const segments = relative.split("/")
  if (segments.length !== KEY_SEGMENTS) return null
  if (segments.some((segment) => !SEGMENT_PATTERN.test(segment))) return null

  return segments.join("/")
}

/** Ссылка на фото по ключу — тот вид, в котором она лежит в базе. */
export function photoUrlFromKey(key: string): string {
  return `${PHOTO_URL_PREFIX}${key}`
}

/** Ключ фото по ссылке из базы («/uploads/<организация>/<дата>/<имя>»). */
export function storageKeyFromPhotoUrl(url: string): string | null {
  return normalizeStorageKey(url)
}

/** Первый сегмент ключа — организация, которой принадлежит файл. */
export function organizationFromStorageKey(key: string): string | null {
  return key.split("/")[0] || null
}

// ---------------------------------------------------------------------------
// Выбор драйвера
// ---------------------------------------------------------------------------

export function storageKind(): StorageKind {
  const raw = String(process.env.STORAGE_DRIVER ?? "").trim().toLowerCase()
  return raw === "s3" ? "s3" : "local"
}

/** Куда складываем файлы в local-режиме (public/uploads, как раньше). */
function localRoot(): string {
  return process.env.STORAGE_LOCAL_ROOT || path.join(process.cwd(), "public", "uploads")
}

/** Полный путь к файлу на диске с проверкой, что он внутри каталога загрузок. */
function localPath(key: string): string | null {
  const root = path.resolve(localRoot())
  // Каталог собирается во время исполнения, поэтому статически проследить его
  // нельзя. Явно отказываем сборщику в трейсинге: иначе Turbopack тянет в
  // образ весь проект (public, исходники) и предупреждает об этом.
  const absolute = path.resolve(
    path.join(
      root,
      /* turbopackIgnore: true */
      key,
    ),
  )
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return null
  return absolute
}

/** Content-type по расширению файла — для ответа и для заголовка в S3. */
export function contentTypeForFileName(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase()
  return (
    {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".heic": "image/heic",
      ".heif": "image/heif",
      ".pdf": "application/pdf",
    }[extension] ?? "application/octet-stream"
  )
}

// ---------------------------------------------------------------------------
// Публичный интерфейс
// ---------------------------------------------------------------------------

/** Кладёт файл фото в хранилище. */
export async function putPhoto(
  key: string,
  bytes: Buffer,
  contentType?: string,
): Promise<void> {
  const normalized = normalizeStorageKey(key)
  if (!normalized) {
    throw new StorageError("Недопустимое имя файла для хранилища", 400)
  }

  if (storageKind() === "s3") {
    await s3Put(normalized, bytes, contentType ?? contentTypeForFileName(normalized))
    return
  }

  const absolute = localPath(normalized)
  if (!absolute) {
    throw new StorageError("Недопустимый путь к файлу", 400)
  }
  await mkdir(path.dirname(absolute), { recursive: true })
  await writeFile(absolute, bytes)
}

/** Читает файл фото. null — файла нет (не ошибка: фото могло быть удалено). */
export async function readPhoto(key: string): Promise<Buffer | null> {
  const normalized = normalizeStorageKey(key)
  if (!normalized) return null

  if (storageKind() === "s3") {
    const bytes = await s3Get(normalized)
    if (bytes) return bytes
    // Переезд: файлы, загруженные до включения S3, лежат на диске. Читаем их
    // оттуда, чтобы старые фото не пропали из истории рейсов.
    return readLocalPhoto(normalized)
  }

  return readLocalPhoto(normalized)
}

/** Читает фото по ссылке из базы. */
export async function readPhotoByUrl(url: string): Promise<Buffer | null> {
  const key = storageKeyFromPhotoUrl(url)
  if (!key) return null
  return readPhoto(key)
}

/** Есть ли файл в хранилище. */
export async function photoExists(key: string): Promise<boolean> {
  const normalized = normalizeStorageKey(key)
  if (!normalized) return false

  if (storageKind() === "s3") {
    if (await s3Head(normalized)) return true
    return localExists(normalized)
  }

  return localExists(normalized)
}

/** Удаляет файл фото (из текущего драйвера и с диска — для сквозного удаления). */
export async function removePhoto(key: string): Promise<void> {
  const normalized = normalizeStorageKey(key)
  if (!normalized) return

  if (storageKind() === "s3") {
    await s3Delete(normalized)
  }

  const absolute = localPath(normalized)
  if (absolute) await rm(absolute, { force: true })
}

async function readLocalPhoto(key: string): Promise<Buffer | null> {
  const absolute = localPath(key)
  if (!absolute) return null
  try {
    return await readFile(absolute)
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null
    throw error
  }
}

async function localExists(key: string): Promise<boolean> {
  const absolute = localPath(key)
  if (!absolute) return false
  return existsSync(absolute)
}

// ---------------------------------------------------------------------------
// S3-совместимый драйвер (подпись запросов — своя, без дополнительных пакетов)
// ---------------------------------------------------------------------------

type S3Config = {
  endpoint: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  /** Префикс ключей внутри бакета — удобно, если бакет общий. */
  prefix: string
  /** path-style (http://host/bucket/key) — так работают MinIO и часть S3-совместимых. */
  pathStyle: boolean
}

function s3Config(): S3Config {
  const endpoint = String(process.env.STORAGE_S3_ENDPOINT ?? "").trim().replace(/\/+$/, "")
  const bucket = String(process.env.STORAGE_S3_BUCKET ?? "").trim()
  const region = String(process.env.STORAGE_S3_REGION ?? "").trim() || "us-east-1"
  const accessKeyId = String(process.env.STORAGE_S3_ACCESS_KEY_ID ?? "").trim()
  const secretAccessKey = String(process.env.STORAGE_S3_SECRET_ACCESS_KEY ?? "").trim()
  const prefix = String(process.env.STORAGE_S3_PREFIX ?? "").trim().replace(/^\/+|\/+$/g, "")
  const pathStyle = /^(1|true|yes|on)$/i.test(String(process.env.STORAGE_S3_PATH_STYLE ?? ""))

  const missing = [
    !endpoint && "STORAGE_S3_ENDPOINT",
    !bucket && "STORAGE_S3_BUCKET",
    !accessKeyId && "STORAGE_S3_ACCESS_KEY_ID",
    !secretAccessKey && "STORAGE_S3_SECRET_ACCESS_KEY",
  ].filter(Boolean) as string[]

  if (missing.length > 0) {
    throw new StorageError(
      `Включено S3-хранилище (STORAGE_DRIVER=s3), но не заданы: ${missing.join(", ")}`,
      500,
    )
  }

  return { endpoint, bucket, region, accessKeyId, secretAccessKey, prefix, pathStyle }
}

/** Полный ключ объекта в бакете (с префиксом, если он задан). */
function s3ObjectKey(config: S3Config, key: string): string {
  return config.prefix ? `${config.prefix}/${key}` : key
}

/**
 * Кодирование по правилам SigV4: escape всё, кроме A–Z a–z 0–9 - _ . ~.
 * Применяется к одному сегменту пути: разделители «/» между сегментами
 * остаются как есть.
 */
function sigv4Encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** Кодирует путь объекта: каждый сегмент отдельно, «/» между ними сохраняется. */
function sigv4EncodePath(objectKey: string): string {
  return objectKey
    .split("/")
    .map((segment) => sigv4Encode(segment))
    .join("/")
}

async function sha256Hex(data: Buffer | string): Promise<string> {
  const { createHash } = await import("node:crypto")
  return createHash("sha256").update(data).digest("hex")
}

async function hmacSha256(key: Buffer | string, data: string): Promise<Buffer> {
  const { createHmac } = await import("node:crypto")
  return createHmac("sha256", key).update(data, "utf8").digest()
}

async function signingKey(
  secret: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<Buffer> {
  const kDate = await hmacSha256(`AWS4${secret}`, dateStamp)
  const kRegion = await hmacSha256(kDate, region)
  const kService = await hmacSha256(kRegion, service)
  return hmacSha256(kService, "aws4_request")
}

type S3RequestOptions = {
  body?: Buffer
  contentType?: string
}

/** Подписанный запрос к S3-совместимому API. */
async function s3Request(
  method: "GET" | "PUT" | "HEAD" | "DELETE",
  key: string,
  options: S3RequestOptions = {},
): Promise<Response> {
  const config = s3Config()
  const objectKey = s3ObjectKey(config, key)
  const url = new URL(config.endpoint)
  const encodedKey = sigv4EncodePath(objectKey)

  if (config.pathStyle) {
    url.pathname = `/${config.bucket}/${encodedKey}`
  } else {
    url.hostname = `${config.bucket}.${url.hostname}`
    url.pathname = `/${encodedKey}`
  }

  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "")
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = await sha256Hex(options.body ?? Buffer.alloc(0))
  const host = url.host

  const headers = new Headers({
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  })
  if (options.contentType) headers.set("content-type", options.contentType)

  // Подписываем только то, что обязательно: S3 принимает подпись с хостом и
  // заголовками x-amz-*.
  const signedHeaders = ["host", "x-amz-content-sha256", "x-amz-date"]
  const canonicalHeaders = signedHeaders.map((name) => `${name}:${headers.get(name)}\n`).join("")
  const canonicalRequest = [
    method,
    url.pathname,
    "",
    canonicalHeaders,
    signedHeaders.join(";"),
    payloadHash,
  ].join("\n")

  const scope = `${dateStamp}/${config.region}/s3/aws4_request`
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n")

  const signingKeyBytes = await signingKey(
    config.secretAccessKey,
    dateStamp,
    config.region,
    "s3",
  )
  const signature = (await hmacSha256(signingKeyBytes, stringToSign)).toString("hex")

  headers.set(
    "authorization",
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders.join(";")}, Signature=${signature}`,
  )

  // Buffer в fetch-инициализации типизирован некорректно — отдаём Uint8Array
  return fetch(url, {
    method,
    headers,
    body: options.body ? new Uint8Array(options.body) : undefined,
  })
}

async function s3Put(key: string, bytes: Buffer, contentType: string): Promise<void> {
  const response = await s3Request("PUT", key, { body: bytes, contentType })
  if (!response.ok) {
    throw new StorageError(`Хранилище отклонило запись фото (${response.status})`, 502)
  }
}

async function s3Get(key: string): Promise<Buffer | null> {
  const response = await s3Request("GET", key)
  if (response.status === 404) return null
  if (!response.ok) {
    throw new StorageError(`Хранилище не отдало фото (${response.status})`, 502)
  }
  return Buffer.from(await response.arrayBuffer())
}

async function s3Head(key: string): Promise<boolean> {
  const response = await s3Request("HEAD", key)
  if (response.status === 404) return false
  if (!response.ok) {
    throw new StorageError(`Хранилище не ответило о фото (${response.status})`, 502)
  }
  return true
}

async function s3Delete(key: string): Promise<void> {
  const response = await s3Request("DELETE", key)
  // 404 — файла и так нет: удаление считается успешным
  if (!response.ok && response.status !== 404) {
    throw new StorageError(`Хранилище не удалило фото (${response.status})`, 502)
  }
}

/** Для тестов и диагностики: адрес объекта в хранилище. */
export function s3ObjectUrl(key: string): string {
  const config = s3Config()
  return `${config.endpoint}/${s3ObjectKey(config, key)}`
}

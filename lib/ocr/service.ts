// lib/ocr/service.ts
//
// Связка «фото → текст → поля документа» (задача 7).
//
// Работает с фотографией, которая уже лежит в хранилище (lib/storage.ts:
// public/uploads либо S3-совместимое): распознаёт текст локальным OCR,
// разбирает его правилами под чек или накладную и возвращает то, что
// человеку останется подтвердить.

import path from "node:path"

import { detectDocumentKind, parseDocument, type ParsedDocument } from "./parse"
import { recognizeImage, type OcrResult } from "./recognize"
import { readPhotoByUrl, storageKeyFromPhotoUrl } from "../storage"

export type PhotoOcrOutcome =
  | {
      ok: true
      ocr: OcrResult
      parsed: ParsedDocument
      /** Что это за документ по мнению OCR: чек, накладная или непонятно. */
      detectedKind: "receipt" | "waybill" | "unknown"
    }
  | { ok: false; error: string }

/**
 * Путь к файлу фото по его url — для локального диска.
 *
 * Фото хранятся как «/uploads/<организация>/<дата>/<имя>», поэтому url
 * превращается в путь внутри public. Всё, что выходит за пределы папки
 * uploads (например, «../../etc/passwd»), отбрасывается: чужие ссылки не читаем.
 *
 * Сам роут распознавания берёт файл через lib/storage (readPhotoByUrl), а эта
 * функция остаётся для локальных файлов и обратной совместимости.
 */
export function uploadPathFromUrl(url: string): string | null {
  const key = storageKeyFromPhotoUrl(url)
  if (!key) return null
  const uploadsRoot = path.join(process.cwd(), "public", "uploads")
  const absolute = path.join(uploadsRoot, key)
  if (!absolute.startsWith(uploadsRoot)) return null
  return absolute
}

/** Данные, которые сохраняются в Photo.ocrText / Photo.ocrData. */
export function ocrDataPayload(ocr: OcrResult, parsed: ParsedDocument) {
  return {
    provider: ocr.provider,
    languages: ocr.languages,
    confidence: Math.round(ocr.confidence),
    durationMs: ocr.durationMs,
    parsed,
  }
}

/**
 * Распознаёт документ на фото.
 *
 * Подсказка `hint` (тип фото из интерфейса) важнее автоопределения: если
 * водитель отметил «чек», текст разбирается правилами чека даже когда в нём
 * случайно встретилось слово «накладная».
 */
export async function recognizeDocumentOnPhoto(params: {
  url: string
  hint?: "receipt" | "waybill" | null
}): Promise<PhotoOcrOutcome> {
  // Читаем через хранилище: файл может лежать и на диске, и в S3. Файлы,
  // загруженные до включения S3, читаются с диска (см. readPhotoByUrl).
  const bytes = await readPhotoByUrl(params.url)
  if (!bytes) {
    return { ok: false, error: "Файл фото не найден в хранилище" }
  }

  try {
    const ocr = await recognizeImage(bytes)
    if (ocr.failed) {
      // Фото уже в хранилище: отдаём причину, а не «пустой» успех, чтобы
      // интерфейс предложил ввести данные вручную.
      return { ok: false, error: `Распознавание не удалось: ${ocr.error || "OCR не ответил"}` }
    }
    const detectedKind = detectDocumentKind(ocr.text)
    const parsed = parseDocument(ocr.text, params.hint ?? undefined)

    return { ok: true, ocr, parsed, detectedKind }
  } catch (error) {
    const message = error instanceof Error ? error.message : "OCR не смог прочитать фото"
    return { ok: false, error: `Распознавание не удалось: ${message}` }
  }
}

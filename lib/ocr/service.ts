// lib/ocr/service.ts
//
// Связка «фото → текст → поля документа» (задача 7).
//
// Работает с фотографией, которая уже лежит в хранилище (public/uploads):
// распознаёт текст локальным OCR, разбирает его правилами под чек или
// накладную и возвращает то, что человеку останется подтвердить.

import fs from "node:fs"
import path from "node:path"

import { detectDocumentKind, parseDocument, type ParsedDocument } from "./parse"
import { recognizeImage, type OcrResult } from "./recognize"

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
 * Путь к файлу фото по его url.
 *
 * Фото хранятся как «/uploads/<организация>/<файл>», поэтому url превращается
 * в путь внутри public. Всё, что выходит за пределы папки uploads (например,
 * «../../etc/passwd»), отбрасывается: чужие ссылки не читаем.
 */
export function uploadPathFromUrl(url: string): string | null {
  if (!url) return null
  const uploadsRoot = path.join(process.cwd(), "public", "uploads")
  const withoutQuery = url.split("?")[0]

  if (!withoutQuery.startsWith("/uploads/")) return null

  const relative = withoutQuery.replace(/^\/uploads\//, "")
  if (relative.includes("..") || relative.startsWith("/")) return null

  const absolute = path.join(uploadsRoot, relative)
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
  const filePath = uploadPathFromUrl(params.url)
  if (!filePath) {
    return { ok: false, error: "Фото лежит не в хранилище загрузок — распознать нечего" }
  }
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: "Файл фото не найден в хранилище" }
  }

  try {
    const ocr = await recognizeImage(fs.readFileSync(filePath))
    const detectedKind = detectDocumentKind(ocr.text)
    const parsed = parseDocument(ocr.text, params.hint ?? undefined)

    return { ok: true, ocr, parsed, detectedKind }
  } catch (error) {
    const message = error instanceof Error ? error.message : "OCR не смог прочитать фото"
    return { ok: false, error: `Распознавание не удалось: ${message}` }
  }
}

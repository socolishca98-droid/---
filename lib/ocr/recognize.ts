// lib/ocr/recognize.ts
//
// Локальное распознавание текста с фотографий (задача 7).
//
// Пользователь выбрал вариант «0 ₽»: OCR работает на своём сервере через
// tesseract.js (WASM), без подписок и внешних сервисов. Языки — русский и
// английский, потому что чеки и накладные печатают вперемешку.
//
// Данные языков (rus.traineddata, eng.traineddata) скачиваются один раз при
// первом распознавании и кладутся в кэш (OCR_CACHE_DIR, по умолчанию
// .ocr-cache в корне проекта). Дальше распознавание идёт без интернета.
// Если в сети закрыт доступ к CDN, положите файлы языков в папку кэша вручную
// и укажите OCR_LANG_PATH — распознавание будет полностью офлайн.

import fs from "node:fs"
import path from "node:path"

export type OcrResult = {
  text: string
  confidence: number
  provider: "tesseract"
  /** Сколько секунд заняло распознавание — видно в интерфейсе. */
  durationMs: number
  languages: string[]
}

export type OcrInput = string | Buffer | Uint8Array

/** Папка кэша языковых данных: сюда tesseract кладёт *.traineddata. */
export function ocrCacheDir(): string {
  return process.env.OCR_CACHE_DIR || path.join(process.cwd(), ".ocr-cache")
}

function languages(): string[] {
  const raw = process.env.OCR_LANGUAGES || "rus+eng"
  return raw
    .split("+")
    .map((lang) => lang.trim())
    .filter(Boolean)
}

type WorkerLike = {
  recognize: (input: OcrInput) => Promise<{ data: { text: string; confidence?: number } }>
  terminate: () => Promise<unknown>
}

let workerPromise: Promise<WorkerLike> | null = null

/**
 * Воркер создаётся один раз на процесс: его запуск стоит секунды, а
 * распознавание — десятые доли. Последовательные вызовы выстраиваются в
 * очередь внутри воркера.
 */
async function getWorker(): Promise<WorkerLike> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const cachePath = ocrCacheDir()
      fs.mkdirSync(cachePath, { recursive: true })

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createWorker } = require("tesseract.js") as {
        createWorker: (
          langs: string,
          oem?: number,
          options?: Record<string, unknown>,
        ) => Promise<WorkerLike>
      }

      const options: Record<string, unknown> = {
        cachePath,
        logger: () => {},
      }
      if (process.env.OCR_LANG_PATH) options.langPath = process.env.OCR_LANG_PATH

      return createWorker(languages().join("+"), 1, options)
    })()

    workerPromise.catch(() => {
      // не запоминаем сломанный воркер: следующая попытка создаст новый
      workerPromise = null
    })
  }

  return workerPromise
}

/**
 * Распознаёт текст на изображении.
 *
 * Пустой текст — это не ошибка: на плохом фото OCR честно возвращает пустоту,
 * а решение, что делать дальше (ввести сумму вручную), принимает человек.
 */
export async function recognizeImage(input: OcrInput): Promise<OcrResult> {
  const startedAt = Date.now()

  const worker = await getWorker()
  const result = await worker.recognize(input)

  return {
    text: String(result?.data?.text || "")
      .replace(/\u00a0/g, " ")
      .trim(),
    confidence: typeof result?.data?.confidence === "number" ? result.data.confidence : 0,
    provider: "tesseract",
    durationMs: Date.now() - startedAt,
    languages: languages(),
  }
}

/** Закрывает воркер: нужен в тестах и при аккуратном завершении процесса. */
export async function shutdownOcr(): Promise<void> {
  if (!workerPromise) return
  const worker = await workerPromise.catch(() => null)
  workerPromise = null
  if (worker) await worker.terminate().catch(() => {})
}

/** Распознаёт файл с диска (фото лежат в public/uploads). */
export async function recognizeFile(filePath: string): Promise<OcrResult> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Файл не найден: ${filePath}`)
  }
  return recognizeImage(fs.readFileSync(filePath))
}

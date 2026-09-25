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
  /**
   * Распознавание не состоялось (таймаут, воркер не поднялся).
   * Это не ошибка данных: фото уже сохранено, человек просто введёт поля руками.
   */
  failed?: boolean
  error?: string
}

/**
 * Предел ожидания распознавания. OCR не должен держать загрузку фото:
 * если tesseract не ответил за отведённое время, отдаём честный отказ.
 */
export function ocrTimeoutMs(): number {
  const raw = Number(process.env.OCR_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000
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

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: превышено время ожидания (${Math.round(ms / 1000)} с)`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Распознаёт текст на изображении.
 *
 * Пустой текст — это не ошибка: на плохом фото OCR честно возвращает пустоту,
 * а решение, что делать дальше (ввести сумму вручную), принимает человек.
 *
 * Ошибка распознавания (нет воркера, таймаут) тоже не роняет загрузку фото:
 * возвращаем результат с `failed: true` и причиной — фото уже сохранено.
 */
export async function recognizeImage(input: OcrInput): Promise<OcrResult> {
  const startedAt = Date.now()
  const timeoutMs = ocrTimeoutMs()

  try {
    const worker = await withTimeout(getWorker(), timeoutMs, "OCR: запуск распознавания")
    const result = await withTimeout(worker.recognize(input), timeoutMs, "OCR: распознавание фото")

    return {
      text: String(result?.data?.text || "")
        .replace(/\u00a0/g, " ")
        .trim(),
      confidence: typeof result?.data?.confidence === "number" ? result.data.confidence : 0,
      provider: "tesseract",
      durationMs: Date.now() - startedAt,
      languages: languages(),
    }
  } catch (error: any) {
    // Воркер мог остаться в нерабочем состоянии — рвём его, чтобы следующая
    // попытка подняла новый, а не ждала тот же сломанный.
    await shutdownOcr().catch(() => {})
    return {
      text: "",
      confidence: 0,
      provider: "tesseract",
      durationMs: Date.now() - startedAt,
      languages: languages(),
      failed: true,
      error: error?.message || String(error),
    }
  }
}

/** Закрывает воркер: нужен в тестах и при аккуратном завершении процесса. */
export async function shutdownOcr(): Promise<void> {
  const pending = workerPromise
  if (!pending) return
  workerPromise = null

  // Ждать создание воркера нельзя: если tesseract застрял (например, в
  // песочнице нет сети для загрузки языковых данных), его промис не
  // завершится никогда — и «уборка» повесила бы сам запрос. Даём секунду и
  // идём дальше: если воркер всё-таки поднялся, он будет закрыт.
  const worker = await Promise.race([
    pending.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
  ])
  if (worker) await worker.terminate().catch(() => {})
}

/** Распознаёт файл с диска (фото лежат в public/uploads). */
export async function recognizeFile(filePath: string): Promise<OcrResult> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Файл не найден: ${filePath}`)
  }
  return recognizeImage(fs.readFileSync(filePath))
}

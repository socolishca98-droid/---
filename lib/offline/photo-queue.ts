// lib/offline/photo-queue.ts
//
// Очередь фото на случай плохой связи (задача 7, надёжность).
//
// Зачем: водитель фотографирует чек там, где связи нет — на трассе, у склада,
// в подвале. Раньше в этом месте фото просто не загружалось: файл оставался в
// браузере до перезагрузки страницы, и расход по чеку терялся. Здесь фото
// кладётся в IndexedDB (не в localStorage: там только строки и всего ~5 МБ) и
// уходит на сервер само, как только связь вернулась.
//
// Логика отделена от браузера: очередь принимает хранилище и функцию отправки.
// Поэтому её поведение проверяется тестами (tests/photo-queue.test.mjs) без
// браузера, IndexedDB и сервера — а в приложении подставляются настоящие.
//
// Важное про честность: фото НЕ считается отправленным, пока сервер не
// ответил успехом. Ошибка сохраняется в lastError, попытка увеличивается,
// следующая — с задержкой (до 5 минут), чтобы не бить в сеть без толку.

export type QueuedPhoto = {
  id: string
  /** Сам файл. В IndexedDB Blob хранится как есть — без base64 и раздувания */
  blob: Blob
  fileName: string
  photoType: string
  orderId: string | null
  routeId: string | null
  description: string | null
  /**
   * Водитель, чьё это фото. В мобильном контуре пусто — сервер берёт автора из
   * сессии; в кабинете логист выбирает водителя, и его нужно передать явно.
   */
  driverId: string | null
  createdAt: number
  attempts: number
  lastAttemptAt: number | null
  status: "pending" | "uploading"
  lastError: string | null
}

export type NewQueuedPhoto = {
  blob: Blob
  fileName: string
  photoType: string
  orderId?: string | null
  routeId?: string | null
  description?: string | null
  driverId?: string | null
  /**
   * Момент неудачной попытки, если фото кладут в очередь после прямой отправки.
   * Тогда очередь не бьёт в сеть сразу же второй раз, а ждёт обычную задержку.
   */
  attemptedAt?: number | null
  initialError?: string | null
}

export type UploadSuccess = { ok: true; photo: unknown; ocr?: unknown; warnings?: string[] }
export type UploadFailure = { ok: false; error: string }
export type UploadResult = UploadSuccess | UploadFailure

export type QueueStorage = {
  list(): Promise<QueuedPhoto[]>
  put(item: QueuedPhoto): Promise<void>
  remove(id: string): Promise<void>
}

export type PhotoQueueOptions = {
  storage: QueueStorage
  upload: (item: QueuedPhoto) => Promise<UploadResult>
  now?: () => number
  /** Идентификатор для новых записей (в тестах — предсказуемый) */
  createId?: () => string
  /** Пауза перед повторной попыткой: по умолчанию 15 сек × 2^n, но не больше 5 минут */
  retryDelayMs?: (attempts: number) => number
}

const MAX_BACKOFF_MS = 5 * 60 * 1000

function defaultRetryDelay(attempts: number): number {
  return Math.min(15_000 * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS)
}

function defaultCreateId(): string {
  const random = Math.random().toString(36).slice(2, 8)
  return `photo-${Date.now().toString(36)}-${random}`
}

export type PhotoQueue = {
  /** Положить фото в очередь и сразу попробовать отправить */
  enqueue(photo: NewQueuedPhoto): Promise<QueuedPhoto>
  /** Отправить всё, что ждёт (учитывая задержку между попытками) */
  process(): Promise<{ sent: number; pending: number; failed: number }>
  /** Что лежит в очереди (сначала старые) */
  list(): Promise<QueuedPhoto[]>
  pendingCount(): Promise<number>
  /** Удалить запись вручную (водитель отказался от фото) */
  remove(id: string): Promise<void>
  /** Очистить всё: выход из аккаунта или смена водителя */
  clear(): Promise<void>
  /** Подписка на изменения: возвращает функцию отписки */
  subscribe(listener: (items: QueuedPhoto[]) => void): () => void
  /** Кто успешно ушёл — для тостов «фото загружено» */
  onUploaded(listener: (item: QueuedPhoto, result: UploadSuccess) => void): () => void
}

export function createPhotoQueue(options: PhotoQueueOptions): PhotoQueue {
  const {
    storage,
    upload,
    now = () => Date.now(),
    createId = defaultCreateId,
    retryDelayMs = defaultRetryDelay,
  } = options

  const listeners = new Set<(items: QueuedPhoto[]) => void>()
  const uploadedListeners = new Set<(item: QueuedPhoto, result: UploadSuccess) => void>()

  let inFlight: Promise<{ sent: number; pending: number; failed: number }> | null = null

  async function snapshot(): Promise<QueuedPhoto[]> {
    const items = await storage.list()
    return items.sort((a, b) => a.createdAt - b.createdAt)
  }

  async function notify(): Promise<void> {
    const items = await snapshot()
    for (const listener of listeners) listener(items)
  }

  async function enqueue(photo: NewQueuedPhoto): Promise<QueuedPhoto> {
    const item: QueuedPhoto = {
      id: createId(),
      blob: photo.blob,
      fileName: photo.fileName,
      photoType: photo.photoType,
      orderId: photo.orderId ?? null,
      routeId: photo.routeId ?? null,
      description: photo.description ?? null,
      driverId: photo.driverId ?? null,
      createdAt: now(),
      attempts: photo.attemptedAt ? 1 : 0,
      lastAttemptAt: photo.attemptedAt ?? null,
      status: "pending",
      lastError: photo.initialError ?? null,
    }

    await storage.put(item)
    await notify()
    return item
  }

  function isReady(item: QueuedPhoto, time: number): boolean {
    // Первая попытка — сразу, дальше с задержкой: сеть могла ещё не вернуться
    if (!item.lastAttemptAt) return true
    return time - item.lastAttemptAt >= retryDelayMs(item.attempts)
  }

  async function send(item: QueuedPhoto, time: number): Promise<boolean> {
    await storage.put({ ...item, status: "uploading", lastAttemptAt: time })

    let result: UploadResult
    try {
      result = await upload(item)
    } catch (error) {
      result = {
        ok: false,
        error: error instanceof Error ? error.message : "не удалось отправить фото",
      }
    }

    if (!result.ok) {
      // Фото остаётся в очереди: водитель не должен переснимать чек из-за связи
      await storage.put({
        ...item,
        status: "pending",
        attempts: item.attempts + 1,
        lastAttemptAt: time,
        lastError: result.error,
      })
      await notify()
      return false
    }

    await storage.remove(item.id)
    for (const listener of uploadedListeners) listener(item, result)
    await notify()
    return true
  }

  async function process(): Promise<{ sent: number; pending: number; failed: number }> {
    // Параллельные вызовы (онлайн-событие + нажатие кнопки) не должны слать одно и то же дважды
    if (inFlight) return inFlight

    inFlight = (async () => {
      const time = now()
      const items = (await snapshot()).filter((item) => item.status === "pending")

      let sent = 0
      let failed = 0

      for (const item of items) {
        if (!isReady(item, time)) continue
        const ok = await send(item, time)
        if (ok) sent += 1
        else failed += 1
      }

      const rest = await snapshot()
      return { sent, pending: rest.length, failed }
    })()

    try {
      return await inFlight
    } finally {
      inFlight = null
    }
  }

  async function pendingCount(): Promise<number> {
    return (await snapshot()).length
  }

  async function remove(id: string): Promise<void> {
    await storage.remove(id)
    await notify()
  }

  async function clear(): Promise<void> {
    const items = await snapshot()
    for (const item of items) await storage.remove(item.id)
    await notify()
  }

  return {
    enqueue,
    process,
    list: snapshot,
    pendingCount,
    remove,
    clear,
    subscribe(listener) {
      listeners.add(listener)
      void notify()
      return () => listeners.delete(listener)
    },
    onUploaded(listener) {
      uploadedListeners.add(listener)
      return () => uploadedListeners.delete(listener)
    },
  }
}

/** Хранилище в памяти — для тестов и для серверного рендера. */
export function createMemoryStorage(initial: QueuedPhoto[] = []): QueueStorage {
  const items = new Map<string, QueuedPhoto>()
  for (const item of initial) items.set(item.id, item)

  return {
    async list() {
      return Array.from(items.values()).map((item) => ({ ...item }))
    },
    async put(item) {
      items.set(item.id, { ...item })
    },
    async remove(id) {
      items.delete(id)
    },
  }
}

// ---------------------------------------------------------------------------
// Браузерная часть: IndexedDB и отправка на сервер
// ---------------------------------------------------------------------------

const DB_NAME = "loginex-offline"
const DB_STORE = "photo-queue"
const DB_VERSION = 1

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: "id" })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB недоступна"))
  })
}

/** Хранилище в IndexedDB: переживает перезагрузку страницы и закрытие приложения. */
export function createIndexedDbStorage(): QueueStorage {
  async function withStore<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await openDatabase()
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(DB_STORE, mode)
      const request = run(transaction.objectStore(DB_STORE))

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error("Ошибка IndexedDB"))
      transaction.oncomplete = () => db.close()
    })
  }

  return {
    async list() {
      const rows = await withStore<QueuedPhoto[]>("readonly", (store) => store.getAll())
      return Array.isArray(rows) ? rows : []
    },
    async put(item) {
      await withStore("readwrite", (store) => store.put(item))
    },
    async remove(id) {
      await withStore("readwrite", (store) => store.delete(id))
    },
  }
}

/** Отправка одного фото на сервер: тот же multipart-эндпоинт, что и в кабинете. */
export async function uploadQueuedPhoto(item: QueuedPhoto): Promise<UploadResult> {
  const form = new FormData()
  const file = new File([item.blob], item.fileName, { type: item.blob.type || "image/jpeg" })
  form.append("file", file)
  form.append("type", item.photoType)
  if (item.orderId) form.append("orderId", item.orderId)
  if (item.routeId) form.append("routeId", item.routeId)
  if (item.description) form.append("description", item.description)
  if (item.driverId) form.append("driverId", item.driverId)

  try {
    const response = await fetch("/api/photos/upload", {
      method: "POST",
      body: form,
      credentials: "include",
    })
    const payload = await response.json().catch(() => ({}))

    if (!response.ok || !payload?.success) {
      return { ok: false, error: payload?.error || `код ${response.status}` }
    }

    return {
      ok: true,
      photo: payload.photo,
      ocr: payload.ocr,
      warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "нет связи",
    }
  }
}

/**
 * Очередь приложения: одна на браузер. Создаётся только на клиенте — на сервере
 * (SSR) IndexedDB нет, а очередь водителю нужна в телефоне. Повторы запускает
 * возвращение связи, появление вкладты на экране и собственный таймер.
 */
let browserQueue: PhotoQueue | null = null

export function getPhotoQueue(): PhotoQueue | null {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return null

  if (!browserQueue) {
    browserQueue = createPhotoQueue({
      storage: createIndexedDbStorage(),
      upload: uploadQueuedPhoto,
    })

    const process = () => {
      void browserQueue?.process()
    }

    window.addEventListener("online", process)
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) process()
    })
    window.setInterval(process, 60_000)
    process()
  }

  return browserQueue
}

/**
 * Очистить очередь при выходе из аккаунта.
 *
 * Иначе чужие фото остались бы в памяти браузера: после входа другого человека
 * они бы уходили от его имени (сервер их отклонит, но записи висели бы вечно).
 * Сессия отозвана — отправлять больше нечего.
 */
export async function clearPhotoQueue(): Promise<void> {
  const queue = getPhotoQueue()
  if (!queue) return
  await queue.clear()
}

/** Отправить фото сейчас; если связи нет — положить в очередь (без потери файла). */
export async function uploadPhotoOrQueue(
  photo: NewQueuedPhoto,
): Promise<{
  sent: boolean
  queued: boolean
  photo?: unknown
  ocr?: unknown
  warnings?: string[]
  error?: string
}> {
  // Обычно связь есть — отправляем сразу и получаем распознавание в ответе
  const direct = await uploadQueuedPhoto(toQueuedPhoto(photo, "direct"))

  if (direct.ok) {
    return {
      sent: true,
      queued: false,
      photo: direct.photo,
      ocr: direct.ocr,
      warnings: direct.warnings ?? [],
    }
  }

  const queue = getPhotoQueue()

  // Очереди нет (сервер или старый браузер) — честно говорим, что не ушло
  if (!queue) return { sent: false, queued: false, error: direct.error }

  // Фото уже не потерять: файл лежит в IndexedDB, попытки продолжатся сами
  await queue.enqueue({ ...photo, attemptedAt: Date.now(), initialError: direct.error })

  return { sent: false, queued: true, error: direct.error }
}

function toQueuedPhoto(photo: NewQueuedPhoto, id: string): QueuedPhoto {
  return {
    id,
    blob: photo.blob,
    fileName: photo.fileName,
    photoType: photo.photoType,
    orderId: photo.orderId ?? null,
    routeId: photo.routeId ?? null,
    description: photo.description ?? null,
    driverId: photo.driverId ?? null,
    createdAt: Date.now(),
    attempts: 0,
    lastAttemptAt: null,
    status: "pending",
    lastError: null,
  }
}

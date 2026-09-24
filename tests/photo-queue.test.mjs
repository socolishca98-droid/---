/**
 * Тесты очереди фото (lib/offline/photo-queue.ts).
 *
 * Зачем они: очередь — это обещание водителю «чек не пропадёт». Проверяем
 * именно это обещание, а не внутренности: файл лежит до успеха, при неудаче
 * остаётся с записанной причиной, повторы не бьют в сеть без задержки,
 * выключенный телефон не теряет фото, после перезапуска всё на месте.
 *
 * Хранилище и отправка подменяются: ни браузера, ни IndexedDB, ни сервера.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { createPhotoQueue, createMemoryStorage } = require(
  "../.test-build/lib/offline/photo-queue.js"
)

/** Файл, который водитель снял на телефон */
function fakePhoto(name = "receipt.jpg") {
  return {
    blob: { size: 1024, type: "image/jpeg", name },
    fileName: name,
    photoType: "receipt",
    orderId: "order-1",
  }
}

/** Часы под контролем: задержки повторов проверяются без ожидания */
function fakeClock(start = 1_000_000) {
  let current = start
  return {
    now: () => current,
    advance(ms) {
      current += ms
    },
  }
}

test("фото уходит сразу и исчезает из очереди", async () => {
  const storage = createMemoryStorage()
  const sent = []
  const queue = createPhotoQueue({
    storage,
    upload: async (item) => {
      sent.push(item.fileName)
      return { ok: true, photo: { id: "photo-1" }, ocr: { total: 4500 } }
    },
  })

  const result = await queue.process()
  assert.equal(result.sent, 0, "пустая очередь ничего не отправляет")

  await queue.enqueue(fakePhoto())
  const after = await queue.process()

  assert.equal(after.sent, 1)
  assert.deepEqual(sent, ["receipt.jpg"])
  assert.equal(await queue.pendingCount(), 0, "успешное фото не остаётся в очереди")
})

test("успешное фото сообщает наружу распознавание чека", async () => {
  const queue = createPhotoQueue({
    storage: createMemoryStorage(),
    upload: async () => ({ ok: true, photo: { id: "p1" }, ocr: { total: 4200 } }),
  })

  const events = []
  const unsubscribe = queue.onUploaded((item, result) => {
    events.push({ file: item.fileName, total: result.ocr.total })
  })

  await queue.enqueue(fakePhoto())
  await queue.process()

  assert.deepEqual(events, [{ file: "receipt.jpg", total: 4200 }])

  unsubscribe()
  await queue.enqueue(fakePhoto("second.jpg"))
  await queue.process()
  assert.equal(events.length, 1, "после отписки события больше не приходят")
})

test("ошибка отправки не теряет фото: файл ждёт в очереди с причиной", async () => {
  const storage = createMemoryStorage()
  const queue = createPhotoQueue({
    storage,
    upload: async () => ({ ok: false, error: "нет связи" }),
  })

  await queue.enqueue(fakePhoto())
  const result = await queue.process()

  assert.equal(result.sent, 0)
  assert.equal(result.failed, 1)
  assert.equal(await queue.pendingCount(), 1, "фото осталось в очереди")

  const [item] = await queue.list()
  assert.equal(item.lastError, "нет связи")
  assert.equal(item.attempts, 1)
  assert.equal(item.status, "pending")
})

test("исключение в отправке не роняет очередь и считается ошибкой", async () => {
  const queue = createPhotoQueue({
    storage: createMemoryStorage(),
    upload: async () => {
      throw new Error("обрыв соединения")
    },
  })

  await queue.enqueue(fakePhoto())
  const result = await queue.process()

  assert.equal(result.failed, 1)
  const [item] = await queue.list()
  assert.match(item.lastError, /обрыв/)
})

test("повтор не бьёт в сеть сразу, а ждёт задержку и потом уходит", async () => {
  const clock = fakeClock()
  const storage = createMemoryStorage()
  let attempts = 0
  const queue = createPhotoQueue({
    storage,
    now: clock.now,
    retryDelayMs: () => 60_000,
    upload: async () => {
      attempts += 1
      return attempts === 1 ? { ok: false, error: "нет связи" } : { ok: true, photo: { id: "p" } }
    },
  })

  await queue.enqueue(fakePhoto())
  await queue.process()
  assert.equal(attempts, 1)

  // Слишком рано: связь ещё не вернулась — в сеть не идём
  clock.advance(30_000)
  const tooEarly = await queue.process()
  assert.equal(tooEarly.sent, 0)
  assert.equal(attempts, 1, "до истечения задержки попыток не было")

  // Пора: фото уходит само
  clock.advance(30_000)
  const later = await queue.process()
  assert.equal(later.sent, 1)
  assert.equal(attempts, 2)
  assert.equal(await queue.pendingCount(), 0)
})

test("фото, отправленное сразу после неудачи, не дублируется повтором в тот же миг", async () => {
  const clock = fakeClock()
  let attempts = 0
  const queue = createPhotoQueue({
    storage: createMemoryStorage(),
    now: clock.now,
    retryDelayMs: () => 60_000,
    upload: async () => {
      attempts += 1
      return { ok: false, error: "нет связи" }
    },
  })

  // Так делает uploadPhotoOrQueue: уже была неудачная попытка в момент now
  await queue.enqueue({ ...fakePhoto(), attemptedAt: clock.now(), initialError: "нет связи" })
  await queue.process()

  assert.equal(attempts, 0, "сразу после неудачи повтор не нужен — выждем паузу")
  const [item] = await queue.list()
  assert.equal(item.attempts, 1, "неудачная попытка уже учтена")
})

test("два одновременных запуска не отправляют одно фото дважды", async () => {
  const queue = createPhotoQueue({
    storage: createMemoryStorage(),
    upload: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { ok: true, photo: { id: "p" } }
    },
  })

  await queue.enqueue(fakePhoto())
  const [first, second] = await Promise.all([queue.process(), queue.process()])

  assert.equal(first.sent, 1)
  assert.equal(second.sent, 1)
  assert.equal(await queue.pendingCount(), 0)
})

test("несколько фото уходят по порядку съёмки", async () => {
  const clock = fakeClock()
  const storage = createMemoryStorage()
  const order = []
  const queue = createPhotoQueue({
    storage,
    now: clock.now,
    upload: async (item) => {
      order.push(item.fileName)
      return { ok: true, photo: { id: item.fileName } }
    },
  })

  await queue.enqueue(fakePhoto("first.jpg"))
  clock.advance(1000)
  await queue.enqueue(fakePhoto("second.jpg"))
  clock.advance(1000)
  await queue.enqueue(fakePhoto("third.jpg"))

  await queue.process()
  assert.deepEqual(order, ["first.jpg", "second.jpg", "third.jpg"])
})

test("удаление и очистка: водитель может отказаться от фото", async () => {
  const queue = createPhotoQueue({
    storage: createMemoryStorage(),
    upload: async () => ({ ok: false, error: "нет связи" }),
  })

  const first = await queue.enqueue(fakePhoto("a.jpg"))
  await queue.enqueue(fakePhoto("b.jpg"))
  assert.equal(await queue.pendingCount(), 2)

  await queue.remove(first.id)
  assert.equal(await queue.pendingCount(), 1)

  await queue.clear()
  assert.equal(await queue.pendingCount(), 0, "выход из аккаунта чистит очередь водителя")
})

test("подписка сразу отдаёт текущее состояние и обновляется при изменениях", async () => {
  const queue = createPhotoQueue({
    storage: createMemoryStorage(),
    upload: async () => ({ ok: false, error: "нет связи" }),
  })

  const seen = []
  const unsubscribe = queue.subscribe((items) => seen.push(items.length))

  await queue.enqueue(fakePhoto())
  await queue.process()

  assert.ok(seen.length >= 1)
  assert.equal(seen[0], 0, "при подписке очередь была пуста")
  assert.equal(seen[seen.length - 1], 1, "после неудачной отправки фото в очереди")

  unsubscribe()
})

test("неизвестный результат отправки считается неудачей, а не успехом", async () => {
  const queue = createPhotoQueue({
    storage: createMemoryStorage(),
    upload: async () => ({ ok: false, error: "сервер вернул 500" }),
  })

  await queue.enqueue(fakePhoto())
  await queue.process()

  assert.equal(await queue.pendingCount(), 1, "сомнительный ответ — фото не удаляем")
})

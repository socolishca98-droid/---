/**
 * Тесты раскладки карточек на холсте песочницы.
 *
 * Повод: новая карточка вставала в квадрат 50×50 px (100 + random), а сама
 * карточка — 230×178. Вторая ложилась ровно на первую, логист видел один груз
 * и «маршрут не собирался».
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { nextCardPosition, CARD_WIDTH, CARD_HEIGHT } = require(
  "../.test-build/lib/sandbox/placement.js",
)

const AREA = { width: 520, height: 560 }

function overlaps(a, b) {
  return (
    a.x < b.x + CARD_WIDTH &&
    a.x + CARD_WIDTH > b.x &&
    a.y < b.y + CARD_HEIGHT &&
    a.y + CARD_HEIGHT > b.y
  )
}

test("первая карточка встаёт в левый верхний угол", () => {
  const position = nextCardPosition([], AREA)
  assert.ok(position.x < CARD_WIDTH, "не должна уезжать вправо")
  assert.ok(position.y < CARD_HEIGHT, "не должна уезжать вниз")
})

test("вторая карточка не ложится на первую", () => {
  const first = nextCardPosition([], AREA)
  const second = nextCardPosition([first], AREA)
  assert.equal(overlaps(first, second), false, "карточки перекрываются")
})

test("четыре карточки на узком холсте не перекрываются", () => {
  const placed = []
  for (let i = 0; i < 4; i += 1) placed.push(nextCardPosition(placed, AREA))

  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      assert.equal(
        overlaps(placed[i], placed[j]),
        false,
        `карточки ${i} и ${j} перекрываются: ${JSON.stringify([placed[i], placed[j]])}`,
      )
    }
  }
})

test("восемь карточек на рабочем холсте ПК не перекрываются", () => {
  const placed = []
  const desktop = { width: 1000, height: 700 }
  for (let i = 0; i < 8; i += 1) placed.push(nextCardPosition(placed, desktop))

  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      assert.equal(
        overlaps(placed[i], placed[j]),
        false,
        `карточки ${i} и ${j} перекрываются: ${JSON.stringify([placed[i], placed[j]])}`,
      )
    }
  }
})

test("на узком холсте карточки всё равно не совпадают", () => {
  const narrow = { width: 250, height: 400 }
  const placed = []
  for (let i = 0; i < 4; i += 1) placed.push(nextCardPosition(placed, narrow))

  const keys = new Set(placed.map((p) => `${p.x}:${p.y}`))
  assert.equal(keys.size, placed.length, "позиции повторяются")
})

test("холст ещё не измерен — считаем по умолчанию", () => {
  const position = nextCardPosition([], { width: 0, height: 0 })
  assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y))
  assert.ok(position.x >= 0 && position.y >= 0)
})

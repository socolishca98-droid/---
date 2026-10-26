// tests/assistant-region-only.test.mjs
//
// Помощник берёт грузы ТОЛЬКО из региона базы организации.
//
// Замер на бою: в кэше 1290 грузов, из них 105 из Московской области и 58 из
// Калужской, а из Ярославской — НОЛЬ. Помощник, читая кэш как есть, предлагал
// компании из Ярославля груз из Новосибирска. Пользователь увидел на экране
// чипсы «Новосибирск · 12», «Вязники · 10» и справедливо спросил: «А если и
// собран, то через всю страну проехать надо».
//
// Также: если в своём регионе грузов нет, экран не показывает пустоту и не
// притворяется, что всё в порядке, — он предлагает собрать биржу региона.
//
// Этот тест стережет правило на уровне исходников.

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const PAGE = readFileSync(join(ROOT, "app/lm/routes/assistant/page.tsx"), "utf8")

test("регион базы определяется из её адреса", () => {
  assert.match(PAGE, /findRegionByNameLocal\(baseCity\)/, "регион должен резолвиться из адреса базы")
  assert.match(PAGE, /baseRegionName/, "название региона должно вычисляться")
})

test("грузы фильтруются по региону базы, а не берутся как есть", () => {
  // Фильтр именно по названию региона в поле «откуда»
  assert.match(
    PAGE,
    /from\.includes\(baseRegionName\.replace/,
    "груз должен отбираться по региону базы",
  )
  assert.match(PAGE, /regionLoads/, "должен появляться отфильтрованный список")
})

test("usableLoads читает отфильтрованный по региону список", () => {
  // Иначе фильтр существует, но на экран не влияет
  assert.match(PAGE, /regionLoads\.filter\(/, "цепочка грузов должна идти через regionLoads")
})

test("пустой регион — не тупик, а кнопка «собрать биржу региона»", () => {
  assert.match(PAGE, /regionEmpty/, "признак пустого региона должен быть")
  assert.match(
    PAGE,
    /Собрать биржу \$\{baseRegionName/,
    "экран должен предлагать собрать биржу региона",
  )
  assert.match(PAGE, /onHarvestRegion/, "кнопка должна запускать сбор региона")
})

test("экран честно говорит, почему чужие регионы не показываются", () => {
  assert.match(
    PAGE,
    /компании из Ярославля не нужен груз из\s+Новосибирска/,
    "причина должна быть объяснена словами",
  )
})

test("десктопная карточка заказа умеет показать контакт фрахтователя", () => {
  const process = readFileSync(join(ROOT, "components/orders/order-process.tsx"), "UTF8")
  assert.match(process, /\/api\/ati\/loads\/contacts/, "десктоп должен звать тот же роут")
  assert.match(process, /showContacts/, "должна быть функция показа")
  assert.match(process, /Показать контакты/, "кнопка должна быть подписана")
})

// scripts/acceptance-geocode-run.cjs
//
// Живая проверка геокодера через настоящие API приложения (без заглушек).
// Проверяет то, что нельзя проверить юнит-тестами: реальный Nominatim,
// реальный Яндекс, реальный кеш GeoCache и реальный ответ движка рейса.
//
// Запуск: node scripts/acceptance-geocode-run.cjs
const BASE = "http://localhost:3000"
const fs = require("node:fs")
const { PrismaClient } = require("@prisma/client")
const p = new PrismaClient()

const ORG = "cmv5l2v5l00007azufj22kezb"
const ROUTE = "acc-geo-check"

const jar = new Map()
function absorb(res) {
  const raw = res.headers.get("set-cookie")
  if (!raw) return
  for (const part of raw.split(/,(?=[^;]+?=)/)) {
    const [pair] = part.split(";")
    const i = pair.indexOf("=")
    if (i > 0) {
      const n = pair.slice(0, i).trim()
      const v = pair.slice(i + 1).trim()
      if (v === "") jar.delete(n)
      else jar.set(n, v)
    }
  }
}
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ")
let CSRF = ""

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": CSRF, cookie: cookieHeader() },
    body: JSON.stringify(body),
  })
  absorb(res)
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
async function get(path) {
  const res = await fetch(BASE + path, { headers: { cookie: cookieHeader() } })
  absorb(res)
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

const BOGUS = "Хреново-Никудаево, несуществующая область, Нетакаяландия"

async function makeRoute(legs) {
  await p.etaForecast.deleteMany({ where: { routeId: ROUTE } })
  await p.routeStage.deleteMany({ where: { routeId: ROUTE } })
  await p.routeEvent.deleteMany({ where: { routeId: ROUTE } })
  await p.route.deleteMany({ where: { id: ROUTE } })
  await p.order.deleteMany({ where: { routeId: ROUTE } })
  // id заказов делаем уникальными на вызов: deleteMany выше срабатывает
  // асинхронно относительно Prisma-клиента, и повторный id даёт конфликт
  const tag = Date.now().toString(36)
  await p.route.create({ data: { id: ROUTE, organizationId: ORG, driverId: "demo-driver-4", status: "active" } })
  for (const [i, leg] of legs.entries()) {
    await p.order.create({
      data: {
        id: `${ROUTE}-${i}-${tag}`, organizationId: ORG, routeId: ROUTE, routeSequence: i + 1,
        source: "manual", deadline: new Date(Date.now() + 3 * 86400000),
        routeFrom: leg[0], routeTo: leg[1], status: "assigned",
        distance: 0, weight: 10, price: 50000, cargoType: "Груз", clientContact: "",
        assignedDriverId: "demo-driver-4",
      },
    })
  }
}

;(async () => {
  const env = fs.readFileSync(".env", "utf8")
  const adminPw = env.match(/^ADMIN_PASSWORD="(.*)"$/m)[1]
  const csrfRes = await fetch(BASE + "/api/auth/csrf")
  absorb(csrfRes)
  CSRF = (await csrfRes.json()).csrfToken
  const login = await post("/api/auth/login", { email: "admin@loginex.local", password: adminPw })
  if (!login.json.success) throw new Error("вход логиста не удался")
  console.log("вход логиста: OK\n")

  // ── А. Успешный поиск: все точки геокодируются ──────────────────────────
  await makeRoute([["Владимир, Владимирская область, Россия", "Нижний Новгород, Нижегородская область, Россия"]])
  const ok = await get(`/api/routes/${ROUTE}/trip`)
  const okLegs = (ok.json.stages || []).filter((s) => s.kind === "driving" || s.kind === "return_to_base")
  console.log("── А. УСПЕШНЫЙ ПОИСК ──")
  console.log("  HTTP", ok.status, "| плеч:", okLegs.length,
    "| allLegsGeocoded:", ok.json.dataQuality.allLegsGeocoded)
  console.log("  routing:", ok.json.sources.routing)
  console.log("  сумма плеч:", Math.round(okLegs.reduce((a, s) => a + (s.distanceM || 0), 0)), "м")
  console.log("  предупреждения геокодера:",
    (ok.json.dataQuality.warnings || []).filter((w) => /координат/i.test(w)).length, "шт.")

  // ── Б. Несуществующий адрес: не получает произвольных координат ─────────
  await makeRoute([["Владимир, Владимирская область, Россия", BOGUS]])
  const bad = await get(`/api/routes/${ROUTE}/trip`)
  console.log("\n── Б. НЕСУЩЕСТВУЮЩИЙ АДРЕС ──")
  console.log("  HTTP", bad.status, "| allLegsGeocoded:", bad.json.dataQuality.allLegsGeocoded)
  const badLegs = (bad.json.stages || []).filter((s) => s.kind === "driving" || s.kind === "return_to_base")
  console.log("  плеч построено:", badLegs.length,
    "| ни одно не начинается/кончается в точке БОГУС-адреса:",
    badLegs.every((s) => !String(s.address).includes("Хреново")))
  console.log("  предупреждения:", JSON.stringify(bad.json.dataQuality.warnings, null, 4))

  // Кеш не должен содержать вымышленных координат
  const cached = await p.geoCache.findMany({ where: { address: { contains: "хреново" } } })
  console.log("  строк в GeoCache по этому адресу:", cached.length,
    cached.length === 0 ? "(вымышленные координаты не сохранены)" : JSON.stringify(cached))

  // ── В. Частичный отказ: неразрешившиеся адреса перечислены ──────────────
  await makeRoute([
    ["Владимир, Владимирская область, Россия", "Нижний Новгород, Нижегородская область, Россия"],
    ["Нижний Новгород, Нижегородская область, Россия", BOGUS],
    ["Чебоксары, Чувашская Республика, Россия", "Казань, Республика Татарстан, Россия"],
  ])
  const partial = await get(`/api/routes/${ROUTE}/trip`)
  console.log("\n── В. ЧАСТИЧНЫЙ ОТКАЗ (2 из 3 заказов, 1 битый) ──")
  console.log("  HTTP", partial.status, "| allLegsGeocoded:", partial.json.dataQuality.allLegsGeocoded)
  const warns = partial.json.dataQuality.warnings || []
  const geoWarn = warns.filter((w) => /координат/i.test(w))
  console.log("  предупреждение геокодера:", geoWarn.length, "шт.")
  for (const w of geoWarn) console.log("    •", w)
  console.log("  неразрешившийся адрес назван:", geoWarn.some((w) => w.includes("Хреново")))
  console.log("  все 3 заказа учтены в счётчике:", geoWarn.some((w) => /из 3/.test(w)))

  // ── Г. Убираем битый заказ — флаг снова честный ─────────────────────────
  await makeRoute([
    ["Владимир, Владимирская область, Россия", "Нижний Новгород, Нижегородская область, Россия"],
    ["Нижний Новгород, Нижегородская область, Россия", "Чебоксары, Чувашская Республика, Россия"],
  ])
  const fixed = await get(`/api/routes/${ROUTE}/trip`)
  console.log("\n── Г. ПОСЛЕ ИСПРАВЛЕНИЯ АДРЕСА ──")
  console.log("  allLegsGeocoded:", fixed.json.dataQuality.allLegsGeocoded,
    "| предупреждений геокодера:",
    (fixed.json.dataQuality.warnings || []).filter((w) => /координат/i.test(w)).length)

  // уборка
  await p.etaForecast.deleteMany({ where: { routeId: ROUTE } })
  await p.routeStage.deleteMany({ where: { routeId: ROUTE } })
  await p.routeEvent.deleteMany({ where: { routeId: ROUTE } })
  await p.route.deleteMany({ where: { id: ROUTE } })
  await p.order.deleteMany({ where: { routeId: ROUTE } })
  console.log("\nтестовый рейс", ROUTE, "удалён")
  await p.$disconnect()
})().catch(async (e) => {
  console.error("ERR", e.message)
  await p.$disconnect()
  process.exit(1)
})

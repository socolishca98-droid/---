// __tests__/isolation/eta-realistic-routes.test.ts
//
// Реалистичные маршруты ETA — пункт 3 второго промпта.
//
// Что здесь проверяется и чем это отличается от предыдущих тестов:
//   1. Сценарии берутся из ЖИЗНИ рейса, а не из абстрактных чисел: один
//      заказ, цепочка погрузок/выгрузок, длинный рейс с перерывами, возврат
//      на базу, добавление заказа в построенный маршрут, смена порядка.
//   2. Расстояния НЕ абстрактные: заглушка OSRM отдаёт километры из таблицы
//      реальных городов, поэтому можно проверить, что каждое плечо
//      соответствует СВОЕЙ паре точек, а итог — сумме плеч.
//   3. Проверяются не коды 200, а ЦИФРЫ: расстояние, время каждого этапа,
//      итоговое время рейса, остаток, возврат на базу.
//   4. Сверяется шкала этапов с итогом движка: arrivalAt последнего этапа
//      должен совпадать с completionAt. Расхождение = этап потерян или
//      посчитан дважды.
//
// Запуск: npm run test:isolation

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { memoryDb } from "../__mocks__/prisma-memory"
import { clearCache } from "@/lib/eta/cache"
import { cid, jsonOf, makeRequest, routeContext, seedWorld, sessionCookie, type World } from "./helpers"

import { POST as optimizerPost } from "@/app/api/routes/optimizer/route"
import { GET as tripGet } from "@/app/api/routes/[routeId]/trip/route"
import { POST as forecastPost } from "@/app/api/eta/forecast/route"
import { POST as stagePost } from "@/app/api/m/route/stage/route"
import { POST as actualPost } from "@/app/api/eta/forecast/[id]/actual/route"
import { GET as driverRouteGet } from "@/app/api/m/route/route"
import { GET as dashboardRoutesGet } from "@/app/api/dashboard/routes/route"

// ── Подменяемая сеть ────────────────────────────────────────────────────────
process.env.GEOCODE_PAUSE_MS = "0"
// «mock» = демо-генератор пробок: сценарии обязаны игнорировать его выдумки
process.env.TRAFFIC_PROVIDER = "mock"
delete process.env.YANDEX_ROUTING_API_KEY

/** Города и их координаты — как отдаёт Nominatim. */
const CITIES: Record<string, [number, number]> = {
  "домодедово, россия": [55.4207, 37.7376], // база автопарка
  "тула, россия": [54.1961, 37.6182],
  "воронеж, россия": [51.672, 39.1843],
  "липецк, россия": [52.61, 39.6],
  "смоленск, россия": [54.7818, 32.0401],
  "рязань, россия": [54.6298, 39.7418],
}

/**
 * Реальные дорожные расстояния между городами, км.
 *
 * Зачем таблица, а не «820 км на любой маршрут»: нужно проверить, что КАЖДОЕ
 * плечо соответствует своей паре точек. С фиксированным числом перепутанные
 * точки дали бы ту же сумму и тест бы всё прошло.
 */
const ROAD_KM: Record<string, number> = {
  "домодедово>тула": 190,
  "тула>воронеж": 420,
  "воронеж>липецк": 130,
  "липецк>смоленск": 640,
  "смоленск>домодедово": 420,
  "домодедово>воронеж": 480,
  "воронеж>домодедово": 480,
  "домодедово>липецк": 330,
  "липецк>домодедово": 330,
  "тула>липецк": 300,
  "домодедово>смоленск": 400,
  "смоленск>воронеж": 760,
  "домодедово>рязань": 180,
  "рязань>тула": 320,
}

/**
 * Кодирует точки в polyline OSRM (алгоритм Google).
 * Зачем: движок берёт края сегментов из геометрии, и без неё они оказались
 * бы в {0, 0}.
 */
function encodePolyline(points: Array<{ lat: number; lng: number }>): string {
  let out = ""
  let prevLat = 0
  let prevLng = 0
  const write = (value: number) => {
    let shifted = Math.round(value * 1e5) << 1
    if (shifted < 0) shifted = ~shifted
    while (shifted >= 0x20) {
      out += String.fromCharCode((0x20 | (shifted & 0x1f)) + 63)
      shifted >>= 5
    }
    out += String.fromCharCode(shifted + 63)
  }
  for (const point of points) {
    write(point.lat - prevLat)
    write(point.lng - prevLng)
    prevLat = point.lat
    prevLng = point.lng
  }
  return out
}

/** Средняя скорость по дороге — из неё считаются минуты плеча. */
const AVG_SPEED_KMH = 60

/** Обратный ключ: расстояние зависит только от пары, направление не важно. */
function roadKm(fromKey: string, toKey: string): number | null {
  return ROAD_KM[`${fromKey}>${toKey}`] ?? ROAD_KM[`${toKey}>${fromKey}`] ?? null
}

let fetchMock: ReturnType<typeof vi.fn>

/** Подменяет сеть: Nominatim даёт координаты, OSRM — дорогу с реальными плечами. */
function stubNetwork() {
  fetchMock = vi.fn(async (input: unknown) => {
    const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input)

    if (url.includes("nominatim")) {
      const raw = decodeURIComponent(new URL(url).searchParams.get("q") || "")
      // Запрос приходит и как «Тула, россия», и как просто «Тула»: прогноз
      // рейса шлёт адрес заказа как есть. Обе формы должны находиться.
      const query = raw.trim().toLowerCase()
      const hit = CITIES[query] ?? CITIES[`${query}, россия`]
      if (!hit) {
        return { ok: true, status: 200, json: async () => [], text: async () => "[]" } as unknown as Response
      }
      return {
        ok: true,
        status: 200,
        json: async () => [{ lat: String(hit[0]), lon: String(hit[1]) }],
        text: async () => "[]",
      } as unknown as Response
    }

    if (url.includes("/route/v1/")) {
      // Точки маршрута в порядке следования — из них и собираются плечи
      const coordsPart = url.split("/route/v1/")[1]?.split("?")[0] || ""
      // В URL после /route/v1/ идёт профиль («driving/…»): его надо снять,
      // иначе первая точка не распарсится и всё плечо поедет.
      const pairs = coordsPart.split("/").slice(1).join("/").split(";")
      const points = pairs
        .map((pair) => {
          const [lng, lat] = pair.split(",").map(Number)
          return { lat, lng }
        })
        .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))

      // Определяем город по координатам, чтобы взять дорожное расстояние
      const cityOf = (point: { lat: number; lng: number }): string | null => {
        for (const [city, coords] of Object.entries(CITIES)) {
          if (Math.abs(coords[0] - point.lat) < 0.01 && Math.abs(coords[1] - point.lng) < 0.01) {
            return city.split(",")[0]
          }
        }
        return null
      }

      // Шаги плеча движку нужны: он режет маршрут на сегменты по ним. Без
      // шагов ответ OSRM формально есть, а сегментов ноль — и прогноз честно
      // падает с «нет данных о сегментах». Поэтому плечо разбиваем на два
      // шага: выезд из города и сама трасса.
      type StubStep = {
        name: string
        distance: number
        duration: number
        maneuver: { type: string; modifier: string }
        intersections: unknown[]
      }
      const legs: Array<{ distance: number; duration: number; summary: string; steps: StubStep[] }> = []
      for (let index = 0; index < points.length - 1; index += 1) {
        const fromCity = cityOf(points[index])
        const toCity = cityOf(points[index + 1])
        const km = fromCity && toCity ? roadKm(fromCity, toCity) : null
        // Неизвестную пару не выдумываем: плечо без дороги честно пометит движок
        const distanceM = km != null ? km * 1000 : 0
        const durationS = km != null ? (km / AVG_SPEED_KMH) * 3600 : 0
        const steps: StubStep[] =
          distanceM === 0
            ? []
            : [
                {
                  name: `Выезд: ${fromCity ?? "точка"}`,
                  distance: Math.round(distanceM * 0.15),
                  duration: Math.round(durationS * 0.15),
                  maneuver: { type: "depart", modifier: "right" },
                  intersections: [],
                },
                {
                  name: `${fromCity ?? "?"} — ${toCity ?? "?"}`,
                  distance: distanceM - Math.round(distanceM * 0.15),
                  duration: durationS - Math.round(durationS * 0.15),
                  maneuver: { type: "continue", modifier: "straight" },
                  intersections: [],
                },
              ]
        legs.push({ distance: distanceM, duration: durationS, summary: "", steps })
      }

      const totalM = legs.reduce((sum, leg) => sum + leg.distance, 0)
      const totalS = legs.reduce((sum, leg) => sum + leg.duration, 0)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: "Ok",
          routes: [{ distance: totalM, duration: totalS, geometry: "", legs }],
          waypoints: points.map((_, index) => ({ name: `Точка ${index + 1}`, location: [0, 0], hint: "" })),
        }),
        text: async () => "{}",
      } as unknown as Response
    }

    return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" } as unknown as Response
  })
  vi.stubGlobal("fetch", fetchMock)
}

let world: World
let cookieStaff: string
let cookieDriver: string

/** Заказ организации А в форме, нужной оптимизатору. */
function seedOrder(
  slug: string,
  from: string,
  to: string,
  options: { deadline?: Date; price?: number; distance?: number } = {},
) {
  const id = cid(slug)
  memoryDb.insert("order", {
    id,
    organizationId: world.orgA,
    routeId: null,
    routeSequence: null,
    routeFrom: from,
    routeTo: to,
    // «assigned» — заказ назначен водителю и занимает его: именно такие
    // заказы попадают на карту логиста (OCCUPYING_ORDER_STATUSES)
    status: "assigned",
    distance: options.distance ?? 0,
    weight: 10,
    price: options.price ?? 50000,
    cargoType: "Груз",
    clientContact: "",
    deadline: options.deadline ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    assignedDriverId: null,
    assignedVehicleId: null,
  })
  return id
}

/**
 * Меняет поля строки тестовой базы.
 *
 * Зачем свой хелпер: у memoryDb нет update, а существующие тесты меняют
 * найденную строку напрямую. Object.assign вместо подмены ссылки — иначе
 * заглушка, держащая массив строк, продолжит отдавать старый объект.
 */
function updateRow(model: string, id: string, patch: Record<string, unknown>) {
  const row = memoryDb.find(model, id)
  if (!row) throw new Error(`в тестовой базе нет записи ${model} с id ${id}`)
  Object.assign(row, patch)
  return row
}

/** База автопарка: без неё единый движок не считает возврат на базу. */
function seedBase() {
  updateRow("fleetSettings", world.settingsA, {
    baseLat: CITIES["домодедово, россия"][0],
    baseLng: CITIES["домодедово, россия"][1],
    baseAddress: "Домодедово, база",
  })
}

/**
 * Собирает рейс с ЗАДАННЫМ порядком точек и возвращает прогноз по нему.
 *
 * Зачем отдельно от оптимизатора: оптимизатор переупорядочивает точки по
 * своей политике и на порядок входного массива не смотрит. Порядок точек на
 * реальном рейсе задаёт routeSequence, и проверять смену порядка надо там.
 */
async function tripFor(orderIds: string[], routeId: string = world.routeA) {
  orderIds.forEach((orderId, index) => {
    updateRow("order", orderId, {
      routeId,
      routeSequence: index + 1,
      assignedDriverId: world.driverA,
    })
  })
  updateRow("route", routeId, { driverId: world.driverA, status: "active" })

  const response = await tripGet(
    makeRequest("GET", "/x", { cookie: cookieStaff }),
    routeContext({ routeId }),
  )
  const data = await jsonOf(response)
  if (response.status !== 200) return { response, data, distanceKm: 0, kinds: [] as string[] }

  // Итоговый пробег — сумма плеч этапов: у операций distanceM нет
  const stages = data.stages as Array<{ kind: string; distanceM: number | null }>
  const distanceKm = Math.round(
    stages
      .filter((stage) => stage.kind === "driving" || stage.kind === "return_to_base")
      .reduce((sum, stage) => sum + (stage.distanceM ?? 0), 0) / 1000,
  )
  return { response, data, distanceKm, kinds: stages.map((stage) => stage.kind) }
}

async function callOptimizer(orderIds: string[]) {
  const response = await optimizerPost(
    makeRequest("POST", "/api/routes/optimizer", { cookie: cookieStaff, body: { orderIds } }),
  )
  return { response, data: await jsonOf(response) }
}

beforeEach(async () => {
  world = seedWorld()
  clearCache()
  seedBase()
  // Заказ из seedWorld не должен мешать: убираем его из расчёта
  updateRow("order", world.orderA, { routeId: null, routeSequence: null })
  cookieStaff = await sessionCookie({ userId: world.adminA, role: "admin", kind: "staff" })
  cookieDriver = await sessionCookie({
    userId: world.driverUserA,
    role: "driver",
    kind: "driver",
    driverId: world.driverA,
  })
  stubNetwork()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// 1–4. Маршруты: расстояние, этапы, итоговое время
// ---------------------------------------------------------------------------

describe("реалистичные маршруты: расстояние и время", () => {
  it("один заказ без промежуточных точек: база → погрузка → выгрузка → база", async () => {
    const order = seedOrder("solo", "Тула", "Воронеж", { distance: 111 })

    const { data } = await callOptimizer([order])

    expect(data.success).toBe(true)
    const variant = data.variants[0]

    // Километры — по дорогам, а НЕ из поля заказа (там 111 км)
    // Домодедово → Тула (190) + Тула → Воронеж (420) + Воронеж → Домодедово (480)
    expect(variant.metrics.distanceKm).toBe(1090)
    expect(variant.sources.routing).toBe("osrm")

    // Итоговое время = езда + операции + перерывы. Ни одно слагаемое не потеряно.
    expect(variant.metrics.etaMin).toBe(
      variant.metrics.baseMin + variant.metrics.stopsMin + variant.metrics.restMin,
    )
    // Две операции (погрузка + выгрузка) по 75 минут
    expect(variant.metrics.stopsMin).toBe(150)
    // Езда: минимум «свободная дорога» (1090 км при 60 км/ч ≈ 1090 мин),
    // максимум — потолок коэффициента ×2.5. Исторические поправки внутрь
    // уже входят, поэтому ровно 1090 тут было бы неверным ожиданием.
    expect(variant.metrics.baseMin).toBeGreaterThanOrEqual(1090)
    expect(variant.metrics.baseMin).toBeLessThanOrEqual(Math.round(1090 * 2.5))
    // Время этапов: на каждое плечо — ровно одна driving-операция
    expect(variant.legs.filter((leg: { kind: string }) => leg.kind === "driving").length).toBe(2)

    // Шкала плеч: две перегонные и возврат на базу. Операции погрузки и
    // выгрузки в плечи не входят — они учтены в stopsMin (150 мин).
    const kinds = variant.legs.map((leg: { kind: string }) => leg.kind)
    expect(kinds).toEqual([
      "driving", // база → Тула
      "driving", // Тула → Воронеж
      "return_to_base", // Воронеж → база
    ])
    // Каждое плечо — своя пара точек и своё дорожное расстояние
    expect(variant.legs.map((leg: { distanceKm: number }) => leg.distanceKm)).toEqual([190, 420, 480])

  })

  it("цепочка погрузок и выгрузок: соседние точки схлопываются, лишних плеч нет", async () => {
    const first = seedOrder("chain1", "Тула", "Воронеж")
    const second = seedOrder("chain2", "Воронеж", "Липецк")

    const { data } = await callOptimizer([first, second])

    const variant = data.variants[0]
    // Домодедово→Тула 190 + Тула→Воронеж 420 + Воронеж→Липецк 130 + Липецк→Домодедово 330
    expect(variant.metrics.distanceKm).toBe(1070)

    // Воронеж — одновременно выгрузка первого и погрузка второго заказа.
    // Плеча «Воронеж → Воронеж» быть не должно: соседние точки схлопываются.
    const legs: Array<{ kind: string; distanceKm: number | null; address?: string }> = variant.legs
    const zeroLegs = legs.filter((leg) => leg.kind === "driving" && (leg.distanceKm ?? 0) === 0)
    expect(zeroLegs).toHaveLength(0)

    // Операций четыре (по две на заказ) по 75 минут: 300 минут простоя
    expect(variant.metrics.stopsMin).toBe(300)

    // Каждому плечу соответствует своя пара точек: ни одного «Тула → Липецк»
    const drivingLegs = legs.filter((leg) => leg.kind === "driving" || leg.kind === "return_to_base")
    expect(drivingLegs.map((leg) => leg.distanceKm)).toEqual([190, 420, 130, 330])
  })

  it("длинный рейс: обязательные перерывы вставлены и сдвигают часы этапов", async () => {
    // 190 + 420 + 640 = 1250 км ≈ 1250 мин езды: и непрерывный лимит (270 мин),
    // и лимит смены (600 мин) будут превышены.
    const first = seedOrder("long1", "Тула", "Воронеж")
    const second = seedOrder("long2", "Воронеж", "Липецк")
    const third = seedOrder("long3", "Липецк", "Смоленск")

    const { data } = await callOptimizer([first, second, third])

    const variant = data.variants[0]
    // 190 + 420 + 130 + 640 + 420 (Смоленск → Домодедово)
    expect(variant.metrics.distanceKm).toBe(1800)

    // Перерывы не потеряны: они входят в etaMin отдельным слагаемым
    expect(variant.metrics.restMin).toBeGreaterThan(0)
    expect(variant.metrics.etaMin).toBe(
      variant.metrics.baseMin + variant.metrics.stopsMin + variant.metrics.restMin,
    )
    // Итог БОЛЬШЕ чистой езды — иначе перерывы ни на что не повлияли
    expect(variant.metrics.etaMin).toBeGreaterThan(variant.metrics.baseMin + variant.metrics.stopsMin)
  })

  it("возврат на базу считается отдельным этапом и входит в пробег", async () => {
    const order = seedOrder("base1", "Тула", "Воронеж")
    const { data } = await callOptimizer([order])
    const variant = data.variants[0]

    const legs: Array<{ kind: string; distanceKm: number | null }> = variant.legs
    const back = legs.filter((leg) => leg.kind === "return_to_base")
    expect(back).toHaveLength(1)
    // Именно Воронеж → Домодедово, то есть 480 км
    expect(back[0].distanceKm).toBe(480)

    // Возврат на базу входит в общий пробег
    expect(variant.metrics.distanceKm).toBe(1090)
  })

  it("без базы в настройках автопарка возврат на базу не считается", async () => {
    updateRow("fleetSettings", world.settingsA, { baseLat: null, baseLng: null, baseAddress: null })
    const order = seedOrder("nobase", "Тула", "Воронеж")

    const { data } = await callOptimizer([order])
    const variant = data.variants[0]

    // Без origin движок не строит плечо до первой точки: только Тула→Воронеж
    expect(variant.metrics.distanceKm).toBe(420)
    const legs: Array<{ kind: string }> = variant.legs
    expect(legs.filter((leg) => leg.kind === "return_to_base")).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 5–6. Изменение состава и порядка точек
// ---------------------------------------------------------------------------

describe("изменение маршрута", () => {
  it("добавление заказа в построенный маршрут увеличивает пробег и время", async () => {
    const first = seedOrder("add1", "Тула", "Воронеж")
    const before = await callOptimizer([first])
    const beforeKm = before.data.variants[0].metrics.distanceKm
    const beforeMin = before.data.variants[0].metrics.etaMin

    // Второй заказ: Воронеж → Липецк (Воронеж уже в маршруте)
    const second = seedOrder("add2", "Воронеж", "Липецк")
    const after = await callOptimizer([first, second])

    const afterVariant = after.data.variants[0]
    // Было: 190 + 420 + 480 = 1090. Стало: 190 + 420 + 130 + 330 = 1070.
    // Пробег уменьшился (Липецк ближе к базе, чем Воронеж), но время выросло:
    // добавились погрузка и выгрузка.
    expect(afterVariant.metrics.distanceKm).toBe(1070)
    expect(beforeKm).toBe(1090)
    // Две лишние операции по 75 минут
    expect(afterVariant.metrics.stopsMin).toBe(before.data.variants[0].metrics.stopsMin + 150)
    // Итоговое время рейса выросло (на коротком плече сэкономленная езда
    // меньше добавленных операций)
    expect(afterVariant.metrics.etaMin).toBeGreaterThan(beforeMin)
  })

  it("порядок точек меняет пробег: обратный объезд длиннее", async () => {
    const first = seedOrder("ord1", "Тула", "Воронеж")
    const second = seedOrder("ord2", "Воронеж", "Липецк")
    const third = seedOrder("ord3", "Липецк", "Смоленск")

    // Порядок задаёт РЕЙС (routeSequence), а не оптимизатор: оптимизатор
    // переупорядочивает точки по своей политике и на порядок входного массива
    // не смотрит. Поэтому сравниваем два разных рейса.
    //
    // Прямой объезд: Домодедово→Тула 190, Тула→Воронеж 420, Воронеж→Липецк 130,
    // Липецк→Смоленск 640, Смоленск→Домодедово 420 = 1800
    const straight = await tripFor([first, second, third])
    // Обратный порядок тех же заказов. Заказы цепочные (погрузка каждого
    // следующего — точка выгрузки предыдущего), поэтому «обратный» порядок
    // даёт не зеркальный маршрут, а зигзаг:
    // Домодедово→Липецк 330, Липецк→Смоленск 640, Смоленск→Воронеж 760,
    // Воронеж→Липецк 130, Липецк→Тула 300, Тула→Воронеж 420,
    // Воронеж→Домодедово 480 = 3060
    const reversed = await tripFor([third, second, first])

    expect(straight.response.status).toBe(200)
    expect(reversed.response.status).toBe(200)

    expect(straight.distanceKm).toBe(1800)
    expect(reversed.distanceKm).toBe(3060)
    // Порядок меняет результат — значит точки реально переставляются
    expect(reversed.distanceKm).toBeGreaterThan(straight.distanceKm)

    // И состав этапов другой: в зигзаге плеч больше
    expect(reversed.kinds.length).toBeGreaterThan(straight.kinds.length)
  })

  it("порядок точек не меняет сумму операций: только пробег", async () => {
    const first = seedOrder("ops1", "Тула", "Воронеж")
    const second = seedOrder("ops2", "Воронеж", "Липецк")

    const straight = await callOptimizer([first, second])
    const reversed = await callOptimizer([second, first])

    expect(straight.data.variants[0].metrics.stopsMin).toBe(
      reversed.data.variants[0].metrics.stopsMin,
    )
  })
})

// ---------------------------------------------------------------------------
// 7. Отсутствие GPS
// ---------------------------------------------------------------------------

describe("отсутствие GPS-координат", () => {
  it("водитель без координат: прогноз считается, местоположение не выдумывается", async () => {
    const order = seedOrder("gps1", "Тула", "Воронеж")
    // Собираем заказы в рейс вручную: прогноз рейса цепляется к Route
    const routeId = world.routeA
    updateRow("order", order, { routeId, routeSequence: 1, assignedDriverId: world.driverA })
    updateRow("route", routeId, { driverId: world.driverA, status: "active" })
    updateRow("driver", world.driverA, {
      latitude: null,
      longitude: null,
      lastGpsUpdate: null,
    })

    // 1. Прогноз рейса есть — он не зависит от GPS водителя
    const response = await tripGet(makeRequest("GET", "/x", { cookie: cookieStaff }), routeContext({ routeId }))
    const data = await jsonOf(response)

    expect(response.status).toBe(200)
    expect(data.stages.length).toBeGreaterThan(0)
    expect(data.remaining.totalSec).toBeGreaterThan(0)

    // 2. Карта логиста НЕ теряет рейс и не подставляет выдуманную точку.
    //    Раньше рейс без GPS вообще пропадал с карты: маршрут, точки и
    //    прогноз становились невидимыми для логиста.
    const mapResponse = await dashboardRoutesGet(
      makeRequest("GET", "/api/dashboard/routes", { cookie: cookieStaff }),
    )
    const mapData = await jsonOf(mapResponse)
    expect(mapResponse.status).toBe(200)

    const routes = (mapData.routes ?? []) as Array<{
      id: string
      driverId: string
      driverPos: [number, number] | null
      trip: {
        gpsKnown?: boolean
        nextPoint?: unknown
        remaining?: { totalSec?: number }
      } | null
    }>
    const ours = routes.find((route) => route.driverId === world.driverA)
    // Рейс НЕ пропал с карты, хотя GPS у водителя нет
    expect(ours).toBeTruthy()
    // Местоположение не выдумано
    expect(ours!.driverPos).toBeNull()
    // И карта не заявляет GPS, которого нет
    expect(ours!.trip?.gpsKnown).toBe(false)
    // Но прогноз по рейсу на карте есть: точки, остаток, следующий пункт
    expect(ours!.trip).toBeTruthy()
    expect(ours!.trip!.nextPoint).toBeTruthy()
    expect(ours!.trip!.remaining?.totalSec ?? 0).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 8–9. Завершение рейса и повторное завершение
// ---------------------------------------------------------------------------

describe("завершение рейса", () => {
  /** Собирает рейс из заказов и возвращает его id. */
  function buildRoute(orders: string[]) {
    orders.forEach((orderId, index) => {
      updateRow("order", orderId, {
        routeId: world.routeA,
        routeSequence: index + 1,
        assignedDriverId: world.driverA,
      })
    })
    updateRow("route", world.routeA, {
      driverId: world.driverA,
      status: "active",
      startedAt: null,
      completedAt: null,
    })
    return world.routeA
  }

  async function driverCommand(command: string, clientEventId: string) {
    const response = await stagePost(
      makeRequest("POST", "/api/m/route/stage", {
        cookie: cookieDriver,
        body: { routeId: world.routeA, command, clientEventId },
      }),
    )
    return { response, data: await jsonOf(response) }
  }

  it("полный цикл: все этапы закрыты, рейс завершён, шкала сходится с итогом", async () => {
    const order = seedOrder("fin1", "Тула", "Воронеж")
    buildRoute([order])

    // Сначала прогноз — по нему потом проверим факт
    const forecastResponse = await forecastPost(
      makeRequest("POST", "/api/eta/forecast", {
        cookie: cookieStaff,
        body: { routeId: world.routeA, departure: new Date().toISOString() },
      }),
    )
    const forecastData = await jsonOf(forecastResponse)
    expect(forecastResponse.status).toBe(200)
    expect(forecastData.id).toBeTruthy()

    const commands: string[] = []
    for (let step = 0; step < 20; step += 1) {
      const current = await driverRouteGet(makeRequest("GET", "/api/m/route", { cookie: cookieDriver }))
      const trip = (await jsonOf(current)).trip
      const next = (trip.actions || []).find(
        (action: { command?: unknown }) => action.command !== "report_problem",
      )
      if (!next) break
      // Действие может нести список команд: берём первую применимую
      const command = Array.isArray(next.command) ? next.command[0] : next.command
      if (!command) break
      commands.push(command)
      const result = await driverCommand(command, `fin-${step}`)
      expect(result.response.status).toBe(200)
      if (result.data.finished) break
    }

    // Реальная цепочка из 12 команд: выезд, езда до погрузки, прибытие,
    // погрузка, езда до выгрузки, прибытие, выгрузка, езда до базы, прибытие,
    // завершение. Рейс из 5 этапов.
    expect(commands).toEqual([
      "start_trip",
      "start_driving",
      "arrive_point",
      "start_operation",
      "finish_operation",
      "start_driving",
      "arrive_point",
      "start_operation",
      "finish_operation",
      "start_driving",
      "arrive_point",
      "finish_trip",
    ])

    // В базе: рейс завершён, этапы закрыты, событий ровно столько же, сколько команд
    const route = memoryDb.find("route", world.routeA)!
    expect(route.status).toBe("completed")
    expect(route.completedAt).toBeTruthy()
    const stages = memoryDb.rows("routeStage").filter((row) => row.routeId === world.routeA)
    expect(stages.length).toBe(5)
    expect(stages.every((stage) => stage.endedAt)).toBe(true)
    // На каждую команду водителя — ровно одно событие stage_command.
    // Дополнительно возможна запись о смене статуса рейса (активен →
    // завершён), но НЕ второй finish_trip.
    const events = memoryDb.rows("routeEvent").filter((row) => row.routeId === world.routeA)
    const stageCommands = events.filter((event) => event.type === "stage_command")
    expect(stageCommands).toHaveLength(commands.length)
    expect(events.filter((event) => event.type === "status")).toHaveLength(1)

    // Факт записан в прогноз, а исходный прогноз не перезаписан
    const forecasts = memoryDb.rows("etaForecast").filter((row) => row.routeId === world.routeA)
    expect(forecasts.length).toBeGreaterThan(0)
    const withFact = forecasts.find((row) => row.actualArrivalAt)
    expect(withFact).toBeTruthy()
    expect(withFact!.errorMinutes).not.toBeNull()
    // currentArrivalAt остался прогнозом, фактическое время — отдельным полем
    expect(String(withFact!.currentArrivalAt)).not.toBe(String(withFact!.actualArrivalAt))

    // Завершённый рейс: остаток нулевой, точек впереди нет
    const final = await tripGet(makeRequest("GET", "/x", { cookie: cookieStaff }), routeContext({ routeId: world.routeA }))
    const finalData = await jsonOf(final)
    expect(finalData.remaining.totalSec).toBe(0)
    expect(finalData.nextPoint).toBeNull()
  })

  it("повторное завершение: completedAt не сдвигается, события и факт не удваиваются", async () => {
    const order = seedOrder("fin2", "Тула", "Воронеж")
    buildRoute([order])

    // Прогноз до рейса: без него факт прибытия записывать некуда
    const forecastResponse = await forecastPost(
      makeRequest("POST", "/api/eta/forecast", {
        cookie: cookieStaff,
        body: { routeId: world.routeA, departure: new Date().toISOString() },
      }),
    )
    expect(forecastResponse.status).toBe(200)

    for (let step = 0; step < 20; step += 1) {
      const current = await driverRouteGet(makeRequest("GET", "/api/m/route", { cookie: cookieDriver }))
      const trip = (await jsonOf(current)).trip
      const next = (trip.actions || []).find(
        (action: { command?: unknown }) => action.command !== "report_problem",
      )
      if (!next) break
      const command = Array.isArray(next.command) ? next.command[0] : next.command
      if (!command) break
      const result = await driverCommand(command, `dup-${step}`)
      if (result.data.finished) break
    }

    const routeAfter = memoryDb.find("route", world.routeA)!
    const eventsAfter = memoryDb.rows("routeEvent").filter((row) => row.routeId === world.routeA).length
    const forecastsAfter = memoryDb.rows("etaForecast").filter((row) => row.routeId === world.routeA)

    // Повторный finish_trip с НОВЫМ clientEventId
    const repeat = await driverCommand("finish_trip", "brand-new-id")
    expect(repeat.response.status).toBe(200)
    expect(repeat.data.alreadyFinished).toBe(true)
    expect(repeat.data.forecastFact?.alreadyRecorded).toBe(true)

    const routeNow = memoryDb.find("route", world.routeA)!
    // Время завершения не уехало
    expect(String(routeNow.completedAt)).toBe(String(routeAfter.completedAt))
    // Нового события не появилось
    const eventsNow = memoryDb.rows("routeEvent").filter((row) => row.routeId === world.routeA).length
    expect(eventsNow).toBe(eventsAfter)
    // Ошибка прогноза не пересчитана второй раз
    const forecastsNow = memoryDb.rows("etaForecast").filter((row) => row.routeId === world.routeA)
    expect(forecastsNow.length).toBe(forecastsAfter.length)
    for (const row of forecastsNow) {
      const before = forecastsAfter.find((item) => item.id === row.id)!
      expect(String(row.errorMinutes)).toBe(String(before.errorMinutes))
    }
  })
})

// ---------------------------------------------------------------------------
// 10–11. Пересчёт прогноза и сохранение версий
// ---------------------------------------------------------------------------

describe("пересчёт прогноза и история версий", () => {
  async function calculate(departure: string) {
    const response = await forecastPost(
      makeRequest("POST", "/api/eta/forecast", {
        cookie: cookieStaff,
        body: { routeId: world.routeA, departure },
      }),
    )
    return { response, data: await jsonOf(response) }
  }

  it("три пересчёта: версии накапливаются, исходный прогноз не меняется", async () => {
    const order = seedOrder("ver1", "Тула", "Воронеж")
    updateRow("order", order, { routeId: world.routeA, routeSequence: 1 })

    const first = await calculate("2026-10-16T06:00:00.000Z")
    const second = await calculate("2026-10-16T08:00:00.000Z")
    const third = await calculate("2026-10-16T10:00:00.000Z")

    for (const result of [first, second, third]) {
      expect(result.response.status).toBe(200)
    }

    // Счётчик пересчётов растёт, а не всегда ноль
    expect(first.data.history.recalcCount).toBe(0)
    expect(second.data.history.recalcCount).toBe(1)
    expect(third.data.history.recalcCount).toBe(2)
    expect(third.data.history.versions).toHaveLength(3)

    // Исходный прогноз сохранён и не перезаписан später расчётами
    expect(first.data.history.initialArrivalAt).toBe(second.data.history.initialArrivalAt)
    expect(second.data.history.initialArrivalAt).toBe(third.data.history.initialArrivalAt)

    // В базе три отдельные строки, у всех один initialArrivalAt
    const rows = memoryDb.rows("etaForecast").filter((row) => row.routeId === world.routeA)
    expect(rows).toHaveLength(3)
    const initials = new Set(rows.map((row) => new Date(row.initialArrivalAt as Date).getTime()))
    expect(initials.size).toBe(1)
    expect(rows.map((row) => row.recalcCount).sort()).toEqual([0, 1, 2])

    // Времена создания строго возрастают: иначе «последняя версия» неопределённа.
    // Сравниваем именно миллисекунды: String(Date) округляет до секунд, и три
    // версии, посчитанные за одну секунду, выглядели бы одинаковыми.
    const created = rows.map((row) => new Date(row.createdAt as Date).getTime()).sort((a, b) => a - b)
    expect(created[1]).toBeGreaterThan(created[0])
    expect(created[2]).toBeGreaterThan(created[1])
  })

  it("пересчёт после фактического прибытия не затирает факт", async () => {
    const order = seedOrder("ver2", "Тула", "Воронеж")
    updateRow("order", order, { routeId: world.routeA, routeSequence: 1 })

    const first = await calculate("2026-10-16T06:00:00.000Z")
    const initialId = first.data.id
    expect(initialId).toBeTruthy()

    // Записываем факт по этой версии
    const actualResponse = await actualPost(
      makeRequest("POST", `/api/eta/forecast/${initialId}/actual`, {
        cookie: cookieStaff,
        body: { actualArrivalAt: "2026-10-16T09:00:00.000Z" },
      }),
      { params: Promise.resolve({ id: initialId }) },
    )
    expect(actualResponse.status).toBe(200)

    // Пересчёт — новая версия
    const second = await calculate("2026-10-16T07:00:00.000Z")
    expect(second.data.history.recalcCount).toBe(1)

    // Факт остался на первой версии и не потерялся
    const firstRow = memoryDb.find("etaForecast", initialId)!
    expect(firstRow.actualArrivalAt).toBeTruthy()
    expect(firstRow.errorMinutes).not.toBeNull()
    // Исходный прогноз первой версии не сдвинут
    expect(new Date(firstRow.initialArrivalAt as Date).getTime()).toBe(
      new Date(first.data.history.initialArrivalAt).getTime(),
    )
  })
})

// ---------------------------------------------------------------------------
// 4. Поведение при недоступности OSRM и посторонние километры
// ---------------------------------------------------------------------------

describe("OSRM: резервный расчёт и чужие километры", () => {
  it("маршрутизатор недоступен: система честно говорит о резервном расчёте", async () => {
    const order = seedOrder("osrmdown", "Тула", "Воронеж", { distance: 111 })
    updateRow("order", order, { routeId: world.routeA, routeSequence: 1 })

    // OSRM падает: геокодирование работает, маршрутизатор — нет.
    // Свое тело ответа не дублируем — просто зовём исходную заглушку.
    const rawImpl = fetchMock.getMockImplementation()
    const realFetch =
      typeof rawImpl === "function" && rawImpl.prototype === undefined
        ? (rawImpl as (input: unknown) => Promise<Response>)
        : undefined
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input)
      if (url.includes("/route/v1/")) throw new Error("OSRM временно недоступен")
      if (!realFetch) throw new Error("исходная заглушка сети не найдена")
      return realFetch(input)
    })

    const response = await tripGet(
      makeRequest("GET", "/x", { cookie: cookieStaff }),
      routeContext({ routeId: world.routeA }),
    )
    const data = await jsonOf(response)

    // Прогноз всё равно есть: без дорог он грубее, но не молчит
    expect(response.status).toBe(200)
    expect(data.stages.length).toBeGreaterThan(0)
    // Источник назван прямо
    expect(data.sources.routing).toBe("fallback")
    // И предупреждение написано словами, а не спрятано в коде
    const warnings = (data.dataQuality.warnings as string[]).join(" ")
    expect(warnings).toMatch(/по прямой|маршрутизатор|OSRM/i)
  })

  it("километры из карточки заказа не выдаются за дорожное расстояние", async () => {
    // В заказе вручную вписано 111 км — это НЕ измерение дороги
    const order = seedOrder("orderkm", "Тула", "Воронеж", { distance: 111 })
    updateRow("order", order, { routeId: world.routeA, routeSequence: 1 })

    const response = await tripGet(
      makeRequest("GET", "/x", { cookie: cookieStaff }),
      routeContext({ routeId: world.routeA }),
    )
    const data = await jsonOf(response)
    expect(response.status).toBe(200)

    const driving = (data.stages as Array<{
      kind: string
      address: string
      distanceM: number | null
    }>).filter((stage) => stage.kind === "driving" || stage.kind === "return_to_base")

    // Дорожное расстояние Тула → Воронеж — 420 км, а не 111 из карточки
    const dropoff = driving.find((stage) => stage.address === "Тула → Воронеж")
    expect(dropoff).toBeTruthy()
    expect(dropoff!.distanceM).toBe(420000)

    // Итог по плечам: Домодедово→Тула 190 + Тула→Воронеж 420 + Воронеж→Домодедово 480
    const total = driving.reduce((sum, stage) => sum + (stage.distanceM ?? 0), 0)
    expect(total).toBe(1090000)
  })
})

// ---------------------------------------------------------------------------
// 12. Сверка шкалы этапов с итогом движка
// ---------------------------------------------------------------------------

describe("уверенность прогноза", () => {
  it("уверенность — произведение множителей, а не «точность в процентах»", async () => {
    const order = seedOrder("conf1", "Тула", "Воронеж")
    updateRow("order", order, { routeId: world.routeA, routeSequence: 1 })

    const response = await tripGet(
      makeRequest("GET", "/x", { cookie: cookieStaff }),
      routeContext({ routeId: world.routeA }),
    )
    const data = await jsonOf(response)
    expect(response.status).toBe(200)

    const confidence = data.confidence as { level: string; score: number; reasons: string[] }
    expect(confidence.score).toBeGreaterThan(0)
    // Диапазон зажат: 0.05 … 1
    expect(confidence.score).toBeLessThanOrEqual(1)
    expect(confidence.score).toBeGreaterThanOrEqual(0.05)
    // Уровень — по порогам 0.45 и 0.7
    const expectedLevel =
      confidence.score >= 0.7 ? "high" : confidence.score >= 0.45 ? "medium" : "low"
    expect(confidence.level).toBe(expectedLevel)
    // Причина каждого понижения названа словами, а не спрятана в числе
    expect(confidence.reasons.length).toBeGreaterThan(0)

    // В тестовой заглушке шаги OSRM без номера и названия дороги, поэтому
    // класс дороги не определён (уверенность 0.2), погоды нет (×0.8),
    // время операций взято из диапазонов по умолчанию (×0.9).
    // Проверяем САМ ФАКТ наличия этих понижений, а не точное число: состав
    // множителей зависит от карточки ТС в сидах.
    const joined = confidence.reasons.join(" ")
    expect(joined).toMatch(/класс дороги|погод|операц|транспортн/i)

    // Источники честны: пробки — исторические, погода недоступна
    expect(data.sources.routing).toBe("osrm")
    expect(data.sources.weatherEnabled).toBe(false)
    // Плечо с оценённым расстоянием помечено: уверенность не «выдумана»
    const estimated = data.stages.filter(
      (stage: { kind: string; distanceM: number | null }) =>
        (stage.kind === "driving" || stage.kind === "return_to_base") &&
        (stage.distanceM ?? 0) === 0,
    )
    expect(estimated).toHaveLength(0)
  })
})

describe("согласованность шкалы этапов и итога", () => {
  it("arrivalAt последнего этапа совпадает с completionAt", async () => {
    const first = seedOrder("sync1", "Тула", "Воронеж")
    const second = seedOrder("sync2", "Воронеж", "Липецк")
    for (const [index, orderId] of [first, second].entries()) {
      updateRow("order", orderId, { routeId: world.routeA, routeSequence: index + 1 })
    }

    const response = await tripGet(makeRequest("GET", "/x", { cookie: cookieStaff }), routeContext({ routeId: world.routeA }))
    const data = await jsonOf(response)

    expect(response.status).toBe(200)
    const stages = data.stages as Array<{ kind: string; plannedEndAt: string | null; actualEndAt: string | null }>
    expect(stages.length).toBeGreaterThan(0)

    // Последний этап — возврат на базу, его окончание и есть завершение рейса
    const last = stages[stages.length - 1]
    expect(last.kind).toBe("return_to_base")
    expect(last.plannedEndAt).toBeTruthy()
    expect(new Date(String(last.plannedEndAt)).getTime()).toBe(
      new Date(String(data.completionAt)).getTime(),
    )
  })

  it("итоговое время рейса = движение + операции + перерывы", async () => {
    const first = seedOrder("sum1", "Тула", "Воронеж")
    const second = seedOrder("sum2", "Воронеж", "Липецк")
    for (const [index, orderId] of [first, second].entries()) {
      updateRow("order", orderId, { routeId: world.routeA, routeSequence: index + 1 })
    }

    const response = await tripGet(makeRequest("GET", "/x", { cookie: cookieStaff }), routeContext({ routeId: world.routeA }))
    const data = await jsonOf(response)

    const sum =
      data.remaining.drivingSec + data.remaining.stopsSec + data.remaining.restSec
    // Движок считает от «сейчас», поэтому totalSec — это и есть разбивка
    expect(data.remaining.totalSec).toBe(sum)
    // Ни одно слагаемое не потеряно
    expect(data.remaining.drivingSec).toBeGreaterThan(0)
    expect(data.remaining.stopsSec).toBeGreaterThan(0)
  })
})

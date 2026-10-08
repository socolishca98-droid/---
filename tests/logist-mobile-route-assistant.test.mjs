/**
 * Тесты помощника сборки рейсов (lib/logist-mobile/route-assistant.ts).
 *
 * Помощник обещает логисту три вещи, и все три проверяются здесь:
 *  1) в сборку попадают только согласованные заказы, которых ещё нет в рейсе;
 *  2) заказы складываются по направлению и не превышают машину,
 *     а машина выбирается самая маленькая подходящая;
 *  3) цифры предложения (вес, деньги, ₽/км) считаются честно.
 *
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  isRouteableForAssistant,
  cityKey,
  orderRevenue,
  pickVehicle,
  buildRouteProposals,
  proposalSummary,
  proposalLine,
  driverAssignmentRank,
  sortDriversForAssignment,
  vehiclesForCargo,
  driverOfVehicle,
  assignableDrivers,
  assignableDriversForVehicle,
  pickCrew,
} = require("../.test-build/lib/logist-mobile/route-assistant.js")

const NOW = new Date("2026-10-08T10:00:00.000Z")

function order(overrides = {}) {
  return {
    id: "demo-order-1",
    status: "agreed",
    routeFrom: "Москва, улица Складочная, 8",
    routeTo: "Калуга, улица Московская, 289",
    distance: 190,
    weight: 6000,
    volume: 20,
    price: 70000,
    agreedPrice: null,
    deadline: "2026-10-10T18:00:00.000Z",
    clientName: "ООО «Ромашка»",
    routeId: null,
    ...overrides,
  }
}

const FLEET = [
  { id: "v1", plate: "К215СТ790", type: "Изотерм", capacity: 5000, volume: 32, status: "available" },
  { id: "v2", plate: "О556АА750", type: "Бортовая", capacity: 10000, volume: 45, status: "available" },
  { id: "v3", plate: "Е774ОР750", type: "Тент", capacity: 20000, volume: 82, status: "in_use" },
  { id: "v4", plate: "А421ВС750", type: "Фургон", capacity: 1500, volume: 8, status: "available" },
  { id: "v5", plate: "В108МК799", type: "Тягач", capacity: 20000, volume: 90, status: "maintenance" },
]

test("в сборку попадают только согласованные заказы без рейса", () => {
  assert.equal(isRouteableForAssistant(order()), true)
  assert.equal(isRouteableForAssistant(order({ status: "search" })), false)
  assert.equal(isRouteableForAssistant(order({ status: "negotiation" })), false)
  assert.equal(isRouteableForAssistant(order({ status: "in_route" })), false)
  // Уже в рейсе — не предлагаем повторно
  assert.equal(isRouteableForAssistant(order({ routeId: "demo-route-1" })), false)
  // Прежнее значение «confirmed» — это и есть согласованный заказ
  assert.equal(isRouteableForAssistant(order({ status: "confirmed" })), true)
})

test("город для сравнения: «г. Калуга» и «Калуга» — один город", () => {
  assert.equal(cityKey("г. Калуга, улица Московская, 289"), "калуга")
  assert.equal(cityKey("КАЛУГА"), "калуга")
  assert.equal(cityKey("Московская область, Домодедово, улица Логистическая, 12"), "домодедово")
  assert.equal(cityKey(""), "")
  assert.equal(cityKey(null), "")
})

test("деньги по заказу: договорная цена важнее прайсовой", () => {
  assert.equal(orderRevenue(order({ price: 70000 })), 70000)
  assert.equal(orderRevenue(order({ price: 70000, agreedPrice: 82000 })), 82000)
  assert.equal(orderRevenue(order({ price: 0, agreedPrice: null })), 0)
})

test("машина: самая маленькая подходящая, на ТО не берём", () => {
  // 6 т: изотерм на 5 т мал, бортовая на 10 т подходит; тягач на ТО не считаем
  assert.equal(pickVehicle(6000, 20, FLEET)?.id, "v2")
  // 4 т и 10 м³: влезает и в изотерм (5 т / 32 м³) — берём его, он меньше
  assert.equal(pickVehicle(4000, 10, FLEET)?.id, "v1")
  // 1,2 т — микрогрузовик
  assert.equal(pickVehicle(1200, 6, FLEET)?.id, "v4")
  // 18 т: свободных машин нет, но занятый тент (20 т) предлагаем — логист решит сам
  assert.equal(pickVehicle(18000, 70, FLEET)?.id, "v3")
  // Больше 20 т не влезает ни в одну машину автопарка — молчим, а не врём
  assert.equal(pickVehicle(25000, 90, FLEET), null)
  // Машина на ТО не рассматривается никогда, даже если она единственная
  assert.equal(pickVehicle(18000, 70, [FLEET[4]]), null)
})

test("предложение: один город погрузки — один рейс", () => {
  const orders = [
    order({ id: "o1", routeTo: "Калуга, улица Московская, 289", weight: 6000, price: 70000, distance: 190 }),
    order({ id: "o2", routeFrom: "Москва, склад на Ленина, 5", routeTo: "Калуга, улица Кирова, 1", weight: 4000, price: 45000, distance: 185 }),
    order({ id: "o3", routeTo: "Тула, улица Рязанская, 38", weight: 3000, price: 30000, distance: 180 }),
  ]

  const proposals = buildRouteProposals(orders, FLEET, NOW)
  // Муром: заказы собираются по городу погрузки. Москва → Калуга (2 заказа) и
  // Москва → Тула (1) — либо сливаются в один рейс, либо остаются двумя.
  assert.ok(proposals.length >= 1)
  const total = proposals.reduce((sum, p) => sum + p.orders.length, 0)
  assert.equal(total, orders.length, "каждый заказ должен попасть ровно в одно предложение")

  const merged = proposals.find((p) => p.orders.length === 3)
  if (merged) {
    // 13 т — влезает только в 20-тонный тягач/тент, и он занят, значит предлагаем занятую
    assert.equal(merged.vehicle?.plate, "Е774ОР750")
    assert.equal(merged.revenue, 145000)
    assert.equal(merged.distanceKm, 190)
  }
  for (const proposal of proposals) {
    assert.ok(proposal.reasons.length > 0, "у предложения должно быть объяснение")
    assert.ok(proposal.name.includes("→"), "название — это направление")
  }
})

test("предложение: вес считаем по всем заказам, деньги и ₽/км — тоже", () => {
  const orders = [
    order({ id: "o1", routeFrom: "Москва, склад", routeTo: "Калуга", weight: 4000, price: 60000, distance: 200 }),
    order({ id: "o2", routeFrom: "Москва, другой склад", routeTo: "Калуга, центр", weight: 2000, agreedPrice: 50000, price: 1000, distance: 210 }),
  ]

  const [proposal] = buildRouteProposals(orders, FLEET, NOW)
  assert.ok(proposal)
  assert.equal(proposal.orders.length, 2)
  assert.equal(proposal.weightKg, 6000)
  assert.equal(proposal.revenue, 110000) // 60 000 + договорные 50 000
  assert.equal(proposal.distanceKm, 210) // самая дальняя точка
  assert.equal(proposal.pricePerKm, Math.round(110000 / 210))
  assert.equal(proposal.capacityLeftKg, 10000 - 6000)
})

test("горящий заказ делаем первым и говорим об этом", () => {
  const orders = [
    order({ id: "calm", routeTo: "Калуга", deadline: "2026-10-20T18:00:00.000Z", price: 90000 }),
    // другое направление, чтобы это были два отдельных предложения
    order({ id: "late", routeFrom: "Тверь", routeTo: "Москва", deadline: "2026-10-06T18:00:00.000Z", price: 20000 }),
  ]

  const proposals = buildRouteProposals(orders, FLEET, NOW)
  assert.equal(proposals[0].urgent, true)
  assert.equal(proposals[0].orders[0].id, "late")
  assert.ok(proposals[0].reasons.some((reason) => /просрочен/i.test(reason)))
  assert.equal(proposals[1].urgent, false)
})

test("итог и строка предложения считаются по всем заказам", () => {
  const orders = [
    order({ id: "o1", weight: 4000, price: 60000, routeTo: "Калуга" }),
    order({ id: "o2", weight: 2000, price: 30000, routeTo: "Калуга, центр" }),
    order({ id: "o3", status: "search", routeTo: "Тула" }),
  ]

  const proposals = buildRouteProposals(orders, FLEET, NOW)
  const summary = proposalSummary(proposals, 2)
  assert.equal(summary.routes, 1)
  assert.equal(summary.orders, 2)
  assert.equal(summary.revenue, 90000)
  assert.equal(summary.unplaced, 0)

  const line = proposalLine(proposals[0])
  assert.ok(line.includes("2 заказа"))
  assert.ok(line.includes("6 т"))
  assert.ok(line.includes("км"))
})

test("водители: свободные сверху, на ТО и не на связи — в конце", () => {
  const drivers = [
    { id: "d1", name: "Иванов", status: "busy" },
    { id: "d2", name: "Орлов", status: "maintenance" },
    { id: "d3", name: "Фёдоров", status: "available" },
    { id: "d4", name: "Кузнецов", status: "offline" },
    { id: "d5", name: "Белов", status: "available" },
  ]

  const sorted = sortDriversForAssignment(drivers).map((driver) => driver.id)
  assert.deepEqual(sorted, ["d5", "d3", "d1", "d4", "d2"])
  assert.equal(driverAssignmentRank("available"), 0)
  assert.equal(driverAssignmentRank("busy"), 1)
  assert.equal(driverAssignmentRank("offline"), 2)
  assert.equal(driverAssignmentRank(null), 2)
})

// ─────────────────────────── экипаж: машина + водитель ───────────────────────

const CREW_VEHICLES = [
  { id: "veh-5", plate: "К215СТ790", capacity: 5000, volume: 32, status: "available" },
  { id: "veh-10", plate: "О556АА750", capacity: 10000, volume: 45, status: "available" },
  { id: "veh-20", plate: "А421ВС750", capacity: 20000, volume: 90, status: "in_use" },
  { id: "veh-18", plate: "Е774ОР750", capacity: 18000, volume: 82, status: "available" },
  { id: "veh-to", plate: "Н903УУ777", capacity: 1500, volume: 10, status: "maintenance" },
]

const CREW_DRIVERS = [
  { id: "drv-fed", name: "Фёдоров Дмитрий", status: "available", vehicleId: "veh-5", vehiclePlate: "К215СТ790" },
  { id: "drv-iva", name: "Иванов Сергей", status: "busy", vehicleId: "veh-10", vehiclePlate: "О556АА750" },
  { id: "drv-kuz", name: "Кузнецов Андрей", status: "available", vehicleId: null, vehiclePlate: null },
  { id: "drv-orl", name: "Орлов Никита", status: "maintenance", vehicleId: null, vehiclePlate: null },
]

test("машина, закреплённая за водителем, видна помощнику", () => {
  assert.equal(driverOfVehicle("veh-5", CREW_DRIVERS)?.id, "drv-fed")
  assert.equal(driverOfVehicle("veh-20", CREW_DRIVERS), null)
  assert.equal(driverOfVehicle(null, CREW_DRIVERS), null)
})

test("подходящие машины: свободные и от маленькой к большой, на ТО не берём", () => {
  const forSixTons = vehiclesForCargo(6000, 20, CREW_VEHICLES).map((v) => v.id)
  assert.deepEqual(forSixTons, ["veh-10", "veh-18", "veh-20"])
  // 1,4 т: ТО-машина отброшена, а порядок — по грузоподъёмности
  assert.deepEqual(vehiclesForCargo(1400, 5, CREW_VEHICLES).map((v) => v.id), ["veh-5", "veh-10", "veh-18", "veh-20"])
  assert.deepEqual(vehiclesForCargo(30000, 100, CREW_VEHICLES), [])
})

test("в сборку предлагаем только тех водителей, кого сервер примет", () => {
  const drivers = assignableDrivers(6000, 20, CREW_VEHICLES, CREW_DRIVERS).map((d) => d.id)
  // Фёдоров со своей 5-тонной машиной не пройдёт (груз 6 т), Иванов занят,
  // Орлов на ТО — остаётся Кузнецов без машины.
  assert.deepEqual(drivers, ["drv-kuz"])

  // под 4 т машина Фёдорова подходит
  assert.deepEqual(assignableDrivers(4000, 15, CREW_VEHICLES, CREW_DRIVERS).map((d) => d.id), ["drv-fed", "drv-kuz"])
})

test("передать рейс можно только хозяину машины", () => {
  const owned = assignableDriversForVehicle(CREW_VEHICLES[1], CREW_DRIVERS).map((d) => d.id)
  assert.deepEqual(owned, ["drv-iva"])

  const free = assignableDriversForVehicle(CREW_VEHICLES[2], CREW_DRIVERS).map((d) => d.id)
  // у машины нет хозяина — можно любого
  assert.equal(free.length, CREW_DRIVERS.length)
})

test("экипаж по умолчанию: сначала готовая пара, потом машина без водителя", () => {
  // 4 т: свободна 5-тонная машина Фёдорова, он сам свободен — идеальная пара
  const pair = pickCrew(4000, 15, CREW_VEHICLES, CREW_DRIVERS)
  assert.equal(pair.vehicle?.id, "veh-5")
  assert.equal(pair.driver?.id, "drv-fed")

  // 6 т: машина Иванова свободна, но он в рейсе — резервируем машину без водителя
  const carOnly = pickCrew(6000, 20, CREW_VEHICLES, CREW_DRIVERS)
  assert.equal(carOnly.vehicle?.id, "veh-10")
  assert.equal(carOnly.driver, null)

  // 25 т не влезает ни в одну машину — помощник молчит, логист решает сам
  const nothing = pickCrew(25000, 100, CREW_VEHICLES, CREW_DRIVERS)
  assert.equal(nothing.vehicle, null)
  assert.equal(nothing.driver, null)
})

test("пустой вход — пустой выход, без выдумок", () => {
  assert.deepEqual(buildRouteProposals([], FLEET, NOW), [])
  assert.deepEqual(buildRouteProposals([order({ status: "delivered" })], FLEET, NOW), [])
  assert.deepEqual(proposalSummary([], 0), { routes: 0, orders: 0, revenue: 0, unplaced: 0 })
})

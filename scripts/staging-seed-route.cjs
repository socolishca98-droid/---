// scripts/staging-seed-route.cjs
// Готовит в ПЕСОЧНИЦЕ (SQLite) выделенный рейс для приёмки ETA:
// база Домодедово → Тула → Воронеж → Липецк → Смоленск → база.
// Три погрузки, три выгрузки, возврат на базу. Расстояния намеренно
// НЕ заполнены: их должен посчитать OSRM, а не поле заказа.
const { PrismaClient } = require("@prisma/client")
const p = new PrismaClient()

const ORG = "cmv5l2v5l00007azufj22kezb" // организация А из сидов
const DRIVER = "demo-driver-4" // стоит на базе в Домодедово
const ROUTE = "stg-route-eta"

// ВАЖНО про расхождение движков (проверено при приёмке):
//   * движок рейса (GET /api/routes/[id]/trip) знает про базу: начинает с
//     координат водителя/автопарка и добавляет возврат на базу;
//   * прогноз логиста (POST /api/eta/forecast) строит цепочку ТОЛЬКО из
//     адресов заказов (routeFrom первого + routeTo всех), поэтому его
//     километры — это цепочка «погрузка→выгрузка» без плеч до базы и обратно.
// Оба ответа честно показывают sources.routing = "osrm". Расхождение —
// свойство охвата, а не расчётная ошибка; сумма плеч внутри каждого
// движка сходится с его итогом.
const CHAIN = [
  { slug: "stg-a", from: "Тула, Тульская область, Россия", to: "Воронеж, Воронежская область, Россия", price: 50000 },
  { slug: "stg-b", from: "Воронеж, Воронежская область, Россия", to: "Липецк, Липецкая область, Россия", price: 45000 },
  { slug: "stg-c", from: "Липецк, Липецкая область, Россия", to: "Смоленск, Смоленская область, Россия", price: 60000 },
]

;(async () => {
  // чистим прошлый прогон приёмки
  await p.etaForecast.deleteMany({ where: { routeId: ROUTE } })
  await p.routeStage.deleteMany({ where: { routeId: ROUTE } })
  await p.routeEvent.deleteMany({ where: { routeId: ROUTE } })
  await p.route.deleteMany({ where: { id: ROUTE } })
  await p.order.deleteMany({ where: { id: { in: CHAIN.map((c) => `stg-${c.slug}`) } } })

  const vehicle = await p.vehicle.findFirst({ where: { organizationId: ORG } })

  await p.route.create({
    data: {
      id: ROUTE,
      organizationId: ORG,
      driverId: DRIVER,
      status: "active",
      vehicleId: vehicle ? vehicle.id : null,
    },
  })

  for (const [index, leg] of CHAIN.entries()) {
    await p.order.create({
      data: {
        id: `stg-${leg.slug}`,
        organizationId: ORG,
        routeId: ROUTE,
        routeSequence: index + 1,
        source: "manual",
        // Срок через 3 дня: проверяем, что прогноз его не нарушает
        deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        routeFrom: leg.from,
        routeTo: leg.to,
        status: "assigned",
        // ВАЖНО: 0 — расстояние заказа не должно подменять дорожное.
        // Поле заполняют логисты вручную, и раньше оно уходило в прогноз.
        distance: 0,
        weight: 10,
        price: leg.price,
        cargoType: "Груз",
        clientContact: "",
        assignedDriverId: DRIVER,
        assignedVehicleId: vehicle ? vehicle.id : null,
      },
    })
  }

  // Водитель на базе: свежая GPS-точка
  await p.driver.update({
    where: { id: DRIVER },
    data: { latitude: 55.4207, longitude: 37.7376, lastGpsUpdate: new Date() },
  })

  const check = await p.order.findMany({ where: { routeId: ROUTE }, orderBy: { routeSequence: "asc" } })
  console.log("рейс:", ROUTE, "| заказов:", check.length)
  for (const o of check) console.log("  ", o.routeSequence, o.routeFrom, "->", o.routeTo, "| км в карточке:", o.distance)
  await p.$disconnect()
})().catch((e) => {
  console.error("ERR", e.message)
  process.exit(1)
})

// scripts/acceptance-route-seed.cjs
//
// Готовит ОТДЕЛЬНЫЙ тестовый рейс для сквозной приёмки ETA. Намеренно другой
// рейс, не stg-route-eta: приёмка не должна зависеть от состояния прошлого
// прогона. Расстояния в карточках заказов = 0, их считает только OSRM.
//
// Цепочка: база Домодедово → Владимир → Нижний Новгород → Чебоксары → база.
// (Отличается от stg-route-eta, чтобы совпадение чисел не выглядело как
// «переиспользовал прошлый результат».)
//
// Запуск: node scripts/acceptance-route-seed.cjs
const { PrismaClient } = require("@prisma/client")
const p = new PrismaClient()

const ORG = "cmv5l2v5l00007azufj22kezb"
const DRIVER = "demo-driver-4"
const ROUTE = "acc-route-2"

const CHAIN = [
  { slug: "a", from: "Владимир, Владимирская область, Россия", to: "Нижний Новгород, Нижегородская область, Россия" },
  { slug: "b", from: "Нижний Новгород, Нижегородская область, Россия", to: "Чебоксары, Чувашская Республика, Россия" },
]

;(async () => {
  await p.etaForecast.deleteMany({ where: { routeId: ROUTE } })
  await p.routeStage.deleteMany({ where: { routeId: ROUTE } })
  await p.routeEvent.deleteMany({ where: { routeId: ROUTE } })
  await p.route.deleteMany({ where: { id: ROUTE } })
  await p.order.deleteMany({ where: { id: { in: CHAIN.map((c) => `acc-${c.slug}`) } } })

  const vehicle = await p.vehicle.findFirst({ where: { organizationId: ORG } })

  await p.route.create({
    data: { id: ROUTE, organizationId: ORG, driverId: DRIVER, status: "active", vehicleId: vehicle ? vehicle.id : null },
  })

  for (const [index, leg] of CHAIN.entries()) {
    await p.order.create({
      data: {
        id: `acc-${leg.slug}`,
        organizationId: ORG,
        routeId: ROUTE,
        routeSequence: index + 1,
        source: "manual",
        deadline: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
        routeFrom: leg.from,
        routeTo: leg.to,
        status: "assigned",
        distance: 0,
        weight: 10,
        price: 50000,
        cargoType: "Груз",
        clientContact: "",
        assignedDriverId: DRIVER,
        assignedVehicleId: vehicle ? vehicle.id : null,
      },
    })
  }

  // Водитель стоит на базе в Домодедово со свежей GPS-точкой
  const settings = await p.fleetSettings.findFirst({ where: { organizationId: ORG } })
  await p.driver.update({
    where: { id: DRIVER },
    data: {
      latitude: settings?.baseLat ?? 55.4207,
      longitude: settings?.baseLng ?? 37.7376,
      lastGpsUpdate: new Date(),
    },
  })

  const check = await p.order.findMany({ where: { routeId: ROUTE }, orderBy: { routeSequence: "asc" } })
  console.log("рейс:", ROUTE, "| заказов:", check.length)
  for (const o of check) {
    console.log("  ", o.routeSequence, o.routeFrom, "->", o.routeTo, "| км в карточке:", o.distance)
  }
  const d = await p.driver.findUnique({ where: { id: DRIVER } })
  console.log("водитель:", d.name, "| GPS:", d.latitude, d.longitude, "| метка:", d.lastGpsUpdate.toISOString())

  await p.$disconnect()
})().catch(async (e) => {
  console.error("ERR", e.message)
  await p.$disconnect()
  process.exit(1)
})

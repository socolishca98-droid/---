import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { isOrderAvailableForRoute, orderToBuilderLoad, ordersToBuilderLoads } from "../lib/logist-mobile/order-to-load.ts"

describe("order-to-load", () => {
  it("фильтрует только свободные неархивные заказы без водителя", () => {
    assert.equal(
      isOrderAvailableForRoute({
        id: "1",
        routeFrom: "Москва",
        routeTo: "Ярославль",
        distance: 260,
        weight: 5000,
        volume: 30,
        cargoType: "ТНП",
        price: 35000,
        status: "search",
        driverId: null,
        archivedAt: null,
      }),
      true,
    )

    assert.equal(
      isOrderAvailableForRoute({
        id: "2",
        routeFrom: "Москва",
        routeTo: "Ярославль",
        distance: 260,
        weight: 5000,
        volume: 30,
        cargoType: "ТНП",
        price: 35000,
        status: "in_route",
        driverId: "drv-1",
        archivedAt: null,
      }),
      false,
    )

    assert.equal(
      isOrderAvailableForRoute({
        id: "3",
        routeFrom: "Москва",
        routeTo: "Ярославль",
        distance: 260,
        weight: 5000,
        volume: 30,
        cargoType: "ТНП",
        price: 35000,
        status: "search",
        driverId: null,
        archivedAt: "2026-10-01T00:00:00Z",
      }),
      false,
    )
  })

  it("конвертирует заказ в BuilderLoad с пометкой isOwnOrder", () => {
    const load = orderToBuilderLoad({
      id: "ord-42",
      routeFrom: "Ярославль",
      routeTo: "Кострома",
      distance: 85,
      weight: 3000,
      volume: 18,
      cargoType: "Продукты",
      requirements: "Изотерм",
      price: 18000,
      clientName: "ООО Север",
      clientContact: "+79001112233",
      deadline: "2026-10-15T10:00:00.000Z",
      status: "agreed",
    })

    assert.equal(load.id, "order:ord-42")
    assert.equal(load.loadId, "ord-42")
    assert.equal(load.fromCity, "Ярославль")
    assert.equal(load.toCity, "Кострома")
    assert.equal(load.priceRub, 18000)
    assert.equal(load.firmName, "ООО Север")
    assert.equal(load.isOwnOrder, true)
    assert.equal(load.status, "own_order")
  })

  it("ordersToBuilderLoads возвращает только доступные заказы", () => {
    const result = ordersToBuilderLoads([
      {
        id: "a",
        routeFrom: "А",
        routeTo: "Б",
        distance: 100,
        weight: 1000,
        volume: 10,
        cargoType: "Груз",
        price: 10000,
        status: "new",
      },
      {
        id: "b",
        routeFrom: "В",
        routeTo: "Г",
        distance: 100,
        weight: 1000,
        volume: 10,
        cargoType: "Груз",
        price: 10000,
        status: "delivered",
      },
    ])
    assert.equal(result.length, 1)
    assert.equal(result[0].loadId, "a")
  })
})

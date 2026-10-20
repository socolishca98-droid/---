// Тесты сводки «Потрачено на ремонты» (этап 3, A4).
// Источник расходов — MaintenanceLog; RouteExpense type="repair" в приложении
// не создаётся, поэтому считаем только записи журнала.
import test from "node:test"
import assert from "node:assert"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { maintenanceSpend, MAINTENANCE_TYPE_LABELS } = require("../.test-build/lib/maintenance/schedule.js")

test("пустой журнал — нули", () => {
  const spend = maintenanceSpend([])
  assert.equal(spend.costRub, 0)
  assert.equal(spend.count, 0)
  assert.deepEqual(spend.byVehicle, [])
})

test("сумма по записям, записи без стоимости не считаются", () => {
  const spend = maintenanceSpend([
    { cost: 1000, vehicleId: "v1", vehiclePlate: "А123АА" },
    { cost: null, vehicleId: "v1", vehiclePlate: "А123АА" },
    { cost: 250.5, vehicleId: "v2", vehiclePlate: "В456ВВ" },
  ])
  assert.equal(spend.costRub, 1251)
  assert.equal(spend.count, 2)
})

test("сводка по машинам: сначала дорогие", () => {
  const spend = maintenanceSpend([
    { cost: 500, vehicleId: "v1", vehiclePlate: "А123АА" },
    { cost: 4000, vehicleId: "v2", vehiclePlate: "В456ВВ" },
    { cost: 500, vehicleId: "v2", vehiclePlate: "В456ВВ" },
  ])
  assert.equal(spend.byVehicle[0].vehiclePlate, "В456ВВ")
  assert.equal(spend.byVehicle[0].costRub, 4500)
  assert.equal(spend.byVehicle[0].count, 2)
  assert.equal(spend.byVehicle[1].costRub, 500)
})

test("подписи видов работ для формы", () => {
  assert.equal(MAINTENANCE_TYPE_LABELS.repair, "Ремонт")
  assert.equal(MAINTENANCE_TYPE_LABELS.service, "ТО")
})

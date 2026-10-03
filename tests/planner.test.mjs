// tests/planner.test.mjs
//
// Виртуальный логист (lib/assistant/planner.ts): отбор актуальных заказов,
// выбор свободной машины, цепочки с учётом грузоподъёмности, варианты и
// пересборка после исключения заказа. Чистые функции — база не нужна.
//
// Запуск: npm run test:unit

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  availableVehicles,
  buildPlanProposals,
  chainCities,
  countEmptyLegs,
  isPlanCandidate,
  orderFitsVehicle,
  orderRevenue,
  pickDefaultVehicle,
} = require("../.test-build/lib/assistant/planner.js");

const FUTURE = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

const order = (extra = {}) => ({
  id: "o1",
  routeFrom: "Ярославль",
  routeTo: "Москва",
  distance: 270,
  weight: 5000,
  volume: null,
  price: 45000,
  agreedPrice: null,
  deadline: FUTURE,
  status: "agreed",
  clientName: "ООО Ромашка",
  routeId: null,
  ...extra,
});

const vehicle = (extra = {}) => ({
  id: "v1",
  plate: "А001АА76",
  type: "truck",
  brand: "Volvo",
  model: "FH",
  capacity: 20000,
  volume: null,
  status: "available",
  ...extra,
});

test("актуальный заказ: не закрыт и не в рейсе", () => {
  assert.equal(isPlanCandidate(order()), true);
  // переговоры и поиск — тоже кандидаты (помечаются «нужно согласование»)
  assert.equal(isPlanCandidate(order({ status: "negotiation" })), true);
  assert.equal(isPlanCandidate(order({ status: "search" })), true);
  // закрытые и уже в рейсе — нет
  assert.equal(isPlanCandidate(order({ status: "delivered" })), false);
  assert.equal(isPlanCandidate(order({ status: "cancelled" })), false);
  assert.equal(isPlanCandidate(order({ routeId: "r1" })), false);
});

test("доход: согласованная цена важнее прайса", () => {
  assert.equal(
    orderRevenue(order({ price: 45000, agreedPrice: 52000 })),
    52000,
  );
  assert.equal(orderRevenue(order({ price: 45000 })), 45000);
  assert.equal(orderRevenue(order({ price: null })), 0);
});

test("машина: свободные только available, по умолчанию — самая грузоподъёмная", () => {
  const small = vehicle({ id: "v-small", capacity: 5000 });
  const big = vehicle({ id: "v-big", capacity: 20000 });
  const busy = vehicle({ id: "v-busy", status: "in_use", capacity: 30000 });
  const repair = vehicle({
    id: "v-repair",
    status: "maintenance",
    capacity: 30000,
  });

  const free = availableVehicles([small, big, busy, repair]);
  assert.deepEqual(
    free.map((v) => v.id),
    ["v-small", "v-big"],
  );
  assert.equal(pickDefaultVehicle([small, big, busy, repair]).id, "v-big");
  assert.equal(pickDefaultVehicle([busy, repair]), null);
});

test("заказ помещается в машину по весу и объёму", () => {
  assert.equal(
    orderFitsVehicle(order({ weight: 5000 }), vehicle({ capacity: 5000 })),
    true,
  );
  assert.equal(
    orderFitsVehicle(order({ weight: 5001 }), vehicle({ capacity: 5000 })),
    false,
  );
  assert.equal(
    orderFitsVehicle(
      order({ weight: 1000, volume: 40 }),
      vehicle({ capacity: 5000, volume: 30 }),
    ),
    false,
  );
  // объём машины неизвестен — ограничиваем только весом
  assert.equal(
    orderFitsVehicle(order({ volume: 40 }), vehicle({ volume: null })),
    true,
  );
});

test("цепочка городов: продолжение маршрута без порожнего перегона", () => {
  const chain = [
    order({ id: "a", routeFrom: "Ярославль", routeTo: "Москва" }),
    order({ id: "b", routeFrom: "Москва", routeTo: "Тула" }),
    order({ id: "c", routeFrom: "Казань", routeTo: "Уфа" }),
  ];
  assert.equal(countEmptyLegs(chain), 1);

  const cities = chainCities(chain).map((point) => point.city);
  assert.deepEqual(cities, [
    "Ярославль",
    "Москва",
    "Москва",
    "Тула",
    "Казань",
    "Уфа",
  ]);
  const gaps = chainCities(chain).filter((point) => point.gapBefore);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].city, "Казань");
});

test("предложения: цепочка продолжается городом выгрузки, тяжёлое пропускается", () => {
  const truck = vehicle({ capacity: 12000 });
  const orders = [
    order({
      id: "leg1",
      routeFrom: "Ярославль",
      routeTo: "Москва",
      weight: 5000,
      price: 40000,
    }),
    order({
      id: "leg2",
      routeFrom: "Москва",
      routeTo: "Тула",
      weight: 5000,
      price: 30000,
    }),
    // не помещается после двух первых (12 000 занято) — пропускается
    order({
      id: "heavy",
      routeFrom: "Тула",
      routeTo: "Калуга",
      weight: 9000,
      price: 90000,
    }),
    order({
      id: "leg3",
      routeFrom: "Тула",
      routeTo: "Калуга",
      weight: 2000,
      price: 15000,
    }),
  ];

  const { proposals, stats } = buildPlanProposals({ orders, vehicle: truck });

  assert.equal(stats.candidates, 4);
  assert.ok(proposals.length > 0);

  const best = proposals[0];
  const ids = best.orders.map((o) => o.id);
  assert.ok(!ids.includes("heavy"), "тяжёлый заказ пропущен");
  // суммарный вес не превышает грузоподъёмность
  assert.ok(best.totalWeightKg <= truck.capacity);
  // цепочка Ярославль → Москва → Тула продолжается без перегонов
  assert.equal(best.emptyLegs <= 1, true);
});

test("несогласованные заказы помечаются, согласованные готовы к рейсу", () => {
  const orders = [
    order({ id: "ready", status: "agreed" }),
    order({
      id: "talks",
      status: "negotiation",
      routeFrom: "Москва",
      routeTo: "Тула",
    }),
    order({
      id: "fresh",
      status: "search",
      routeFrom: "Тула",
      routeTo: "Калуга",
    }),
  ];

  const { proposals } = buildPlanProposals({ orders, vehicle: vehicle() });
  const best = proposals[0];

  const ready = best.orders.find((o) => o.id === "ready");
  const talks = best.orders.find((o) => o.id === "talks");
  assert.equal(ready.needsApproval, false);
  assert.equal(talks.needsApproval, true);
  assert.equal(best.routeableCount, 1);
  assert.equal(best.approvalCount, 2);
});

test("исключение заказа пересобирает цепочку без него", () => {
  const orders = [
    order({ id: "a", routeFrom: "Ярославль", routeTo: "Москва", price: 40000 }),
    order({ id: "b", routeFrom: "Москва", routeTo: "Тула", price: 30000 }),
  ];

  const full = buildPlanProposals({ orders, vehicle: vehicle() });
  assert.ok(full.proposals[0].orders.some((o) => o.id === "b"));

  const without = buildPlanProposals({
    orders,
    vehicle: vehicle(),
    excludeIds: ["b"],
  });
  assert.equal(without.stats.excluded, 1);
  for (const proposal of without.proposals) {
    assert.ok(!proposal.orders.some((o) => o.id === "b"));
  }
});

test("пустая база или всё не помещается — предложений нет, но не ошибка", () => {
  const empty = buildPlanProposals({ orders: [], vehicle: vehicle() });
  assert.deepEqual(empty.proposals, []);
  assert.equal(empty.stats.candidates, 0);

  const overweight = buildPlanProposals({
    orders: [order({ weight: 30000 })],
    vehicle: vehicle({ capacity: 1000 }),
  });
  assert.deepEqual(overweight.proposals, []);
  assert.equal(overweight.stats.overweight, 1);
});

test("варианты не дублируются и сортируются по оценке", () => {
  const orders = [
    order({ id: "a", routeFrom: "Ярославль", routeTo: "Москва", price: 40000 }),
    order({
      id: "b",
      routeFrom: "Москва",
      routeTo: "Тула",
      price: 30000,
      deadline: new Date(Date.now() + 12 * 60 * 60 * 1000),
    }),
    order({ id: "c", routeFrom: "Тула", routeTo: "Калуга", price: 20000 }),
  ];

  const { proposals } = buildPlanProposals({ orders, vehicle: vehicle() });
  const signatures = proposals.map((p) => p.orders.map((o) => o.id).join("|"));
  assert.equal(
    new Set(signatures).size,
    signatures.length,
    "дубликаты схлопнуты",
  );
  assert.ok(proposals.length <= 3);

  for (let i = 1; i < proposals.length; i += 1) {
    assert.ok(
      proposals[i - 1].score >= proposals[i].score,
      "сортировка по оценке",
    );
  }
  // срочный заказ помечен риском
  const urgent = proposals.flatMap((p) => p.orders).find((o) => o.id === "b");
  assert.equal(urgent.deadlineSoon, true);
});

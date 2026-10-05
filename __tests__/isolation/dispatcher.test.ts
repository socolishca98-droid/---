// __tests__/isolation/dispatcher.test.ts
//
// Умный диспетчер (GET /api/dispatcher/search): запрос словами — грузы
// накопленной базы СВОЕЙ организации с ожидаемой прибылью. Проверяются:
// доступ только персоналу, 400 на пустой запрос, изоляция кэша между
// организациями, отсеивание взятых грузов, фильтры разбора (город, дата,
// кузов, вес, цена, ₽/км), расчёт прибыли по топливным чекам и лимит
// грузоподъёмности выбранной машины.
//
// Запуск: npm run test:isolation

import { beforeEach, describe, expect, it } from "vitest";

import { memoryDb } from "../__mocks__/prisma-memory";
import {
  cid,
  expectNoForeignIds,
  jsonOf,
  makeRequest,
  seedWorld,
  sessionCookie,
  type World,
} from "./helpers";

import { GET } from "@/app/api/dispatcher/search/route";
import { POST as vehiclesPost } from "@/app/api/vehicles/route";

let world: World;
let cookieLogistA: string;
let cookieAdminA: string;
let cookieAdminB: string;

let c1: string; // Ярославль → Москва, тент, 15 т, 60 000 ₽, завтра
let c2: string; // Тверь → Москва, бортовой, 3 т, 8 000 ₽, завтра
let c3: string; // как c1, но уже взят (status taken) — в подбор не попадает
let c4: string; // Ярославль → Москва, тент, 10 т, 50 000 ₽, через 3 дня
let cB: string; // груз организации Б — для А невидим

/** День загрузки «завтра в полдень» — устойчиво к часу запуска теста. */
function tomorrowNoon(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(12, 0, 0, 0);
  return d;
}

function plusDaysNoon(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(12, 0, 0, 0);
  return d;
}

function seedCache(
  slug: string,
  organizationId: string,
  overrides: Record<string, unknown> = {},
): string {
  const id = cid(slug);
  memoryDb.insert("atiCache", {
    id,
    organizationId,
    atiLoadId: `ati-${slug}`,
    routeFrom: "Ярославль",
    routeTo: "Москва",
    distance: 280,
    weight: 15000,
    price: 60000,
    truckType: "тент",
    status: "new",
    loadingDate: tomorrowNoon(),
    scannedAt: new Date(),
    expiresAt: plusDaysNoon(2),
    ...overrides,
  });
  return id;
}

async function search(cookie: string, q: string, vehicleId?: string) {
  const params = new URLSearchParams({ q });
  if (vehicleId) params.set("vehicleId", vehicleId);
  const response = await GET(
    makeRequest("GET", `/api/dispatcher/search?${params.toString()}`, { cookie }),
  );
  return { status: response.status, payload: await jsonOf(response) };
}

beforeEach(async () => {
  world = seedWorld();
  cookieLogistA = await sessionCookie({
    userId: world.logistA,
    role: "logist",
    kind: "staff",
  });
  cookieAdminA = await sessionCookie({
    userId: world.adminA,
    role: "admin",
    kind: "staff",
  });
  cookieAdminB = await sessionCookie({
    userId: world.adminB,
    role: "admin",
    kind: "staff",
  });

  c1 = seedCache("yar1", world.orgA, { firmName: "ООО Вектор" });
  c2 = seedCache("tver2", world.orgA, {
    routeFrom: "Тверь",
    distance: 170,
    weight: 3000,
    price: 8000,
    truckType: "бортовой",
  });
  c3 = seedCache("yar3", world.orgA, { status: "taken" });
  c4 = seedCache("yar4", world.orgA, {
    weight: 10000,
    price: 50000,
    loadingDate: plusDaysNoon(3),
  });
  cB = seedCache("yarb", world.orgB, { price: 999999 });

  // Топливный чек организации А: 50 л на 3 000 ₽ → цена литра 60 ₽
  memoryDb.insert("routeExpense", {
    id: cid("fuel-a"),
    organizationId: world.orgA,
    routeId: world.routeA,
    type: "fuel",
    liters: 50,
    amount: 3000,
    spentAt: new Date(),
  });
});

describe("умный диспетчер: доступ и валидация", () => {
  it("без сессии подбор недоступен (401)", async () => {
    const { status } = await search("", "из Ярославля");
    expect(status).toBe(401);
  });

  it("пустой запрос — 400 с внятной ошибкой", async () => {
    const { status, payload } = await search(cookieLogistA, "   ");
    expect(status).toBe(400);
    expect(payload.success).toBe(false);
    expect(typeof payload.error).toBe("string");
  });
});

describe("умный диспетчер: подбор и прибыль", () => {
  it("город + кузов: свои грузы, взятые и чужие отсеяны, прибыль посчитана", async () => {
    const { status, payload } = await search(cookieLogistA, "из Ярославля тент");
    expect(status).toBe(200);
    expect(payload.success).toBe(true);
    expectNoForeignIds(payload, world);

    expect(payload.parsed.cityFrom).toBe("Ярославля");
    expect(payload.parsed.truckTypes).toEqual(["тент"]);
    // Просмотрены только доступные грузы своей организации: c1, c2, c4
    expect(payload.scanned).toBe(3);
    // Цена литра из чека А (60 ₽) и расход по умолчанию (30 л/100км):
    // у машин организации расход не указан
    expect(payload.fuelPriceRubPerL).toBe(60);
    expect(payload.consumptionPer100).toBe(30);
    expect(payload.vehicle).toBeNull();

    const ids = payload.candidates.map((c: any) => c.cacheId);
    expect(ids).toEqual([c1, c4]); // сортировка по прибыли: 54 015 > 44 330
    expect(ids).not.toContain(c3); // взятый груз не предлагать
    expect(ids).not.toContain(cB); // чужой организации не видно

    const first = payload.candidates[0];
    expect(first.routeFrom).toBe("Ярославль");
    expect(first.firmName).toBe("ООО Вектор");
    expect(first.rubPerKm).toBe(214); // round(60000 / 280)
    // топливо: 280/100 × 30 × (1 + 0.25 × 15000/20000) = 99.75 л → 5 985 ₽
    expect(first.estimatedFuelRub).toBe(5985);
    expect(first.expectedProfitRub).toBe(54015);
    expect(first.marginPercent).toBe(90);

    const second = payload.candidates[1];
    expect(second.cacheId).toBe(c4);
    expect(second.expectedProfitRub).toBe(44330);
  });

  it("дата «завтра» оставляет только завтрашние грузы", async () => {
    const { payload } = await search(cookieLogistA, "завтра из Ярославля");
    expect(payload.success).toBe(true);
    expect(payload.parsed.dateLabel).toBe("завтра");
    expect(payload.candidates.map((c: any) => c.cacheId)).toEqual([c1]);
  });

  it("«до 5 т» — фильтр верхнего веса", async () => {
    const { payload } = await search(cookieLogistA, "до 5 т");
    expect(payload.candidates.map((c: any) => c.cacheId)).toEqual([c2]);
    expect(payload.candidates[0].rubPerKm).toBe(47); // round(8000 / 170)
    expect(payload.candidates[0].expectedProfitRub).toBe(4825);
  });

  it("«не меньше 50 ₽/км» — фильтр ставки", async () => {
    const { payload } = await search(cookieLogistA, "не меньше 50 ₽/км");
    expect(payload.parsed.rubPerKmMin).toBe(50);
    const ids = payload.candidates.map((c: any) => c.cacheId);
    expect(ids).toEqual([c1, c4]); // у c2 ставка 47 ₽/км — мимо
    for (const candidate of payload.candidates) {
      expect(candidate.rubPerKm).toBeGreaterThanOrEqual(50);
    }
  });

  it("«от 55000» — минимальная цена", async () => {
    const { payload } = await search(cookieLogistA, "из Ярославля от 55000");
    expect(payload.parsed.priceMinRub).toBe(55000);
    expect(payload.candidates.map((c: any) => c.cacheId)).toEqual([c1]);
  });

  it("выбранная машина: груз тяжелее грузоподъёмности отсекается", async () => {
    const created = await vehiclesPost(
      makeRequest("POST", "/api/vehicles", {
        cookie: cookieAdminA,
        body: { plate: "В001ВВ77", type: "truck", capacity: 10000 },
      }),
    );
    const createdPayload = await jsonOf(created);
    expect(created.status).toBe(200);
    const vehicleId = createdPayload.vehicle.id as string;

    const { payload } = await search(cookieLogistA, "из Ярославля", vehicleId);
    expect(payload.success).toBe(true);
    expect(payload.vehicle).toEqual({ id: vehicleId, plate: "В001ВВ77" });
    // c1 (15 т) машине на 10 т не по силам, c4 (10 т) проходит
    expect(payload.candidates.map((c: any) => c.cacheId)).toEqual([c4]);
    // расход пересчитан под загрузку выбранной машины: 2.8 × 30 × 1.25 = 105 л
    expect(payload.candidates[0].estimatedFuelRub).toBe(6300);
    expect(payload.candidates[0].expectedProfitRub).toBe(43700);
  });

  it("чужая организация видит только свой кэш", async () => {
    const { payload } = await search(cookieAdminB, "из Ярославля");
    expect(payload.success).toBe(true);
    expect(payload.candidates.map((c: any) => c.cacheId)).toEqual([cB]);
    // топливных чеков у Б нет — прибыль не выдумывается
    expect(payload.fuelPriceRubPerL).toBeNull();
    expect(payload.candidates[0].expectedProfitRub).toBeNull();
    expect(payload.candidates[0].price).toBe(999999);
  });
});

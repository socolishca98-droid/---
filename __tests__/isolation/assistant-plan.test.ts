// __tests__/isolation/assistant-plan.test.ts
//
// Виртуальный логист (GET /api/assistant/plan): предложения маршрута
// собираются только из своих заказов и машин, чужая машина — 404,
// исключённые заказы в цепочки не возвращаются.
//
// Запуск: npm run test:isolation

import { beforeEach, describe, expect, it } from "vitest";

import { memoryDb } from "../__mocks__/prisma-memory";
import {
  cid,
  jsonOf,
  makeRequest,
  seedWorld,
  sessionCookie,
  type World,
} from "./helpers";

import { GET as planGet } from "@/app/api/assistant/plan/route";

let world: World;
let cookieA: string;

const FUTURE = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

function seedPlanOrder(
  slug: string,
  organizationId: string,
  overrides: Record<string, unknown> = {},
) {
  const id = cid(slug);
  memoryDb.insert("order", {
    id,
    organizationId,
    source: "manual",
    routeFrom: "Ярославль",
    routeTo: "Москва",
    distance: 270,
    weight: 5000,
    cargoType: "Груз",
    clientContact: "",
    clientName: "ООО Ромашка",
    status: "agreed",
    createdAt: new Date(),
    deadline: FUTURE,
    price: 40000,
    isPaid: false,
    routeId: null,
    ...overrides,
  });
  return id;
}

function seedVehicle(slug: string, organizationId: string, capacity: number) {
  const id = cid(slug);
  memoryDb.insert("vehicle", {
    id,
    organizationId,
    plate: `А${slug.length}01АА76`,
    type: "truck",
    capacity,
    status: "available",
    createdAt: new Date(),
  });
  return id;
}

async function plan(cookie: string | null, query = "") {
  const response = await planGet(
    makeRequest("GET", `/api/assistant/plan${query}`, { cookie }),
  );
  return { response, data: await jsonOf(response) };
}

beforeEach(async () => {
  world = seedWorld();
  cookieA = await sessionCookie({
    userId: world.adminA,
    role: "admin",
    kind: "staff",
  });
});

describe("виртуальный логист (GET /api/assistant/plan)", () => {
  it("без сессии — 401", async () => {
    const { response } = await plan(null);
    expect(response.status).toBe(401);
  });

  it("предложения — только из своих заказов, машина — только своя", async () => {
    const ownA = seedPlanOrder("plan-a", world.orgA);
    seedPlanOrder("plan-b", world.orgA, {
      routeFrom: "Москва",
      routeTo: "Тула",
      status: "negotiation",
    });
    const foreign = seedPlanOrder("plan-foreign", world.orgB);

    const vehicleA = seedVehicle("veh-a", world.orgA, 20000);
    seedVehicle("veh-b", world.orgB, 30000);

    const { response, data } = await plan(cookieA);
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);

    // машина — своей организации (чужая 30-тонная не выбрана)
    expect(data.vehicle.id).toBe(vehicleA);
    expect(data.vehicles.every((v: any) => v.id !== undefined)).toBe(true);

    // в цепочках только свои заказы
    expect(data.stats.candidates).toBe(2);
    for (const proposal of data.proposals) {
      for (const order of proposal.orders) {
        expect(order.id).not.toBe(foreign);
        expect([ownA].includes(order.id) || order.routeFrom !== undefined).toBe(
          true,
        );
      }
    }
    const ids = data.proposals.flatMap((p: any) =>
      p.orders.map((o: any) => o.id),
    );
    expect(ids).toContain(ownA);
    expect(ids).not.toContain(foreign);
  });

  it("чужая машина — 404", async () => {
    seedPlanOrder("plan-a", world.orgA);
    seedVehicle("veh-a", world.orgA, 20000);
    const foreignVehicle = seedVehicle("veh-b", world.orgB, 30000);

    const { response } = await plan(cookieA, `?vehicleId=${foreignVehicle}`);
    expect(response.status).toBe(404);
  });

  it("исключённый заказ не возвращается ни в один вариант", async () => {
    const keep = seedPlanOrder("plan-a", world.orgA);
    const drop = seedPlanOrder("plan-drop", world.orgA, {
      routeFrom: "Москва",
      routeTo: "Тула",
    });
    seedVehicle("veh-a", world.orgA, 20000);

    const { response, data } = await plan(cookieA, `?exclude=${drop}`);
    expect(response.status).toBe(200);
    expect(data.stats.excluded).toBe(1);

    const ids = data.proposals.flatMap((p: any) =>
      p.orders.map((o: any) => o.id),
    );
    expect(ids).not.toContain(drop);
    expect(ids).toContain(keep);
  });

  it("нет свободных машин — честное предупреждение, а не ошибка", async () => {
    seedPlanOrder("plan-a", world.orgA);
    const busy = seedVehicle("veh-busy", world.orgA, 20000);
    // все машины организации А заняты (включая посеянные seedWorld)
    for (const id of [busy, world.vehicleA]) {
      const row: any = memoryDb.find("vehicle", id);
      if (row) row.status = "in_use";
    }

    const { response, data } = await plan(cookieA);
    expect(response.status).toBe(200);
    expect(data.vehicle).toBe(null);
    expect(data.proposals).toEqual([]);
    expect(data.warning).toContain("Свободных машин нет");
  });
});

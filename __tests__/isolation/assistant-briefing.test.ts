// __tests__/isolation/assistant-briefing.test.ts
//
// Брифинг ассистента (GET /api/assistant/briefing):
//   * правила видят только данные своей организации;
//   * просроченные оплаты и висящие согласования попадают в дайджест;
//   * активный SOS — пункт максимальной важности;
//   * без сессии — 401.
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

import { GET as briefingGet } from "@/app/api/assistant/briefing/route";

let world: World;
let cookieA: string;
let cookieB: string;

function seedOrder(
  slug: string,
  organizationId: string,
  overrides: Record<string, unknown> = {},
) {
  const id = cid(slug);
  memoryDb.insert("order", {
    id,
    organizationId,
    source: "manual",
    routeFrom: "Москва",
    routeTo: "Тула",
    distance: 180,
    weight: 3000,
    price: 25000,
    cargoType: "Груз",
    clientContact: "",
    deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    status: "search",
    negotiationStatus: "new",
    routeId: null,
    isPaid: false,
    dueDate: null,
    nextFollowUpAt: null,
    deliveredAt: null,
    ...overrides,
  });
  return id;
}

beforeEach(async () => {
  world = seedWorld();
  cookieA = await sessionCookie({
    userId: world.adminA,
    role: "admin",
    kind: "staff",
  });
  cookieB = await sessionCookie({
    userId: world.adminB,
    role: "admin",
    kind: "staff",
  });
});

describe("брифинг ассистента (GET /api/assistant/briefing)", () => {
  it("собирает согласования, просроченные оплаты и SOS своей организации", async () => {
    seedOrder("negA", world.orgA, { status: "negotiation" });
    seedOrder("debtA", world.orgA, {
      status: "delivered",
      isPaid: false,
      dueDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      price: 120000,
    });

    const data = (await jsonOf(
      await briefingGet(
        makeRequest("GET", "/api/assistant/briefing", { cookie: cookieA }),
      ),
    )) as any;

    expect(data.success).toBe(true);
    const kinds = data.items.map((item: any) => item.kind);
    expect(kinds).toContain("negotiations");
    expect(kinds).toContain("overdue_payments");
    expect(kinds).toContain("sos"); // активный SOS организации А из seedWorld

    const debt = data.items.find(
      (item: any) => item.kind === "overdue_payments",
    );
    expect(debt.severity).toBe("danger");
    expect(debt.message).toContain("120");
    expect(debt.href).toBe("/payments");
  });

  it("данные соседней организации в брифинг не попадают", async () => {
    seedOrder("negA", world.orgA, { status: "negotiation" });
    seedOrder("debtA", world.orgA, {
      status: "delivered",
      isPaid: false,
      dueDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    });

    const response = await briefingGet(
      makeRequest("GET", "/api/assistant/briefing", { cookie: cookieB }),
    );
    const data = (await jsonOf(response)) as any;

    const kinds = data.items.map((item: any) => item.kind);
    expect(kinds).not.toContain("negotiations");
    expect(kinds).not.toContain("overdue_payments");

    const serialized = JSON.stringify(data);
    for (const id of world.foreignIds) {
      expect(serialized.includes(id)).toBe(false);
    }
  });

  it("спокойный день — короткий список без тревог", async () => {
    // Организация Б: только активный SOS из seedWorld гасим
    memoryDb.remove("sosAlert", world.sosB);

    const data = (await jsonOf(
      await briefingGet(
        makeRequest("GET", "/api/assistant/briefing", { cookie: cookieB }),
      ),
    )) as any;

    const kinds = data.items.map((item: any) => item.kind);
    expect(kinds).not.toContain("sos");
    expect(kinds).not.toContain("overdue_payments");
    expect(kinds).not.toContain("negotiations");
  });

  it("«клиент думает» с истёкшим таймером — пункт брифинга с напоминанием", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000);
    seedOrder("thinkA", world.orgA, {
      status: "negotiation",
      negotiationStatus: "thinking",
      nextFollowUpAt: past,
    });
    // чужая организация в брифинг не попадает
    seedOrder("thinkB", world.orgB, {
      status: "negotiation",
      negotiationStatus: "thinking",
      nextFollowUpAt: past,
    });

    const data = (await jsonOf(
      await briefingGet(
        makeRequest("GET", "/api/assistant/briefing", { cookie: cookieA }),
      ),
    )) as any;

    expect(data.success).toBe(true);
    const item = data.items.find((i: any) => i.kind === "thinking");
    expect(item).toBeTruthy();
    expect(item.title).toContain("1 заказ");
    expect(item.severity).toBe("warn");
    expect(item.message).toContain("истёк");
    expect(item.action?.id).toBe("snooze_followups");
    expect(item.href).toBe("/orders");
  });

  it("без сессии — 401", async () => {
    const response = await briefingGet(
      makeRequest("GET", "/api/assistant/briefing"),
    );
    expect(response.status).toBe(401);
  });
});

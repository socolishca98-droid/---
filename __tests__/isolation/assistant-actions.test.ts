// __tests__/isolation/assistant-actions.test.ts
//
// «Руки» виртуального логиста (POST /api/assistant/act): напоминания о
// просроченных оплатах и перенос напоминаний о контакте — только в границах
// своей организации, повтор в тот же день не плодится.
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

import { POST as actPost } from "@/app/api/assistant/act/route";
import { GET as briefingGet } from "@/app/api/assistant/briefing/route";

let world: World;
let cookieA: string;

const PAST = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

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
    routeTo: "Казань",
    distance: 800,
    weight: 1000,
    cargoType: "Груз",
    clientContact: "",
    clientName: "ООО Ромашка",
    status: "delivered",
    createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    deadline: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
    price: 50000,
    isPaid: false,
    dueDate: PAST,
    nextFollowUpAt: null,
    ...overrides,
  });
  return id;
}

async function act(cookie: string | null, action: string) {
  const response = await actPost(
    makeRequest("POST", "/api/assistant/act", { cookie, body: { action } }),
  );
  return { response, data: await jsonOf(response) };
}

function remindersOf(organizationId: string) {
  return memoryDb
    .rows("notification")
    .filter(
      (row) =>
        row.organizationId === organizationId && row.type === "payment_overdue",
    );
}

beforeEach(async () => {
  world = seedWorld();
  cookieA = await sessionCookie({
    userId: world.adminA,
    role: "admin",
    kind: "staff",
  });
});

describe("действия ассистента (POST /api/assistant/act)", () => {
  it("без сессии — 401, неизвестное действие — 400", async () => {
    const anon = await act(null, "remind_overdue");
    expect(anon.response.status).toBe(401);

    const unknown = await act(cookieA, "sell_company");
    expect(unknown.response.status).toBe(400);
    expect(unknown.data.allowed).toContain("remind_overdue");
  });

  it("remind_overdue: напоминание по своим просроченным, чужие не трогает", async () => {
    const own = seedOrder("act-overdue-a", world.orgA);
    seedOrder("act-overdue-b", world.orgB);

    const { response, data } = await act(cookieA, "remind_overdue");
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.affected).toBe(1);

    const reminders = remindersOf(world.orgA);
    expect(reminders.length).toBe(1);
    expect(reminders[0].orderId).toBe(own);
    // у организации Б напоминаний не появилось
    expect(remindersOf(world.orgB).length).toBe(0);
  });

  it("remind_overdue: повтор в тот же день не плодит уведомления", async () => {
    seedOrder("act-overdue-a", world.orgA);

    await act(cookieA, "remind_overdue");
    const second = await act(cookieA, "remind_overdue");

    expect(second.data.affected).toBe(0);
    expect(second.data.skipped).toBe(1);
    expect(remindersOf(world.orgA).length).toBe(1);
  });

  it("snooze_followups: переносит только свои просроченные напоминания", async () => {
    const own = seedOrder("act-followup-a", world.orgA, {
      status: "negotiation",
      nextFollowUpAt: PAST,
    });
    const foreign = seedOrder("act-followup-b", world.orgB, {
      status: "negotiation",
      nextFollowUpAt: PAST,
    });
    // закрытый заказ не переносится
    const closed = seedOrder("act-followup-closed", world.orgA, {
      status: "delivered",
      nextFollowUpAt: PAST,
    });

    const { response, data } = await act(cookieA, "snooze_followups");
    expect(response.status).toBe(200);
    expect(data.affected).toBe(1);

    const ownRow: any = memoryDb.find("order", own);
    expect(ownRow).toBeTruthy();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(new Date(ownRow.nextFollowUpAt).getDate()).toBe(tomorrow.getDate());
    expect(new Date(ownRow.nextFollowUpAt).getHours()).toBe(10);

    // чужой и закрытый не тронуты
    expect(
      new Date((memoryDb.find("order", foreign) as any).nextFollowUpAt).getTime(),
    ).toBe(PAST.getTime());
    expect(
      new Date((memoryDb.find("order", closed) as any).nextFollowUpAt).getTime(),
    ).toBe(PAST.getTime());
  });

  it("брифинг отдаёт действие у просроченных оплат и напоминаний", async () => {
    seedOrder("act-overdue-a", world.orgA);
    seedOrder("act-followup-a", world.orgA, {
      status: "negotiation",
      nextFollowUpAt: PAST,
      dueDate: null,
    });

    const response = await briefingGet(
      makeRequest("GET", "/api/assistant/briefing", { cookie: cookieA }),
    );
    const data = await jsonOf(response);

    expect(response.status).toBe(200);
    const overdue = data.items.find(
      (item: any) => item.kind === "overdue_payments",
    );
    expect(overdue.action).toEqual({
      id: "remind_overdue",
      label: "Напомнить о просрочке",
    });

    const followups = data.items.find((item: any) => item.kind === "followups");
    expect(followups.action).toEqual({
      id: "snooze_followups",
      label: "Отложить на завтра",
    });
  });
});

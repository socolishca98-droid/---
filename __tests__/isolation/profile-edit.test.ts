// __tests__/isolation/profile-edit.test.ts
//
// Задача 1: редактирование СВОЕГО профиля (PATCH /api/auth/profile).
//
// Что проверяем на настоящих роутах (база — in-memory заглушка):
//   * сотрудник и водитель меняют свои имя и телефон;
//   * водитель: имя и телефон едут в учётную запись И в карточку водителя
//     одной транзакцией — иначе вход в /m и данные логиста разъедутся;
//   * занятый телефон не занимается (учётка и карточка другого водителя);
//   * водитель не может убрать телефон — это его вход в приложение;
//   * роль, организация и email из тела игнорируются: свой аккаунт —
//     только имя и телефон, id берётся из сессии (чужого id в роуте нет);
//   * без сессии — 401;
//   * изменения пишутся в журнал действий (AuditLog), в том числе смена пароля.
//
// Запуск: npm run test:isolation

import { beforeEach, describe, expect, it } from "vitest"

import { memoryDb } from "../__mocks__/prisma-memory"
import { hashPassword } from "@/lib/auth/password"

import {
  jsonOf,
  makeRequest,
  seedWorld,
  sessionCookie,
  type World,
} from "./helpers"

import { GET, PATCH } from "@/app/api/auth/profile/route"
import { POST as changePassword } from "@/app/api/auth/change-password/route"

let world: World
let staffCookieA: string
let logistCookieA: string
let driverCookieA: string

beforeEach(async () => {
  world = seedWorld()
  staffCookieA = await sessionCookie({ userId: world.adminA, role: "admin", kind: "staff" })
  logistCookieA = await sessionCookie({ userId: world.logistA, role: "logist", kind: "staff" })
  driverCookieA = await sessionCookie({
    userId: world.driverUserA,
    role: "driver",
    kind: "driver",
    driverId: world.driverA,
  })
})

function patch(cookie: string, body: Record<string, unknown>) {
  return PATCH(makeRequest("PATCH", "/api/auth/profile", { cookie, body }))
}

function auditRows() {
  return memoryDb.rows("auditLog")
}

describe("PATCH /api/auth/profile: сотрудник", () => {
  it("меняет свои имя и телефон, номер приводится к каноническому виду", async () => {
    const response = await patch(staffCookieA, {
      name: "  Новое   Имя ",
      phone: "+7 (911) 222-33-44",
    })

    expect(response.status).toBe(200)
    const payload = await jsonOf(response)
    expect(payload.success).toBe(true)
    expect(payload.changed).toEqual(["name", "phone"])
    expect(payload.profile.phone).toBe("79112223344")

    const user = memoryDb.find("user", world.adminA)
    expect(user?.name).toBe("Новое Имя")
    expect(user?.phone).toBe("79112223344")
  })

  it("может убрать телефон — сотрудник входит по email", async () => {
    // сначала назначим телефон, затем уберём
    await patch(staffCookieA, { phone: "79111111111" })
    const response = await patch(staffCookieA, { phone: "" })

    expect(response.status).toBe(200)
    expect(memoryDb.find("user", world.adminA)?.phone).toBe(null)
  })

  it("пишет изменение в журнал действий своей организации", async () => {
    await patch(staffCookieA, { name: "Журналист" })

    const entry = auditRows().find((row) => row.action === "profile_update")
    expect(entry).toBeTruthy()
    expect(entry?.actorId).toBe(world.adminA)
    expect(entry?.targetId).toBe(world.adminA)
    expect(entry?.organizationId).toBe(world.orgA)
    const metadata = JSON.parse(String(entry?.metadata))
    expect(metadata.fields).toEqual(["name"])
  })

  it("не занимает телефон, уже занятый другой учётной записью", async () => {
    const response = await patch(staffCookieA, { phone: "79000000002" }) // телефон driverUserB

    expect(response.status).toBe(400)
    const payload = await jsonOf(response)
    expect(payload.error).toMatch(/занят/i)
    // телефон админа А не задан изначально — он таким и остаётся
    expect(memoryDb.find("user", world.adminA)?.phone ?? null).toBe(null)
  })

  it("без изменений отвечает успехом и в журнал не пишет", async () => {
    const before = auditRows().length
    const response = await patch(staffCookieA, { name: "Админ А" })

    expect(response.status).toBe(200)
    const payload = await jsonOf(response)
    expect(payload.changed).toEqual([])
    expect(auditRows().length).toBe(before)
  })

  it("отвергает пустое тело и невалидное имя", async () => {
    expect((await patch(staffCookieA, {})).status).toBe(400)
    expect((await patch(staffCookieA, { name: "Я" })).status).toBe(400)
    expect((await patch(staffCookieA, { phone: "12345" })).status).toBe(400)
  })
})

describe("PATCH /api/auth/profile: водитель", () => {
  it("имя и телефон едут в учётку и в карточку водителя вместе", async () => {
    const response = await patch(driverCookieA, {
      name: "Новый Водитель",
      phone: "89119998877",
    })

    expect(response.status).toBe(200)
    const payload = await jsonOf(response)
    expect(payload.profile.phone).toBe("79119998877")

    const user = memoryDb.find("user", world.driverUserA)
    const driver = memoryDb.find("driver", world.driverA)
    expect(user?.name).toBe("Новый Водитель")
    expect(user?.phone).toBe("79119998877")
    expect(driver?.name).toBe("Новый Водитель")
    expect(driver?.phone).toBe("79119998877")
  })

  it("не может убрать телефон — это его вход в приложение", async () => {
    const response = await patch(driverCookieA, { phone: "" })

    expect(response.status).toBe(400)
    const payload = await jsonOf(response)
    expect(payload.error).toMatch(/вход/i)
    expect(memoryDb.find("user", world.driverUserA)?.phone).toBe("79000000001")
    expect(memoryDb.find("driver", world.driverA)?.phone).toBe("79000000001")
  })

  it("не занимает телефон карточки другого водителя", async () => {
    const response = await patch(driverCookieA, { phone: "79000000002" }) // карточка driverB

    expect(response.status).toBe(400)
    expect(memoryDb.find("driver", world.driverA)?.phone).toBe("79000000001")
  })

  it("не видит и не трогает чужие данные: свой аккаунт — только свой", async () => {
    // водитель А просит телефон водителя Б и имя кем-то ещё — оба отказа
    const crossPhone = await patch(driverCookieA, { phone: "79000000002" })
    expect(crossPhone.status).toBe(400)

    // карточка и учётка Б не тронуты
    expect(memoryDb.find("user", world.driverUserB)?.phone).toBe("79000000002")
    expect(memoryDb.find("driver", world.driverB)?.name).toBe("Водитель Б")
  })
})

describe("PATCH /api/auth/profile: только свой аккаунт", () => {
  it("роль, организация и email из тела не меняются", async () => {
    const response = await patch(logistCookieA, {
      name: "Логист А",
      role: "admin",
      organizationId: world.orgB,
      email: "владелец@пример.рф",
      status: "suspended",
      id: world.adminB,
    })

    expect(response.status).toBe(200)
    const user = memoryDb.find("user", world.logistA)
    expect(user?.role).toBe("logist")
    expect(user?.organizationId).toBe(world.orgA)
    expect(user?.email).toBe("logist@a.test")
    expect(user?.status).toBe("active")
    // заодно: чужая учётная запись не тронута
    expect(memoryDb.find("user", world.adminB)?.name).toBe("Админ Б")
  })

  it("без сессии — 401", async () => {
    const response = await PATCH(
      makeRequest("PATCH", "/api/auth/profile", { body: { name: "Взлом" } }),
    )
    expect(response.status).toBe(401)
  })

  it("GET отдаёт свои данные", async () => {
    const response = await GET(makeRequest("GET", "/api/auth/profile", { cookie: staffCookieA }))

    expect(response.status).toBe(200)
    const payload = await jsonOf(response)
    expect(payload.profile.id).toBe(world.adminA)
    expect(payload.profile.name).toBe("Админ А")
    expect(payload.profile.email).toBe("admin@a.test")
    expect(payload.profile.organizationName).toBe("Организация А")
  })
})

describe("POST /api/auth/change-password: журнал", () => {
  it("успешная смена пароля пишется в журнал, неверный текущий — нет", async () => {
    const { hash, salt } = await hashPassword("СтарыйПароль1")
    const user = memoryDb.find("user", world.adminA)
    if (!user) throw new Error("в тестовой базе нет админа А")
    user.passwordHash = hash
    user.passwordSalt = salt

    const bad = await changePassword(
      makeRequest("POST", "/api/auth/change-password", {
        cookie: staffCookieA,
        body: { currentPassword: "неверный", newPassword: "НовыйПароль2" },
      }),
    )
    expect(bad.status).toBe(403)
    expect(auditRows().find((row) => row.action === "password_change")).toBeUndefined()

    const ok = await changePassword(
      makeRequest("POST", "/api/auth/change-password", {
        cookie: staffCookieA,
        body: { currentPassword: "СтарыйПароль1", newPassword: "НовыйПароль2" },
      }),
    )
    expect(ok.status).toBe(200)

    const entry = auditRows().find((row) => row.action === "password_change")
    expect(entry).toBeTruthy()
    expect(entry?.actorId).toBe(world.adminA)
    expect(entry?.organizationId).toBe(world.orgA)
  })
})

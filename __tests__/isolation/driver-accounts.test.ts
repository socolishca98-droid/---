// __tests__/isolation/driver-accounts.test.ts
//
// Учётные записи водителей не должны пересекаться:
//   * один человек = одна карточка, в каком бы виде ни ввели номер
//     («+7 911 222-33-44», «89112223344» — это один и тот же номер);
//   * карточка и учётка для входа ссылаются на один канонический номер,
//     иначе водитель не может войти (lib/auth/login.ts ищет по normalizePhone);
//   * номер, занятый учётом ДРУГОЙ организации, не перепривязывается:
//     чужой вход остаётся чужим, а логист видит честное объяснение.
//
// Проверяем настоящие роуты; единственная заглушка — in-memory база.
// Запуск: npm run test:isolation

import { beforeEach, describe, expect, it } from "vitest"

import { memoryDb } from "../__mocks__/prisma-memory"
import {
  cid,
  jsonOf,
  makeRequest,
  rowOf,
  routeContext,
  seedWorld,
  sessionCookie,
  type World,
} from "./helpers"

import { POST as driversPost } from "@/app/api/drivers/route"
import { PATCH as driverPatch } from "@/app/api/drivers/[id]/route"

let world: World
let cookieA: string

beforeEach(async () => {
  world = seedWorld()
  cookieA = await sessionCookie({ userId: world.adminA, role: "admin", kind: "staff" })
})

function post(body: Record<string, unknown>) {
  return driversPost(makeRequest("POST", "/api/drivers", { cookie: cookieA, body }))
}

describe("POST /api/drivers: номер водителя", () => {
  it("в карточку и в учётку кладёт один и тот же канонический номер", async () => {
    const response = await post({ name: "Новый Водитель", phone: "+7 (911) 222-33-44" })

    expect(response.status).toBe(200)
    const payload = await jsonOf(response)
    expect(payload.driver.phone).toBe("79112223344")

    // учётка для входа создана с тем же номером — значит, водитель сможет войти
    const account = memoryDb.rows("user").find((row) => row.driverId === payload.driver.id)
    expect(account?.phone).toBe("79112223344")
    expect(account?.organizationId).toBe(world.orgA)
    expect(payload.credentials?.phone).toBe("79112223344")
    expect(payload.credentials?.temporaryPassword).toBeTruthy()
    expect(payload.warning).toBeUndefined()
  })

  it("ведущая восьмёрка и семёрка — один номер, второй карточки не появляется", async () => {
    const first = await post({ name: "Первый", phone: "8 (922) 333-44-55" })
    expect(first.status).toBe(200)
    expect((await jsonOf(first)).driver.phone).toBe("79223334455")

    const second = await post({ name: "Тот же человек", phone: "+79223334455" })

    // Driver.phone @unique: понятный 409, а не дубль человека в автопарке
    expect(second.status).toBe(409)
    const payload = await jsonOf(second)
    expect(payload.success).toBe(false)
    expect(payload.error).toContain("телефон")
    expect(memoryDb.rows("driver").filter((row) => row.phone === "79223334455")).toHaveLength(1)
  })

  it("номер, занятый учётом другой организации, остаётся чужим", async () => {
    // Ситуация достижима: карточку водителя в организации Б удалили,
    // а учётка с номером осталась (User.driverId обнулился).
    const phone = "79334445566"
    memoryDb.insert("user", {
      id: cid("orphanb"),
      organizationId: world.orgB,
      name: "Бывший водитель Б",
      phone,
      passwordHash: "x",
      passwordSalt: "x",
      role: "driver",
      status: "active",
      driverId: null,
    })

    const response = await post({ name: "Наш Водитель", phone: "+7 933 444-55-66" })

    expect(response.status).toBe(200)
    const payload = await jsonOf(response)
    expect(payload.driver.phone).toBe(phone)
    // честно говорим, что вход невозможен, а не обещаем «войдёт под своим паролем»
    expect(payload.warning).toContain("другой организации")
    expect(payload.credentials).toBeNull()

    // чужая учётка не тронута и НЕ привязана к нашей карточке
    const accounts = memoryDb.rows("user").filter((row) => row.phone === phone)
    expect(accounts).toHaveLength(1)
    expect(accounts[0].organizationId).toBe(world.orgB)
    expect(accounts[0].driverId).toBeNull()
  })

  it("учётка своей организации без карточки — вторая учётка не создаётся", async () => {
    // Достижимая ситуация: карточку водителя удалили, а учётка с номером осталась.
    const phone = "79667778899"
    memoryDb.insert("user", {
      id: cid("orphanA"),
      organizationId: world.orgA,
      name: "Прежний водитель А",
      phone,
      passwordHash: "x",
      passwordSalt: "x",
      role: "driver",
      status: "active",
      driverId: null,
    })

    const response = await post({ name: "Тот же человек снова", phone: "+7 (966) 777-88-99" })

    expect(response.status).toBe(200)
    const payload = await jsonOf(response)
    expect(payload.driver.phone).toBe(phone)
    expect(payload.warning).toContain("существующим паролем")
    expect(payload.warning).not.toContain("другой организации")
    expect(payload.credentials).toBeNull()

    // одного человека не развели на два входа: учётка ровно одна и она своя
    const accounts = memoryDb.rows("user").filter((row) => row.phone === phone)
    expect(accounts).toHaveLength(1)
    expect(accounts[0].organizationId).toBe(world.orgA)
    expect(accounts[0].driverId).toBeNull()
  })
})

describe("PATCH /api/drivers/[id]: номер водителя", () => {
  it("правит номер в тот же канонический вид, что и при создании", async () => {
    const response = await driverPatch(
      makeRequest("PATCH", `/api/drivers/${world.driverA}`, {
        cookie: cookieA,
        body: { phone: "8 (955) 111-22-33" },
      }),
      routeContext({ id: world.driverA }),
    )

    expect(response.status).toBe(200)
    // восьмёрка и пробелы со скобками в базу не попадают: там только цифры с семёркой
    expect(rowOf("driver", world.driverA).phone).toBe("79551112233")
  })

  it("нельзя перевести водителя на номер, который уже занят другой карточкой", async () => {
    const created = await post({ name: "Сосед", phone: "8 (944) 555-66-77" })
    expect(created.status).toBe(200)
    expect((await jsonOf(created)).driver.phone).toBe("79445556677")

    const response = await driverPatch(
      makeRequest("PATCH", `/api/drivers/${world.driverA}`, {
        cookie: cookieA,
        body: { phone: "+7 944 555-66-77" },
      }),
      routeContext({ id: world.driverA }),
    )

    // номер занят другой карточкой (Driver.phone @unique) — 409, а не тихая подмена
    expect(response.status).toBe(409)
    expect(rowOf("driver", world.driverA).phone).toBe("79000000001")
  })
})

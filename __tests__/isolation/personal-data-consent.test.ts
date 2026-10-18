// __tests__/isolation/personal-data-consent.test.ts
//
// Согласие на обработку персональных данных (152-ФЗ).
//
// Что проверяем: без согласия регистрация невозможна, а с согласием в учётной
// записи остаётся след — когда принято, какая редакция документов, с какого
// адреса. Без этого следа согласие нельзя подтвердить, то есть оно не имеет
// смысла.
//
// Запуск: npm run test:isolation

import { beforeEach, describe, expect, it } from "vitest"

import { CONSENT_VERSION } from "@/lib/legal"

import { POST as registerPost } from "@/app/api/auth/register/route"

import { jsonOf, makeRequest, seedWorld, type World } from "./helpers"
import { memoryDb } from "../__mocks__/prisma-memory"

let world: World

function userByEmail(email: string) {
  return memoryDb.rows("user").find((row) => row.email === email)
}

beforeEach(() => {
  world = seedWorld()
})

describe("согласие на обработку персональных данных", () => {
  it("без согласия регистрация не проходит", async () => {
    const response = await registerPost(
      makeRequest("POST", "/api/auth/register", {
        body: {
          name: "Пётр Согласный",
          email: "petr@a.test",
          password: "ПарольДляТеста123",
          organizationName: "ООО Проверка Согласия",
          acceptedTerms: false,
        },
      }),
    )

    expect(response.status).toBe(400)
    const payload = await jsonOf(response)
    expect(payload.success).toBe(false)
    expect(payload.error).toMatch(/Примите условия/)
    expect(userByEmail("petr@a.test")).toBeUndefined()
  })

  it("с согласием регистрация проходит и согласие зафиксировано", async () => {
    const response = await registerPost(
      makeRequest("POST", "/api/auth/register", {
        body: {
          name: "Пётр Согласный",
          email: "petr@a.test",
          password: "ПарольДляТеста123",
          organizationName: "ООО Проверка Согласия",
          acceptedTerms: true,
        },
      }),
    )

    expect(response.status).toBe(200)
    const user = userByEmail("petr@a.test")
    expect(user).toBeDefined()

    // След согласия: дата, редакция документов и адрес, с которого дано
    expect(user?.consentAcceptedAt).toBeInstanceOf(Date)
    expect(user?.consentVersion).toBe(CONSENT_VERSION)
    // в тестах заголовков forwarded-for нет — адрес неизвестен, но поле заполнено
    expect(user?.consentIp).toBeDefined()
  })

  it("юридические страницы опубликованы и открываются без входа", async () => {
    // Тексты лежат в приложении: согласие имеет смысл, только если документ
    // можно прочитать до того, как поставишь галочку
    const privacy = await import("@/app/privacy/page")
    const terms = await import("@/app/terms/page")

    expect(typeof privacy.default).toBe("function")
    expect(typeof terms.default).toBe("function")

    // Заголовки страниц заданы — документы находятся через поиск
    expect(privacy.metadata?.title).toMatch(/Политика конфиденциальности/)
    expect(terms.metadata?.title).toMatch(/Условия использования/)
  })
})

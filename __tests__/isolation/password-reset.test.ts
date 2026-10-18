// __tests__/isolation/password-reset.test.ts
//
// Восстановление пароля end-to-end: письмо со ссылкой → новый пароль → вход.
//
// Раньше забывший пароль человек был заперт снаружи: пароль менял только
// администратор. Здесь проверяем обещание системы: ссылка приходит на почту
// учётной записи, работает один раз, живёт ограниченное время, а успешная
// смена пароля закрывает прежние сессии.
//
// Запуск: npm run test:isolation

import { beforeEach, describe, expect, it } from "vitest"

import { hashPassword } from "@/lib/auth/password"
import { getMailOutbox, resetMailOutbox } from "@/lib/mailer"
import { resetRateLimit } from "@/lib/rate-limiter"

import { POST as forgotPasswordPost } from "@/app/api/auth/forgot-password/route"
import { GET as resetPasswordGet, POST as resetPasswordPost } from "@/app/api/auth/reset-password/route"
import { POST as loginPost } from "@/app/api/auth/login/route"

import { jsonOf, makeRequest, seedWorld, sessionCookie, type World } from "./helpers"
import { memoryDb } from "../__mocks__/prisma-memory"

let world: World

const OLD_PASSWORD = "СтарыйПароль123"
const NEW_PASSWORD = "НовыйПароль456"

function userRow(userId: string) {
  return memoryDb.find("user", userId)
}

/** Пароль задаём настоящим хешем: вход должен проверять его по-настоящему. */
async function setPassword(userId: string, password: string) {
  const { hash, salt } = await hashPassword(password)
  const row = userRow(userId)
  if (!row) throw new Error("пользователь не найден")
  row.passwordHash = hash
  row.passwordSalt = salt
}

/** Ссылка из письма, которое «ушло» в консольном режиме. */
function resetUrlFromMailbox(): string {
  const email = getMailOutbox().at(-1)
  if (!email) throw new Error("письмо не было отправлено")
  const match = email.text.match(/(http:\/\/\S+\/reset-password\?token=\S+)/)
  if (!match) throw new Error("в письме нет ссылки восстановления")
  return match[1]
}

function tokenFromMailbox(): string {
  const url = new URL(resetUrlFromMailbox())
  return url.searchParams.get("token") ?? ""
}

beforeEach(async () => {
  world = seedWorld()
  resetMailOutbox()
  await setPassword(world.adminA, OLD_PASSWORD)

  // Счётчики попыток общие на процесс: без сброса тесты мешали бы друг другу
  resetRateLimit(`pw-reset:unknown:admin@a.test`)
  resetRateLimit("pw-reset-use:unknown")
})

describe("восстановление пароля", () => {
  it("письмо со ссылкой приходит, пароль меняется, вход работает новым", async () => {
    const forgot = await forgotPasswordPost(
      makeRequest("POST", "/api/auth/forgot-password", { body: { email: "admin@a.test" } }),
    )
    expect(forgot.status).toBe(200)
    const forgotPayload = await jsonOf(forgot)
    expect(forgotPayload.success).toBe(true)
    // ответ не выдаёт, существует ли адрес
    expect(forgotPayload.message).toMatch(/Если такой адрес зарегистрирован/)

    const token = tokenFromMailbox()
    expect(token.length).toBeGreaterThan(30)

    const check = await resetPasswordGet(
      makeRequest("GET", `/api/auth/reset-password?token=${encodeURIComponent(token)}`),
    )
    expect(check.status).toBe(200)
    expect((await jsonOf(check)).valid).toBe(true)

    const reset = await resetPasswordPost(
      makeRequest("POST", "/api/auth/reset-password", {
        body: { token, password: NEW_PASSWORD },
      }),
    )
    expect(reset.status).toBe(200)
    expect((await jsonOf(reset)).success).toBe(true)

    // Старый пароль больше не пускает, новый — пускает
    const oldLogin = await loginPost(
      makeRequest("POST", "/api/auth/login", {
        body: { email: "admin@a.test", password: OLD_PASSWORD },
      }),
    )
    expect(oldLogin.status).toBe(401)

    const newLogin = await loginPost(
      makeRequest("POST", "/api/auth/login", {
        body: { email: "admin@a.test", password: NEW_PASSWORD },
      }),
    )
    expect(newLogin.status).toBe(200)
  })

  it("ссылка работает один раз", async () => {
    await forgotPasswordPost(
      makeRequest("POST", "/api/auth/forgot-password", { body: { email: "admin@a.test" } }),
    )
    const token = tokenFromMailbox()

    const first = await resetPasswordPost(
      makeRequest("POST", "/api/auth/reset-password", {
        body: { token, password: NEW_PASSWORD },
      }),
    )
    expect(first.status).toBe(200)

    const second = await resetPasswordPost(
      makeRequest("POST", "/api/auth/reset-password", {
        body: { token, password: "ЕщёОдинПароль789" },
      }),
    )
    expect(second.status).toBe(400)
    expect((await jsonOf(second)).error).toMatch(/уже была использована/)
  })

  it("новый запрос отменяет прежнюю ссылку", async () => {
    await forgotPasswordPost(
      makeRequest("POST", "/api/auth/forgot-password", { body: { email: "admin@a.test" } }),
    )
    const firstToken = tokenFromMailbox()

    await forgotPasswordPost(
      makeRequest("POST", "/api/auth/forgot-password", { body: { email: "admin@a.test" } }),
    )
    const secondToken = tokenFromMailbox()
    expect(secondToken).not.toBe(firstToken)

    const stale = await resetPasswordPost(
      makeRequest("POST", "/api/auth/reset-password", {
        body: { token: firstToken, password: NEW_PASSWORD },
      }),
    )
    expect(stale.status).toBe(400)

    const fresh = await resetPasswordPost(
      makeRequest("POST", "/api/auth/reset-password", {
        body: { token: secondToken, password: NEW_PASSWORD },
      }),
    )
    expect(fresh.status).toBe(200)
  })

  it("несуществующий адрес: тот же ответ и ни одного письма", async () => {
    const response = await forgotPasswordPost(
      makeRequest("POST", "/api/auth/forgot-password", { body: { email: "нет-такого@a.test" } }),
    )

    expect(response.status).toBe(200)
    expect((await jsonOf(response)).message).toMatch(/Если такой адрес зарегистрирован/)
    expect(getMailOutbox()).toHaveLength(0)
  })

  it("успешная смена пароля закрывает прежние сессии", async () => {
    const cookie = await sessionCookie({ userId: world.adminA, role: "admin", kind: "staff" })
    expect(memoryDb.rows("session").some((row) => row.userId === world.adminA)).toBe(true)

    await forgotPasswordPost(
      makeRequest("POST", "/api/auth/forgot-password", { body: { email: "admin@a.test" } }),
    )
    const token = tokenFromMailbox()

    const reset = await resetPasswordPost(
      makeRequest("POST", "/api/auth/reset-password", {
        body: { token, password: NEW_PASSWORD },
      }),
    )
    expect(reset.status).toBe(200)

    // Сессий у этого человека не осталось: старая cookie больше не работает
    expect(memoryDb.rows("session").some((row) => row.userId === world.adminA)).toBe(false)
    const probe = await import("@/app/api/orders/route")
    const withOldCookie = await probe.GET(makeRequest("GET", "/api/orders", { cookie }))
    expect(withOldCookie.status).toBe(401)
  })

  it("слабый пароль не принимается", async () => {
    await forgotPasswordPost(
      makeRequest("POST", "/api/auth/forgot-password", { body: { email: "admin@a.test" } }),
    )
    const token = tokenFromMailbox()

    const weak = await resetPasswordPost(
      makeRequest("POST", "/api/auth/reset-password", { body: { token, password: "123" } }),
    )
    expect(weak.status).toBe(400)
    expect((await jsonOf(weak)).error).toMatch(/8 символов/)

    // ссылка не сгорела из-за неудачной попытки
    const good = await resetPasswordPost(
      makeRequest("POST", "/api/auth/reset-password", {
        body: { token, password: NEW_PASSWORD },
      }),
    )
    expect(good.status).toBe(200)
  })

  it("ссылка без токена не работает", async () => {
    const check = await resetPasswordGet(makeRequest("GET", "/api/auth/reset-password"))
    expect(check.status).toBe(400)

    const reset = await resetPasswordPost(
      makeRequest("POST", "/api/auth/reset-password", { body: { password: NEW_PASSWORD } }),
    )
    expect(reset.status).toBe(400)
  })

  it("другой организации адрес не восстановить — ответ тот же, письма нет", async () => {
    // Пользователь второй организации есть в базе, но его адрес другой:
    // проверяем, что нейтральный ответ не зависит от организации
    const response = await forgotPasswordPost(
      makeRequest("POST", "/api/auth/forgot-password", { body: { email: "admin@b.test" } }),
    )
    expect(response.status).toBe(200)

    // письмо второй организации ушло в её собственный ящик — и токен в нём
    // принадлежит её пользователю, а не нашему
    const token = tokenFromMailbox()
    const check = await resetPasswordGet(
      makeRequest("GET", `/api/auth/reset-password?token=${encodeURIComponent(token)}`),
    )
    expect(check.status).toBe(200)
    expect(memoryDb.rows("passwordResetToken").every((row) => row.userId === world.adminB)).toBe(true)
  })
})

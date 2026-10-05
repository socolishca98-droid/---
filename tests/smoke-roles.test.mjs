/**
 * Тесты смоука по ролям (scripts/smoke-roles.mjs).
 *
 * Проверяется сам инструмент: против карманного сервера, который ведёт себя
 * как боевое приложение (роли, cookie, закрытые роуты), смоук должен пройти;
 * стоит серверу пустить логиста в админку — смоук обязан это заметить.
 * Отдельный сценарий — недоступный сервер: понятная ошибка, а не тихий успех.
 *
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { createServer } from "node:http"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const script = join(root, "scripts", "smoke-roles.mjs")

/**
 * Карманный сервер с моделью доступа боевого приложения:
 *   администратор — всё своё, логист — без админки, водитель — только /api/m,
 *   гость — ничего. Параметр leakAdmin=true ломает модель (логист попадает
 *   в админку), чтобы проверить, что смоук это ловит.
 */
function startFakeServer({ leakAdmin = false } = {}) {
  const server = createServer((request, response) => {
    let body = ""
    request.on("data", (chunk) => {
      body += chunk
    })
    request.on("end", () => {
      const url = new URL(request.url, "http://localhost")
      const path = url.pathname
      const cookie = request.headers.cookie || ""
      const send = (status, payload, setCookie) => {
        const headers = { "content-type": "application/json" }
        if (setCookie) headers["set-cookie"] = setCookie
        response.writeHead(status, headers)
        response.end(JSON.stringify(payload))
      }

      if (path === "/api/health") return send(200, { status: "ok", database: "ok" })

      // ── вход ────────────────────────────────────────────────────────────
      if (path === "/api/auth/login" && request.method === "POST") {
        const data = JSON.parse(body || "{}")
        if (data.email === "admin@test" && data.password === "secret") {
          return send(200, { success: true, user: { role: "admin" } }, "loginex_staff_session=admin-token; Path=/")
        }
        if (data.email === "logist@test" && data.password === "secret") {
          return send(200, { success: true, user: { role: "logist" } }, "loginex_staff_session=logist-token; Path=/")
        }
        return send(401, { success: false, error: "Неверные данные" })
      }

      if (path === "/api/m/login" && request.method === "POST") {
        const data = JSON.parse(body || "{}")
        if (data.phone === "+79990000000" && data.password === "secret") {
          return send(200, { success: true }, "loginex_driver_session=driver-token; Path=/")
        }
        return send(401, { success: false, error: "Неверные данные" })
      }

      const isAdmin = cookie.includes("loginex_staff_session=admin-token")
      const isLogist = cookie.includes("loginex_staff_session=logist-token")
      const isDriver = cookie.includes("loginex_driver_session=driver-token")
      const isStaff = isAdmin || isLogist

      // ── админка ─────────────────────────────────────────────────────────
      if (path === "/api/admin/audit") {
        if (isAdmin) return send(200, { success: true, items: [] })
        if (leakAdmin && isLogist) return send(200, { success: true, items: [] })
        return send(401, { success: false, error: "Нет доступа" })
      }

      // ── настройки организации ───────────────────────────────────────────
      if (path === "/api/org-settings") {
        if (!isStaff) return send(401, { success: false, error: "Нет доступа" })
        if (request.method === "POST" && !isAdmin) {
          return send(403, { success: false, error: "Только администратор" })
        }
        return send(200, { success: true, settings: { atiEnabled: true, plan: "trial" } })
      }

      // ── staff-API ───────────────────────────────────────────────────────
      if (path === "/api/vehicles") {
        return isStaff
          ? send(200, { success: true, vehicles: [] })
          : send(401, { success: false, error: "Нет доступа" })
      }
      if (path === "/api/orders") {
        return isStaff
          ? send(200, { success: true, orders: [] })
          : send(401, { success: false, error: "Нет доступа" })
      }

      // ── API водителя ────────────────────────────────────────────────────
      if (path === "/api/m/me" || path === "/api/m/orders") {
        return isDriver
          ? send(200, { success: true })
          : send(403, { success: false, error: "Только водитель" })
      }

      return send(404, { success: false, error: "Не найдено" })
    })
  })

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        stop: () => new Promise((done) => server.close(done)),
      })
    })
  })
}

/**
 * Асинхронно: spawnSync заблокировал бы событийный цикл, и этот же процесс
 * не смог бы ответить на запросы смоука — прогон падал бы по таймауту.
 */
function runSmoke(baseUrl) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      cwd: root,
      env: {
        ...process.env,
        BASE_URL: baseUrl,
        ADMIN_EMAIL: "admin@test",
        ADMIN_PASSWORD: "secret",
        LOGIST_EMAIL: "logist@test",
        LOGIST_PASSWORD: "secret",
        DRIVER_PHONE: "+79990000000",
        DRIVER_PASSWORD: "secret",
      },
    })
    let out = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      out += chunk
    })
    child.stderr.on("data", (chunk) => {
      out += chunk
    })
    child.on("close", (code) => resolve({ code, out }))
  })
}

test("роль ведёт себя правильно — смоук проходит целиком", async () => {
  const server = await startFakeServer()
  try {
    const { code, out } = await runSmoke(server.baseUrl)
    assert.equal(code, 0, `смоук провалился:\n${out}`)
    assert.match(out, /администратор: вход в кабинет/)
    assert.match(out, /логист: POST \/api\/org-settings запрещён/)
    assert.match(out, /водитель: staff-API/)
    assert.doesNotMatch(out, /✗/)
  } finally {
    await server.stop()
  }
})

test("логист пробрался в админку — смоук обязан это заметить", async () => {
  const server = await startFakeServer({ leakAdmin: true })
  try {
    const { code, out } = await runSmoke(server.baseUrl)
    assert.equal(code, 1)
    assert.match(out, /админка/)
    assert.match(out, /Провалено проверок/)
  } finally {
    await server.stop()
  }
})

test("недоступный сервер — понятная ошибка и код 1, а не тихий успех", () => {
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, BASE_URL: "http://127.0.0.1:1" },
  })
  const out = `${result.stdout || ""}${result.stderr || ""}`
  assert.equal(result.status, 1)
  assert.match(out, /недоступен/)
  assert.match(out, /BASE_URL/)
})

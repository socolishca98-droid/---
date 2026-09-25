/**
 * Страж мобильной сессии.
 *
 * История: после задачи 1 вход водителя переехал на серверные сессии
 * (httpOnly-cookie), а страницы мобильного контура продолжали читать
 * «driver_session» из localStorage. Такой записи больше никто не создавал, и
 * каждое открытие «Рейсов», «Фото», «Профиля» заканчивалось возвратом на
 * экран логина — мобильное приложение было недоступно целиком.
 *
 * Тест не даёт этому вернуться: любая страница /m/* обязана брать водителя из
 * useDriverSession и не должна искать его в localStorage.
 */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const mobileDir = path.join(root, "app", "m")

function collectPages(dir) {
  const found = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...collectPages(absolute))
    else if (entry.name === "page.tsx" || entry.name === "page.ts") found.push(absolute)
  }
  return found
}

const pages = collectPages(mobileDir)
const sessionKeyPattern = /localStorage\.(getItem|setItem|removeItem)\(\s*["'](driver_?[Ss]ession|driver_id)["']/

test("в мобильном контуре есть страницы для проверки", () => {
  assert.ok(pages.length >= 6, `найдено страниц: ${pages.length}`)
})

test("сессию водителя страницы берут с сервера, а не из localStorage", () => {
  for (const page of pages) {
    const relative = path.relative(root, page)
    const source = fs.readFileSync(page, "utf-8")

    assert.ok(
      !sessionKeyPattern.test(source),
      `${relative}: сессия ищется в localStorage — после перехода на серверные сессии такой записи нет`,
    )

    // Экран логина сам создаёт сессию, ему хук не нужен
    if (relative.endsWith(path.join("m", "login", "page.tsx"))) continue

    assert.match(
      source,
      /useDriverSession/,
      `${relative}: страница водителя должна получать сессию через useDriverSession`,
    )
  }
})

test("подмена водителя из localStorage в мобильном контуре не осталась нигде", () => {
  const offenders = []

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(absolute)
        continue
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue

      const source = fs.readFileSync(absolute, "utf-8")
      if (sessionKeyPattern.test(source)) offenders.push(path.relative(root, absolute))
    }
  }

  walk(mobileDir)

  assert.deepEqual(offenders, [], `чтение сессии водителя из localStorage: ${offenders.join(", ")}`)
})

test("страница выбора машины достижима: на неё ведёт ссылка", () => {
  const links = []
  const targets = [path.join(root, "app", "m"), path.join(root, "components", "driver-mobile")]

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(absolute)
        continue
      }
      if (!/\.tsx$/.test(entry.name)) continue
      const source = fs.readFileSync(absolute, "utf-8")
      if (/href=["']\/m\/vehicle["']|push\(["']\/m\/vehicle["']/.test(source)) {
        links.push(path.relative(root, absolute))
      }
    }
  }

  for (const target of targets) walk(target)

  assert.ok(
    links.length > 0,
    "на /m/vehicle никто не ссылается — страница недостижима для водителя",
  )
})

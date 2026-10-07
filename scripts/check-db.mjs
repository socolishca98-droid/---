#!/usr/bin/env node
// scripts/check-db.mjs
//
// Диагностика подключения к базе. Запуск:
//
//   npm run db:check
//
// Проверяет три вещи, которые чаще всего ломаются при переезде на Supabase:
//   1. DATABASE_URL задан и его протокол поддерживается;
//   2. сгенерированный Prisma-клиент соответствует этому протоколу
//      (частая ошибка: клиент собран под SQLite, а URL — Postgres);
//   3. база реально отвечает и таблицы на месте.
//
// Код возврата 0 — всё хорошо, 1 — есть проблема (с подсказкой, что делать).

import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { isPostgresUrl, loadDotEnv, resolveSchemaPath } from "./prisma-schema.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

// .env читаем до обращения к DATABASE_URL и до импорта Prisma-клиента.
loadDotEnv()

const url = (process.env.DATABASE_URL || "").trim()
let failed = false

function ok(text) {
  console.log(`  ✓ ${text}`)
}
function bad(text, hint) {
  failed = true
  console.log(`  ✗ ${text}`)
  if (hint) console.log(`      → ${hint}`)
}

console.log("Проверка подключения к базе данных\n")

// 1. Переменная окружения
if (!url) {
  bad(
    "DATABASE_URL не задан",
    "Скопируйте .env.example в .env и заполните DATABASE_URL (локально) или задайте переменную в Vercel → Settings → Environment Variables",
  )
} else {
  const safe = url.replace(/:\/\/[^@]*@/, "://****:****@")
  ok(`DATABASE_URL найден: ${safe}`)
  if (!isPostgresUrl(url) && !url.startsWith("file:")) {
    bad(
      "Неизвестный протокол DATABASE_URL",
      "Ожидается file: (SQLite) либо postgresql:// (Supabase/Postgres)",
    )
  }
}

// 2. Совпадение клиента и URL — самая частая ошибка после переезда
if (!failed) {
  const schemaPath = resolveSchemaPath(url)
  const generate = spawnSync(
    process.execPath,
    [join(root, "scripts", "prisma-schema.mjs"), "generate"],
    { cwd: root, encoding: "utf8" },
  )
  if (generate.status !== 0) {
    bad(
      "Не удалось сгенерировать Prisma-клиент",
      "Проверьте вывод выше: чаще всего это опечатка в DATABASE_URL",
    )
  } else {
    ok(`Prisma-клиент соответствует схеме ${schemaPath}`)
  }
}

// 3. Живой запрос к базе
if (!failed) {
  const { PrismaClient } = await import("@prisma/client")
  const prisma = new PrismaClient()
  try {
    await prisma.$queryRaw`SELECT 1`
    const [users, organizations] = await Promise.all([
      prisma.user.count(),
      prisma.organization.count(),
    ])
    ok(`База отвечает: учётных записей ${users}, организаций ${organizations}`)
    if (users === 0) {
      console.log(
        "\n  ! Таблицы есть, но учётных записей нет — создайте первого администратора:\n" +
          "      npm run seed:auth      (данные берутся из .env)",
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    bad(`Запрос к базе не выполнился: ${message.split("\n").filter(Boolean)[0] ?? ""}`)
    if (message.includes("protocol `file:`")) {
      console.log(
        "      → Клиент собран под SQLite. Выполните: npm run db:generate (он выберет схему по DATABASE_URL)",
      )
    } else if (/relation .* does not exist|no such table/i.test(message)) {
      console.log("      → Таблиц нет. Выполните: npm run db:push")
    } else if (/ECONNREFUSED|ENOTFOUND|Can't reach database/i.test(message)) {
      console.log(
        "      → База недоступна: проверьте host/порт из Supabase (Connect → Direct / Session pooler) и что проект не на паузе",
      )
    }
  } finally {
    await prisma.$disconnect()
  }
}

console.log(
  failed
    ? "\nИтог: есть проблемы — см. подсказки выше.\n"
    : "\nИтог: подключение в порядке.\n",
)
process.exit(failed ? 1 : 0)

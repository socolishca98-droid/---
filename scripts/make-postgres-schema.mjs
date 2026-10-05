// scripts/make-postgres-schema.mjs
//
// Единый источник истины по схеме — prisma/schema.prisma (SQLite, разработка).
// Для PostgreSQL-развёртывания этот скрипт генерирует prisma/postgres/schema.prisma:
// тот же набор моделей, но provider = "postgresql" и жёсткая мультитенантность.
//
// Зачем генерация, а не второй файл в репозитории: две схемы, которые правятся
// вручную, неизбежно разъезжаются. Сгенерированный файл в git не коммитится.
//
// Отдельный каталог prisma/postgres/ нужен ещё и потому, что Prisma ищет
// миграции рядом со схемой: так у PostgreSQL свой prisma/postgres/migrations,
// и он не конфликтует с SQLite-миграциями в prisma/migrations.
//
// Что ужесточается по сравнению с разработкой:
//   organizationId String? → String (NOT NULL) во всех бизнес-моделях.
// В SQLite поле сделано nullable исторически: так проще было отлаживать
// мультитенантность. В продакшене «запись ничейная» — это дыра, а не удобство:
// база обязана не дать создать строку без организации.
//
// Исключения (остаются nullable — иначе ломаются реальные сценарии):
//   • User — заявка на присоединение и учётка до выбора организации;
//   • AuditLog — действия владельца платформы вне конкретной организации;
//   • PushSubscription — подписка может пережить вывод сотрудника из организации.
//
// Использование:
//   npm run schema:postgres

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "prisma", "schema.prisma");
const targetDir = join(root, "prisma", "postgres");
const target = join(targetDir, "schema.prisma");

/**
 * Модели, где организация обязательна. Список проверен скриптом:
 * каждое создание такой записи в коде проставляет organizationId.
 * Если появится модель бизнес-данных — добавьте её сюда.
 */
const STRICT_ORGANIZATION_MODELS = [
  "AtiCache",
  "AtiConnection",
  "AtiScanConfig",
  "ChatMessage",
  "Client",
  "Driver",
  "DriverShift",
  "FleetSettings",
  "MaintenanceLog",
  "Notification",
  "Order",
  "OrderNegotiation",
  "Photo",
  "Route",
  "RouteEvent",
  "RouteExpense",
  "RouteStage",
  "ShiftEvent",
  "SosAlert",
  "Vehicle",
];

const original = readFileSync(source, "utf8");

if (!/provider\s*=\s*"sqlite"/.test(original)) {
  console.error(
    "Ожидали provider = \"sqlite\" в prisma/schema.prisma — проверьте схему, генерация отменена.",
  );
  process.exit(1);
}

let postgres = original.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"');

// ── Жёсткая мультитенантность: organisationId NOT NULL в бизнес-моделях ────
const tightened = [];
const seen = [];
for (const model of STRICT_ORGANIZATION_MODELS) {
  const blockRe = new RegExp(`(^model ${model} \\{[\\s\\S]*?^\\})`, "m");
  const block = postgres.match(blockRe);
  if (!block) {
    console.error(
      `Модель ${model} не найдена в prisma/schema.prisma — список STRICT_ORGANIZATION_MODELS устарел.`,
    );
    process.exit(1);
  }
  if (!/organizationId\s+String\?/.test(block[1])) {
    console.error(
      `В модели ${model} нет organizationId String? — проверьте схему или список.`,
    );
    process.exit(1);
  }
  let next = block[1].replace(/organizationId\s+String\?/, "organizationId String");
  next = next.replace(
    /(\borganization\s+)Organization\?(\s+@relation)/,
    "$1Organization$2",
  );
  postgres = postgres.replace(block[1], next);
  tightened.push(model);
  seen.push(model);
}

const banner = [
  "// prisma/postgres/schema.prisma — СГЕНЕРИРОВАННЫЙ ФАЙЛ, не править вручную.",
  "// Источник истины: prisma/schema.prisma. Перегенерация: npm run schema:postgres",
  "//",
  "// Отличие от исходника: provider = postgresql и organizationId NOT NULL",
  "// во всех бизнес-моделях (в разработке на SQLite поле nullable).",
  "// Исключения: User, AuditLog, PushSubscription — им организация не обязательна.",
  "",
].join("\n");

mkdirSync(targetDir, { recursive: true });
writeFileSync(target, banner + postgres, "utf8");

const models = (postgres.match(/^model\s+\w+/gm) || []).length;
console.log(
  `✓ prisma/postgres/schema.prisma: ${models} моделей, provider = postgresql, ` +
    `организация обязательна в ${tightened.length} моделях`,
);

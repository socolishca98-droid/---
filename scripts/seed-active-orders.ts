/**
 * Активные заказы для помощника сборки (демо/тест).
 *
 *   npm run seed:active-orders [-- --email admin@example.ru]
 *
 * Зачем: помощник сборки берёт заказы без рейса на этапах «Поиск» и
 * «Согласование» (isRouteableForAssistant). Демо-заказы seed-demo живут
 * на конечных этапах (delivered/cancelled) — собрать из них нечего, и
 * помощник честно показывает «собирать нечего». Этот скрипт добавляет
 * 6 заказов на активных этапах без рейса, чтобы сборку можно было
 * протестировать: маршруты вокруг базы (Домодедово), разные веса и кузова.
 *
 * Идемпотентен: записи `demo-active-*` перезаписываются.
 * Очистка: npm run seed:active-orders -- --clean
 */
import { prisma } from "../lib/prisma"

const DAY = 24 * 60 * 60 * 1000
const PREFIX = "demo-active-"

function env(name: string): string {
  return (process.env[name] || "").trim()
}

function args(): { email?: string; org?: string; clean: boolean; sql: boolean } {
  const argv = process.argv.slice(2)
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  return {
    email: get("--email"),
    org: get("--org"),
    clean: argv.includes("--clean"),
    sql: argv.includes("--sql"),
  }
}

const daysFromNow = (days: number): Date => new Date(Date.now() + days * DAY)

type SeedOrder = {
  n: number
  status: "search" | "negotiation"
  routeFrom: string
  routeTo: string
  distance: number
  weight: number // кг
  volume?: number // м³
  cargoType: string
  loadingType: string
  price: number // ₽
  priceNegotiable?: boolean
  paymentType: string
  vatType: string
  clientName: string
  clientContact: string
  requirements?: string
  deadlineInDays: number
  aiScore: number
  aiReason: string
}

/** 6 заказов без рейса на активных этапах (3 «Поиск» + 3 «Согласование»). */
const ORDERS: SeedOrder[] = [
  {
    n: 1,
    status: "search",
    routeFrom: "Москва, улица Складочная, 8",
    routeTo: "Воронеж, улица Димитрова, 148",
    distance: 526,
    weight: 18000,
    volume: 82,
    cargoType: "Хозтовары, паллеты",
    loadingType: "pallets",
    price: 52000,
    paymentType: "bank",
    vatType: "with_vat",
    clientName: "ООО «Ромашка»",
    clientContact: "Петрова Ольга, +7 495 123-45-67",
    requirements: "Погрузка с 9:00, пломба на дверях, выгрузка на склад",
    deadlineInDays: 2,
    aiScore: 78,
    aiReason: "99 ₽/км, полная загрузка, рядом с базой",
  },
  {
    n: 2,
    status: "search",
    routeFrom: "Москва, улица Складочная, 8",
    routeTo: "Тула, улица Рязанская, 38",
    distance: 193,
    weight: 9000,
    volume: 36,
    cargoType: "Оборудование, запчасти",
    loadingType: "other",
    price: 17500,
    priceNegotiable: true,
    paymentType: "cash",
    vatType: "no_vat",
    clientName: "ООО «МашЗапчасть»",
    clientContact: "Комаров Илья, +7 925 900-83-46",
    deadlineInDays: 1,
    aiScore: 71,
    aiReason: "91 ₽/км, короткий рейс — можно взять с обратом",
  },
  {
    n: 3,
    status: "search",
    routeFrom: "Домодедово, улица Логистическая, 12",
    routeTo: "Калуга, улица Московская, 289",
    distance: 218,
    weight: 12000,
    volume: 50,
    cargoType: "Стройматериалы, сухие смеси",
    loadingType: "pallets",
    price: 21000,
    paymentType: "bank",
    vatType: "with_vat",
    clientName: "ООО «ТехноСтрой»",
    clientContact: "Гаврилов Игорь, +7 812 123-45-67",
    requirements: "Кран на погрузке не нужен, загрузка вилами",
    deadlineInDays: 3,
    aiScore: 75,
    aiReason: "96 ₽/км, выгрузка во дворе — нужно согласовать время",
  },
  {
    n: 4,
    status: "negotiation",
    routeFrom: "Домодедово, улица Логистическая, 12",
    routeTo: "Рязань, улица Ситниковская, 67",
    distance: 296,
    weight: 20000,
    volume: 86,
    cargoType: "Мебель, в коробах",
    loadingType: "pallets",
    price: 34000,
    priceNegotiable: true,
    paymentType: "bank",
    vatType: "with_vat",
    clientName: "ООО «Ромашка»",
    clientContact: "Петрова Ольга, +7 495 123-45-67",
    requirements: "Кантоваться запрещено, 2 заезда на выгрузке",
    deadlineInDays: 2,
    aiScore: 83,
    aiReason: "115 ₽/км, ждёт согласования цены — торг уместен",
  },
  {
    n: 5,
    status: "negotiation",
    routeFrom: "Тверь, улица Индустриальная, 5",
    routeTo: "Санкт-Петербург, Шушары, Московское шоссе, 70",
    distance: 471,
    weight: 22000,
    volume: 86,
    cargoType: "Бытовая техника, в коробах",
    loadingType: "pallets",
    price: 58000,
    priceNegotiable: true,
    paymentType: "bank",
    vatType: "with_vat",
    clientName: "АО «Северный Путь»",
    clientContact: "Белова Марина, +7 482 212-34-56",
    requirements: "Тент 2,45 м, стяжные ремни — со стороны груза",
    deadlineInDays: 4,
    aiScore: 86,
    aiReason: "123 ₽/км, северное направление — востребовано",
  },
  {
    n: 6,
    status: "negotiation",
    routeFrom: "Москва, улица Складочная, 8",
    routeTo: "Владимир, улица Тракторная, 45",
    distance: 196,
    weight: 14000,
    volume: 60,
    cargoType: "Продукты питания, сухие",
    loadingType: "pallets",
    price: 23000,
    priceNegotiable: true,
    paymentType: "cash",
    vatType: "no_vat",
    clientName: "ООО «Ромашка»",
    clientContact: "Петрова Ольга, +7 495 123-45-67",
    deadlineInDays: 1,
    aiScore: 80,
    aiReason: "117 ₽/км, короткий рейс с хорошей ставкой",
  },
]

/** SQL-литерал: значение или NULL. */
function lit(value: unknown): string {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") return String(value)
  return `'${String(value).replace(/'/g, "''")}'`
}

async function resolveOrganizationId(
  email?: string,
  orgId?: string
): Promise<string> {
  if (orgId) return orgId
  if (email) {
    const user = await prisma.user.findUnique({ where: { email } })
    if (user?.organizationId) return user.organizationId
  }
  const staff = await prisma.user.findFirst({
    where: { role: { in: ["admin", "logist"] }, organizationId: { not: null } },
  })
  if (staff?.organizationId) return staff.organizationId
  const first = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
  })
  if (!first) {
    throw new Error("В базе нет организаций — сначала запустите npm run seed:demo")
  }
  return first.id
}

/** Печатает Postgres-скрипт для Supabase (превью/прод). */
function printSql(email?: string): void {
  const orgExpr = email
    ? `COALESCE((SELECT "organizationId" FROM "User" WHERE email = ${lit(email)} LIMIT 1), (SELECT "organizationId" FROM "User" WHERE role IN ('admin','logist') AND "organizationId" IS NOT NULL ORDER BY "createdAt" LIMIT 1))`
    : `(SELECT "organizationId" FROM "User" WHERE role IN ('admin','logist') AND "organizationId" IS NOT NULL ORDER BY "createdAt" LIMIT 1)`
  const columns = [
    'id', '"organizationId"', 'source', '"routeFrom"', '"routeTo"', 'distance',
    'weight', 'volume', '"cargoType"', '"loadingType"', 'requirements', 'price',
    '"priceNegotiable"', '"paymentType"', '"vatType"', '"clientName"',
    '"clientContact"', 'deadline', 'status', 'priority', '"aiScore"', '"aiReason"',
    '"createdAt"', '"updatedAt"',
  ]
  console.log(`-- Активные заказы для помощника сборки (демо). Идемпотентно: DO UPDATE.
-- Применить: Supabase → SQL Editor → Run.
-- Удалить: DELETE FROM "Order" WHERE id LIKE 'demo-active-%';
DO $$
DECLARE org_id TEXT;
BEGIN
  SELECT ${orgExpr} INTO org_id;
  IF org_id IS NULL THEN
    RAISE EXCEPTION 'Не найдена организация пользователя';
  END IF;`)
  for (const o of ORDERS) {
    const values = [
      `'${PREFIX}${o.n}'`,
      'org_id',
      lit('demo'),
      lit(o.routeFrom),
      lit(o.routeTo),
      String(o.distance),
      String(o.weight),
      o.volume != null ? String(o.volume) : 'NULL',
      lit(o.cargoType),
      lit(o.loadingType),
      lit(o.requirements ?? null),
      String(o.price),
      o.priceNegotiable ? 'true' : 'false',
      lit(o.paymentType),
      lit(o.vatType),
      lit(o.clientName),
      lit(o.clientContact),
      lit(daysFromNow(o.deadlineInDays).toISOString()),
      lit(o.status),
      lit(o.status === "negotiation" ? "negotiating" : "needs_clarification"),
      String(o.aiScore),
      lit(o.aiReason),
      'now()',
      'now()',
    ]
    const updates = [
      '"status" = EXCLUDED."status"',
      'price = EXCLUDED.price',
      'deadline = EXCLUDED.deadline',
      '"routeId" = NULL',
      '"aiScore" = EXCLUDED."aiScore"',
      '"updatedAt" = now()',
    ].join(", ")
    console.log(
      `  INSERT INTO "Order" (${columns.join(", ")})\n  VALUES (${values.join(", ")})\n  ON CONFLICT (id) DO UPDATE SET ${updates};`
    )
  }
  console.log("END $$;")
}

async function main(): Promise<void> {
  const { email, org, clean, sql } = args()

  if (sql) {
    printSql(email)
    return
  }

  const organizationId = await resolveOrganizationId(email, org)
  const org_ = await prisma.organization.findUnique({ where: { id: organizationId } })
  console.log(
    `[seed:active-orders] Организация: ${org_?.name ?? organizationId}`
  )

  if (clean) {
    const { count } = await prisma.order.deleteMany({
      where: { organizationId, id: { startsWith: PREFIX } },
    })
    console.log(`[seed:active-orders] Удалено демо-заказов: ${count}`)
    return
  }

  await prisma.order.deleteMany({
    where: { organizationId, id: { startsWith: PREFIX } },
  })

  await prisma.order.createMany({
    data: ORDERS.map((o) => ({
      id: `${PREFIX}${o.n}`,
      organizationId,
      source: "demo",
      routeFrom: o.routeFrom,
      routeTo: o.routeTo,
      distance: o.distance,
      weight: o.weight,
      volume: o.volume ?? null,
      cargoType: o.cargoType,
      loadingType: o.loadingType,
      requirements: o.requirements ?? null,
      price: o.price,
      priceNegotiable: o.priceNegotiable ?? false,
      paymentType: o.paymentType,
      vatType: o.vatType,
      clientName: o.clientName,
      clientContact: o.clientContact,
      deadline: daysFromNow(o.deadlineInDays),
      status: o.status,
      priority:
        o.status === "negotiation" ? "negotiating" : "needs_clarification",
      aiScore: o.aiScore,
      aiReason: o.aiReason,
    })),
  })

  const total = await prisma.order.count({
    where: { organizationId, status: { in: ["search", "negotiation"] }, routeId: null },
  })
  console.log(
    `[seed:active-orders] Создано ${ORDERS.length} активных заказов (в сборке доступно: ${total})`
  )
}

main()
  .catch((error) => {
    console.error("[seed:active-orders] Ошибка:", error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

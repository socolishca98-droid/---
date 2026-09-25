// lib/payments/summary.ts
//
// Оплаты по заказам (задача 6).
//
// Отдельной модели «платёж» в базе нет: оплата — это состояние заказа
// (isPaid / paidAt / dueDate / deferredDays / paymentType). Здесь собрано всё,
// что из этих полей считается: сумма заказа, срок оплаты, просрочка, сводка,
// должники по клиентам и выгрузка для бухгалтерии.
//
// Модуль чистый: без Prisma и Next, поэтому проверяется тестами без базы.

export type PaymentOrderInput = {
  id: string
  clientId?: string | null
  clientName?: string | null
  clientContact?: string | null
  routeFrom?: string | null
  routeTo?: string | null
  distance?: number | null
  cargoType?: string | null
  status?: string | null
  createdAt?: Date | null
  deadline?: Date | null
  /** Фактическая доставка: от неё считаем отсрочку. */
  deliveredAt?: Date | null
  price?: number | null
  agreedPrice?: number | null
  paymentType?: string | null
  vatType?: string | null
  deferredDays?: number | null
  dueDate?: Date | null
  isPaid?: boolean | null
  paidAt?: Date | null
  client?: { id: string; name: string; inn?: string | null } | null
}

export type ReminderInfo = { lastAt: Date | null; count: number }

export type PaymentRow = {
  id: string
  clientId: string | null
  clientName: string
  clientContact: string | null
  inn: string | null
  routeFrom: string
  routeTo: string
  distance: number
  cargoType: string
  status: string | null
  createdAt: Date | null
  amount: number
  paymentType: string | null
  vatType: string | null
  deferredDays: number
  dueDate: Date | null
  /** Отсрочка есть (deferredDays > 0 или задан срок оплаты). */
  isDeferred: boolean
  isPaid: boolean
  paidAt: Date | null
  isOverdue: boolean
  /** На сколько дней срок оплаты уже прошёл (0 — не просрочен). */
  overdueDays: number
  remindedAt: Date | null
  reminderCount: number
}

export type PaymentsSummary = {
  totalPending: number
  totalDeferred: number
  totalOverdue: number
  totalPaid: number
  totalRevenue: number
  pendingCount: number
  deferredCount: number
  overdueCount: number
  paidCount: number
  totalOrders: number
  /** Среднее число дней от срока оплаты до фактической оплаты. */
  avgPaymentDays: number | null
}

export type Debtor = {
  key: string
  clientId: string | null
  clientName: string
  inn: string | null
  debt: number
  overdue: number
  ordersCount: number
  overdueCount: number
  maxOverdueDays: number
  /** Самый ранний неоплаченный срок — с него и надо начинать разговор. */
  oldestDueDate: Date | null
  lastOrderAt: Date | null
}

export const PAYMENT_TYPE_LABELS: Record<string, string> = {
  cash: "Наличные",
  bank: "Безнал",
  card: "Карта",
}

const VAT_LABELS: Record<string, string> = {
  none: "Без НДС",
  vat20: "НДС 20%",
  vat10: "НДС 10%",
  included: "НДС включён",
  with_vat: "С НДС",
  without_vat: "Без НДС",
  "0": "Без НДС",
  "10": "НДС 10%",
  "20": "НДС 20%",
}

/** Сумма заказа: согласованная цена важнее первоначальной. */
export function orderAmount(order: PaymentOrderInput): number {
  const agreed = typeof order.agreedPrice === "number" ? order.agreedPrice : null
  const price = typeof order.price === "number" ? order.price : null
  return agreed ?? price ?? 0
}

/**
 * Приводит форму оплаты к канону cash | bank | card.
 * В базе встречаются и старые значения («bank_transfer», «deferred», «нал»),
 * поэтому распознаём их, а неизвестное отдаём как null — врать не будем.
 */
export function normalizePaymentType(raw: string | null | undefined): string | null {
  if (!raw) return null
  const value = raw.trim().toLowerCase()

  if (["cash", "нал", "наличные", "наличный"].includes(value)) return "cash"
  if (["bank", "bank_transfer", "безнал", "безналичный", "счет", "счёт"].includes(value)) return "bank"
  if (["card", "карта", "картой", "эквайринг"].includes(value)) return "card"
  if (value === "deferred" || value === "отсрочка" || value === "рассрочка") return "bank"

  return null
}

export function paymentTypeLabel(raw: string | null | undefined): string {
  const canonical = normalizePaymentType(raw)
  if (canonical) return PAYMENT_TYPE_LABELS[canonical]
  return raw?.trim() ? raw.trim() : "Не указана"
}

export function vatLabel(raw: string | null | undefined): string | null {
  if (!raw) return null
  const value = raw.trim().toLowerCase()
  return VAT_LABELS[value] ?? raw.trim()
}

function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

export function daysBetween(from: Date, to: Date): number {
  const ms = startOfDay(to).getTime() - startOfDay(from).getTime()
  return Math.round(ms / 86_400_000)
}

/** Срок оплаты: явная дата важнее расчёта по отсрочке. */
export function paymentDueDate(order: PaymentOrderInput): Date | null {
  if (order.dueDate) return order.dueDate

  const deferred = typeof order.deferredDays === "number" ? order.deferredDays : 0
  if (deferred <= 0) return null

  const base = order.deliveredAt ?? order.deadline ?? order.createdAt
  if (!base) return null

  const due = new Date(base)
  due.setDate(due.getDate() + deferred)
  return due
}

/** Есть ли у заказа отсрочка: либо дни, либо заданный срок оплаты. */
export function isDeferredOrder(order: PaymentOrderInput): boolean {
  const deferred = typeof order.deferredDays === "number" ? order.deferredDays : 0
  return deferred > 0 || Boolean(order.dueDate)
}

/** Сколько дней оплата уже просрочена (0 — не просрочена или уже оплачена). */
export function overdueDaysFor(order: PaymentOrderInput, now: Date = new Date()): number {
  if (order.isPaid) return 0
  const due = paymentDueDate(order)
  if (!due) return 0
  const diff = daysBetween(due, now)
  return diff > 0 ? diff : 0
}

/** Строка списка оплат: что показываем логисту и бухгалтеру. */
export function buildPaymentRow(
  order: PaymentOrderInput,
  now: Date = new Date(),
  reminder?: ReminderInfo,
): PaymentRow {
  const dueDate = paymentDueDate(order)
  const overdueDays = overdueDaysFor(order, now)

  return {
    id: order.id,
    clientId: order.clientId ?? order.client?.id ?? null,
    clientName: order.client?.name || order.clientName || "Клиент не указан",
    clientContact: order.clientContact ?? null,
    inn: order.client?.inn ?? null,
    routeFrom: order.routeFrom ?? "",
    routeTo: order.routeTo ?? "",
    distance: order.distance ?? 0,
    cargoType: order.cargoType ?? "Груз",
    status: order.status ?? null,
    createdAt: order.createdAt ?? null,
    amount: orderAmount(order),
    paymentType: normalizePaymentType(order.paymentType),
    vatType: order.vatType ?? null,
    deferredDays: typeof order.deferredDays === "number" ? order.deferredDays : 0,
    dueDate,
    isDeferred: isDeferredOrder(order),
    isPaid: Boolean(order.isPaid),
    paidAt: order.paidAt ?? null,
    isOverdue: overdueDays > 0,
    overdueDays,
    remindedAt: reminder?.lastAt ?? null,
    reminderCount: reminder?.count ?? 0,
  }
}

/** Сводка по оплатам: суммы и количество по состояниям. */
export function buildPaymentsSummary(rows: PaymentRow[]): PaymentsSummary {
  let totalPending = 0
  let totalDeferred = 0
  let totalOverdue = 0
  let totalPaid = 0
  let totalRevenue = 0
  let pendingCount = 0
  let deferredCount = 0
  let overdueCount = 0
  let paidCount = 0

  const paymentTerms: number[] = []

  for (const row of rows) {
    totalRevenue += row.amount

    if (row.isPaid) {
      totalPaid += row.amount
      paidCount += 1

      if (row.paidAt && row.dueDate) {
        const days = daysBetween(row.dueDate, row.paidAt)
        if (Number.isFinite(days)) paymentTerms.push(days)
      }
      continue
    }

    totalPending += row.amount
    pendingCount += 1

    if (row.isDeferred) {
      totalDeferred += row.amount
      deferredCount += 1
    }

    if (row.isOverdue) {
      totalOverdue += row.amount
      overdueCount += 1
    }
  }

  return {
    totalPending,
    totalDeferred,
    totalOverdue,
    totalPaid,
    totalRevenue,
    pendingCount,
    deferredCount,
    overdueCount,
    paidCount,
    totalOrders: rows.length,
    avgPaymentDays:
      paymentTerms.length > 0
        ? Math.round(paymentTerms.reduce((sum, value) => sum + value, 0) / paymentTerms.length)
        : null,
  }
}

/**
 * Кто должен: долги, сгруппированные по клиенту.
 *
 * Группируем по clientId, а если карточки у заказа нет — по нормализованному
 * имени. Так «ООО "Ромашка"» и «Ромашка» не превращаются в двух должников.
 */
export function buildDebtors(rows: PaymentRow[]): Debtor[] {
  const groups = new Map<string, Debtor>()

  for (const row of rows) {
    if (row.isPaid || row.amount <= 0) continue

    const key = row.clientId ?? `name:${normNameKey(row.clientName)}`
    const current: Debtor =
      groups.get(key) ??
      {
        key,
        clientId: row.clientId,
        clientName: row.clientName,
        inn: row.inn,
        debt: 0,
        overdue: 0,
        ordersCount: 0,
        overdueCount: 0,
        maxOverdueDays: 0,
        oldestDueDate: null,
        lastOrderAt: null,
      }

    current.debt += row.amount
    current.ordersCount += 1

    if (row.isOverdue) {
      current.overdue += row.amount
      current.overdueCount += 1
      if (row.overdueDays > current.maxOverdueDays) current.maxOverdueDays = row.overdueDays
    }

    if (row.dueDate) {
      if (!current.oldestDueDate || row.dueDate < current.oldestDueDate) {
        current.oldestDueDate = row.dueDate
      }
    }

    if (row.createdAt && (!current.lastOrderAt || row.createdAt > current.lastOrderAt)) {
      current.lastOrderAt = row.createdAt
    }

    if (!current.inn && row.inn) current.inn = row.inn

    groups.set(key, current)
  }

  return [...groups.values()].sort((a, b) => {
    if (b.overdue !== a.overdue) return b.overdue - a.overdue
    return b.debt - a.debt
  })
}

/** Ключ сравнения названий: без правовой формы, кавычек и регистра. */
function normNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'`]/g, "")
    .replace(/(^|\s)(ооо|оао|зао|пао|ип|ao|ltd|llc|inc)(\s|$)/g, " ")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export type AccountingColumn = {
  key: string
  title: string
  width?: number
}

export const ACCOUNTING_COLUMNS: AccountingColumn[] = [
  { key: "orderId", title: "Заказ" },
  { key: "createdAt", title: "Дата заказа" },
  { key: "client", title: "Клиент" },
  { key: "inn", title: "ИНН" },
  { key: "route", title: "Маршрут" },
  { key: "amount", title: "Сумма, ₽" },
  { key: "vat", title: "НДС" },
  { key: "paymentType", title: "Форма оплаты" },
  { key: "dueDate", title: "Срок оплаты" },
  { key: "state", title: "Состояние" },
  { key: "paidAt", title: "Оплачено" },
  { key: "overdueDays", title: "Просрочка, дней" },
]

function csvDate(date: Date | null | undefined): string {
  if (!date) return ""
  const day = String(date.getDate()).padStart(2, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  return `${day}.${month}.${date.getFullYear()}`
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value)
  if (/[";\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function paymentStateLabel(row: PaymentRow): string {
  if (row.isPaid) return "Оплачен"
  if (row.isOverdue) return `Просрочен на ${row.overdueDays} дн.`
  if (row.dueDate) return "Ожидает оплаты"
  return "Срок не задан"
}

/**
 * Выгрузка для бухгалтерии: CSV с разделителем «;», десятичной точкой-не
 * нужна, суммы целыми рублями, даты в формате ДД.ММ.ГГГГ и BOM в начале —
 * чтобы Excel открыл файл в правильной кодировке без танцев.
 */
export function buildAccountingCsv(rows: PaymentRow[]): string {
  const lines: string[] = []
  lines.push(ACCOUNTING_COLUMNS.map((column) => csvCell(column.title)).join(";"))

  for (const row of rows) {
    const values: Record<string, unknown> = {
      orderId: row.id,
      createdAt: csvDate(row.createdAt),
      client: row.clientName,
      inn: row.inn ?? "",
      route: `${row.routeFrom} — ${row.routeTo}`.trim(),
      amount: row.amount,
      vat: vatLabel(row.vatType) ?? "",
      paymentType: paymentTypeLabel(row.paymentType),
      dueDate: csvDate(row.dueDate),
      state: paymentStateLabel(row),
      paidAt: csvDate(row.paidAt),
      overdueDays: row.overdueDays > 0 ? row.overdueDays : "",
    }

    lines.push(ACCOUNTING_COLUMNS.map((column) => csvCell(values[column.key])).join(";"))
  }

  return `\uFEFF${lines.join("\r\n")}\r\n`
}

/** Текст напоминания об оплате — один и тот же для уведомления и для списка. */
export function overdueReminderText(row: PaymentRow): { title: string; message: string } {
  const amount = `${row.amount.toLocaleString("ru-RU")} ₽`
  const title = "Просрочена оплата"
  const contact = row.clientContact ? ` Контакт: ${row.clientContact}.` : ""
  const due = row.dueDate
    ? ` Срок был ${String(row.dueDate.getDate()).padStart(2, "0")}.${String(
        row.dueDate.getMonth() + 1,
      ).padStart(2, "0")}.${row.dueDate.getFullYear()}, просрочка ${row.overdueDays} дн.`
    : ""

  return {
    title,
    message: `${row.clientName}: ${amount} по заказу ${row.id} (${row.routeFrom} → ${row.routeTo}).${due}${contact}`,
  }
}

/** Оплата считается просроченной, только если срок прошёл и денег нет. */
export function isOverdueRow(row: PaymentRow): boolean {
  return !row.isPaid && row.isOverdue
}

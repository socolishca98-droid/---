// lib/documents/missing.ts
//
// «Чего не хватает для документов» (задача 3, пункт B2).
//
// Перед печатью документов логисту нужно понять, какие поля рейса не
// заполнены и чем это грозит: счёт без суммы недействителен, ТТН без веса
// уйдёт с прочерками. Раньше проверялись только реквизиты организации —
// теперь проверяется весь рейс: экипаж, заказы, цены, клиенты, сроки.
//
// Модуль чистый: вход — обычные объекты (не Prisma-модели), поэтому
// проверяется тестами без базы и используется и в диалоге печати, и в
// карточке рейса, и на главном экране панели.

/** Заказ в том виде, в каком он приходит в панель (MobileRouteOrder-подобный). */
export type MissingOrderLike = {
  clientName?: string | null
  /** Вес в кг. В API рейса поле называется weight, в документах weightKg —
   *  проверка понимает оба, иначе «не указан вес» врало на заполненном рейсе. */
  weightKg?: number | null
  weight?: number | null
  priceRub?: number | null
  price?: number | null
  agreedPriceRub?: number | null
  agreedPrice?: number | null
  deadline?: Date | string | null
  paymentType?: string | null
  vatType?: string | null
}

export type MissingRouteLike = {
  driverName?: string | null
  vehiclePlate?: string | null
  orders?: MissingOrderLike[]
}

export type MissingRequisitesLike = {
  legalName?: string | null
  inn?: string | null
  legalAddress?: string | null
} | null

/**
 * Насколько пункт мешает: blocker — без него документ нельзя выдать (счёт
 * без суммы), warning — документ выйдет с прочерком или без деталей.
 */
export type MissingSeverity = "blocker" | "warning"

export type MissingItem = {
  key: string
  label: string
  hint: string
  severity: MissingSeverity
  /** Каким документам рейса мешает этот пункт (виды из DOCUMENT_KINDS). */
  kinds: string[]
  /**
   * Куда идти, чтобы дозаполнить: экран и действие словами.
   * Нужно, чтобы из диалога печати и из карточки рейса можно было не искать
   * настройки по меню, а нажать и попасть на нужное поле.
   */
  fix?: { href: string; label: string }
}

const PER_ORDER_KINDS = ["ttn", "contract", "invoice", "act"]

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === "string") return value.trim().length > 0
  // Ноль — это не заполненное значение: пустой вес и нулевая цена в бланке
  // печатаются прочерком, как и отсутствие поля.
  if (typeof value === "number") return value > 0
  return true
}

/** Первое непустое значение из нескольких вариантов имени поля. */
function pick<T>(...values: Array<T | null | undefined>): T | null {
  for (const value of values) {
    if (hasValue(value)) return value as T
  }
  return null
}

/**
 * Список «чего не хватает» по данным рейса и реквизитам организации.
 *
 * Если реквизиты не переданы (null) — пункт про реквизиты не выдаётся:
 * карточка рейса не грузит настройки, а печать из карточки проверяет их
 * сама в диалоге.
 */
export function missingForDocuments(input: {
  route: MissingRouteLike
  requisites?: MissingRequisitesLike
}): MissingItem[] {
  const { route, requisites } = input
  const orders = route.orders ?? []
  const items: MissingItem[] = []

  // Реквизиты организации — без них любой бланк уйдёт с пустыми полями
  if (
    requisites !== undefined &&
    (!requisites ||
      !hasValue(requisites.legalName) ||
      !hasValue(requisites.inn) ||
      !hasValue(requisites.legalAddress))
  ) {
    items.push({
      key: "requisites",
      label: "Не заполнены реквизиты организации",
      // Раньше здесь стояло «Автопарк → Настройки», а реквизиты живут на
      // отдельном экране «Настройки» → «Реквизиты перевозчика». Логист искал
      // их в автопарке и не находил.
      hint: "ИНН, КПП, ОГРН и банк печатаются в бланках. Заполняются в «Настройки» → «Реквизиты для документов» — там же телефон, e-mail и подписант.",
      severity: "blocker",
      kinds: ["ttn", "waybill", "contract", "invoice", "act"],
      fix: { href: "/settings#requisites", label: "Заполнить реквизиты" },
    })
  }

  if (orders.length === 0) {
    items.push({
      key: "no-orders",
      label: "В рейсе нет заказов",
      hint: "Накладные, счета и акты печатаются по заказам: напечатается только путевой лист.",
      severity: "warning",
      kinds: PER_ORDER_KINDS,
    })
    return items
  }

  const withoutPrice = orders.filter(
    (order) =>
      !hasValue(pick(order.agreedPriceRub, order.agreedPrice)) &&
      !hasValue(pick(order.priceRub, order.price)),
  )
  if (withoutPrice.length > 0) {
    items.push({
      key: "price",
      label: `Не задана цена перевозки (${withoutPrice.length} из ${orders.length})`,
      hint: "Счёт и акт без суммы недействительны — укажите цену в заказе до печати.",
      severity: "blocker",
      kinds: ["invoice", "act", "ttn"],
      fix: { href: "/orders", label: "Открыть заказы" },
    })
  }

  const withoutClient = orders.filter((order) => !hasValue(order.clientName))
  if (withoutClient.length > 0) {
    items.push({
      key: "client",
      label: `Не указан клиент (${withoutClient.length} из ${orders.length})`,
      hint: "В счёте и акте плательщик останется прочерком — заполнить можно в заказе.",
      severity: "warning",
      kinds: ["invoice", "act", "contract"],
      fix: { href: "/orders", label: "Открыть заказы" },
    })
  }

  const withoutWeight = orders.filter(
    (order) => !hasValue(pick(order.weightKg, order.weight)),
  )
  if (withoutWeight.length > 0) {
    items.push({
      key: "weight",
      label: `Не указан вес груза (${withoutWeight.length} из ${orders.length})`,
      hint: "В накладной вес останется прочерком — водитель заполнит от руки при погрузке.",
      severity: "warning",
      kinds: ["ttn", "waybill"],
    })
  }

  const withoutDeadline = orders.filter((order) => !hasValue(order.deadline))
  if (withoutDeadline.length > 0) {
    items.push({
      key: "deadline",
      label: `Не указан срок доставки (${withoutDeadline.length} из ${orders.length})`,
      hint: "Дата погрузки в накладной останется пустой — уточните срок в заказе.",
      severity: "warning",
      kinds: ["ttn", "waybill"],
    })
  }

  const withoutPayment = orders.filter(
    (order) => !hasValue(order.paymentType) || !hasValue(order.vatType),
  )
  if (withoutPayment.length > 0) {
    items.push({
      key: "payment-terms",
      label: `Не согласованы оплата и НДС (${withoutPayment.length} из ${orders.length})`,
      hint: "Договор-заявка и счёт останутся без порядка оплаты — форма оплаты и НДС задаются в заказе.",
      fix: { href: "/orders", label: "Открыть заказы" },
      severity: "warning",
      kinds: ["contract", "invoice", "act"],
    })
  }

  if (!hasValue(route.driverName)) {
    items.push({
      key: "driver",
      label: "Не назначен водитель",
      hint: "В путевом листе и накладной ФИО водителя останется пустым.",
      severity: "warning",
      kinds: ["ttn", "waybill"],
      fix: { href: "/routes", label: "Открыть рейсы" },
    })
  }

  if (!hasValue(route.vehiclePlate)) {
    items.push({
      key: "vehicle",
      label: "Не назначена машина",
      hint: "Госномер и марка в путевом листе останутся пустыми.",
      severity: "warning",
      kinds: ["ttn", "waybill"],
      fix: { href: "/routes", label: "Открыть рейсы" },
    })
  }

  // Сначала то, что мешает выдать документ, потом мелочи
  const severityRank = (item: MissingItem) => (item.severity === "blocker" ? 0 : 1)
  return items.sort((a, b) => severityRank(a) - severityRank(b))
}

/** Сколько пунктов мешают: для индикатора в карточке рейса. */
export function missingCount(items: MissingItem[]): number {
  return items.length
}

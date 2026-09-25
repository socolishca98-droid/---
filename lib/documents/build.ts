// lib/documents/build.ts
//
// Тексты печатных документов по рейсу (задача 3, пункт 3).
//
// Здесь нет ни базы, ни браузера: функция получает уже загруженные данные рейса
// и реквизиты организации и возвращает документы как данные (PrintDocument).
// Что не заполнено — остаётся пустым полем: документ печатает строку для
// заполнения от руки, а не подставляет чужие или выдуманные значения.

import {
  DOCUMENT_TITLES,
  type CarrierRequisites,
  type DocumentBlock,
  type DocumentKind,
  type DocumentOrder,
  type DocumentRoute,
  type DocumentTable,
  type PrintDocument,
} from "./types"

const MONTHS_RU = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
]

/** Пустое значение печатается прочерком-местом для заполнения. */
export function orBlank(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text.length > 0 ? text : null
}

/** 24.09.2026 */
export function formatDate(value: Date | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const day = String(date.getDate()).padStart(2, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  return `${day}.${month}.${date.getFullYear()}`
}

/** «24 сентября 2026 г.» — для текста договора. */
export function formatDateLong(value: Date | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getDate()} ${MONTHS_RU[date.getMonth()]} ${date.getFullYear()} г.`
}

/** 24.09.2026 08:30 */
export function formatDateTime(value: Date | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
  return `${formatDate(date)} ${time}`
}

/** 45 000 ₽ (пробел как разделитель разрядов — как принято в документах). */
export function formatMoney(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const rounded = Math.round(value)
  return `${rounded.toLocaleString("ru-RU").replace(/\u00a0/g, " ")} ₽`
}

/** 10 000 кг (10,0 т) */
export function formatWeight(kg: number | null | undefined): string | null {
  if (kg === null || kg === undefined || !Number.isFinite(kg) || kg <= 0) return null
  const tons = (kg / 1000).toLocaleString("ru-RU", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  return `${kg.toLocaleString("ru-RU").replace(/\u00a0/g, " ")} кг (${tons.replace(/\u00a0/g, " ")} т)`
}

/** Стоимость перевозки: согласованная цена важнее прайса из заказа. */
export function orderPrice(order: DocumentOrder): number | null {
  if (typeof order.agreedPriceRub === "number" && order.agreedPriceRub > 0) {
    return order.agreedPriceRub
  }
  if (typeof order.priceRub === "number" && order.priceRub > 0) return order.priceRub
  return null
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: "наличными",
  card: "картой",
  bank: "безналичный расчёт",
  transfer: "переводом",
  noncash: "безналичный расчёт",
}

const VAT_LABELS: Record<string, string> = {
  none: "без НДС",
  included: "НДС включён в стоимость",
  vat20: "НДС 20%",
  vat10: "НДС 10%",
}

export function paymentTerms(order: DocumentOrder): string | null {
  const parts: string[] = []

  const payment = order.paymentType ? PAYMENT_LABELS[order.paymentType] ?? order.paymentType : null
  if (payment) parts.push(payment)

  const vat = order.vatType ? VAT_LABELS[order.vatType] ?? order.vatType : null
  if (vat) parts.push(vat)

  if (typeof order.deferredDays === "number" && order.deferredDays > 0) {
    parts.push(`отсрочка ${order.deferredDays} дн.`)
  }

  return parts.length > 0 ? parts.join(", ") : null
}

/**
 * Номер документа. Рейс нумеруется по дате создания (Р-2026-09-24-3), заказ
 * внутри рейса — порядковым номером точки (Р-2026-09-24-3/2). Номер не
 * претендует на бухгалтерскую нумерацию: он нужен, чтобы документы рейса
 * отличались друг от друга и находились по названию.
 */
export function routeDocumentNumber(route: DocumentRoute, index: number, orderIndex?: number): string {
  const date = formatDate(route.createdAt) ?? ""
  const [day, month, year] = date.split(".")
  const stamp = year && month && day ? `${year}-${month}-${day}` : "без-даты"
  const base = `Р-${stamp}-${index + 1}`
  return orderIndex === undefined ? base : `${base}/${orderIndex + 1}`
}

function carrierBlock(carrier: CarrierRequisites): DocumentBlock {
  return {
    title: "Перевозчик",
    fields: [
      { label: "Наименование", value: orBlank(carrier.legalName) ?? orBlank(carrier.name) },
      { label: "ИНН", value: orBlank(carrier.inn) },
      { label: "КПП", value: orBlank(carrier.kpp) },
      { label: "ОГРН / ОГРНИП", value: orBlank(carrier.ogrn) },
      { label: "Адрес", value: orBlank(carrier.legalAddress) },
      { label: "Телефон", value: orBlank(carrier.phone) },
      { label: "E-mail", value: orBlank(carrier.email) },
    ],
  }
}

function bankBlock(carrier: CarrierRequisites): DocumentBlock {
  return {
    title: "Банковские реквизиты",
    fields: [
      { label: "Банк", value: orBlank(carrier.bankName) },
      { label: "БИК", value: orBlank(carrier.bankBic) },
      { label: "Расчётный счёт", value: orBlank(carrier.bankAccount) },
    ],
  }
}

function signatureLine(carrier: CarrierRequisites): string {
  const position = orBlank(carrier.signerPosition) ?? "Перевозчик"
  const name = orBlank(carrier.signerName)
  return name ? `${position} ______________ / ${name} /` : `${position} ______________ / ______________ /`
}

function crewFields(route: DocumentRoute): DocumentBlock {
  const { crew } = route
  const vehicleName = [crew.vehicleBrand, crew.vehicleModel].filter(Boolean).join(" ")

  return {
    title: "Транспорт и водитель",
    fields: [
      { label: "Госномер", value: orBlank(crew.vehiclePlate) },
      { label: "Тип ТС", value: orBlank(crew.vehicleType) },
      { label: "Марка, модель", value: orBlank(vehicleName) },
      { label: "Грузоподъёмность", value: formatWeight(crew.vehicleCapacityKg) },
      { label: "Водитель", value: orBlank(crew.driverName) },
      { label: "Телефон водителя", value: orBlank(crew.driverPhone) },
    ],
  }
}

function cargoTable(orders: DocumentOrder[]): DocumentTable {
  return {
    title: "Груз",
    columns: ["№", "Маршрут", "Наименование груза", "Вес", "Объём, м³", "Стоимость перевозки"],
    rows: orders.map((order, index) => [
      String(index + 1),
      `${order.routeFrom} — ${order.routeTo}`,
      order.cargoType,
      formatWeight(order.weightKg) ?? "—",
      order.volumeM3 ? String(order.volumeM3) : "—",
      formatMoney(orderPrice(order)) ?? "—",
    ]),
  }
}

function routeTitle(route: DocumentRoute): string {
  const points = route.orders.map((order) => order.routeFrom)
  const last = route.orders.length > 0 ? route.orders[route.orders.length - 1].routeTo : null
  const cities = [...points, ...(last ? [last] : [])]
  if (cities.length === 0) return orBlank(route.name) ?? "маршрут не задан"
  return cities.join(" — ")
}

// ---------------------------------------------------------------------------
// Транспортная накладная — по каждому заказу рейса
// ---------------------------------------------------------------------------

export function buildTtn(
  route: DocumentRoute,
  order: DocumentOrder,
  carrier: CarrierRequisites,
  orderIndex: number,
): PrintDocument {
  const price = orderPrice(order)
  const total = route.orders.reduce((sum, item) => sum + (orderPrice(item) ?? 0), 0)

  return {
    kind: "ttn",
    number: routeDocumentNumber(route, 0, orderIndex),
    title: DOCUMENT_TITLES.ttn,
    subtitle: `${order.routeFrom} — ${order.routeTo}`,
    blocks: [
      carrierBlock(carrier),
      {
        title: "Грузоотправитель",
        fields: [
          { label: "Наименование", value: orBlank(order.clientName) },
          { label: "Контактное лицо", value: orBlank(order.clientContact) },
          { label: "Адрес погрузки", value: orBlank(order.routeFrom) },
          { label: "ИНН / адрес", value: null },
        ],
      },
      {
        title: "Грузополучатель",
        fields: [
          { label: "Наименование", value: null },
          { label: "Адрес выгрузки", value: orBlank(order.routeTo) },
          { label: "ИНН / адрес", value: null },
        ],
      },
      crewFields(route),
      {
        title: "Перевозка",
        fields: [
          { label: "Дата погрузки", value: formatDate(order.deadline) },
          { label: "Срок доставки", value: formatDate(order.deadline) },
          { label: "Порядковый номер в рейсе", value: String(orderIndex + 1) },
          { label: "Рейс", value: orBlank(route.name) ?? routeDocumentNumber(route, 0) },
          { label: "Стоимость перевозки", value: formatMoney(price) },
          { label: "Стоимость по рейсу целиком", value: total > 0 ? formatMoney(total) : null },
        ],
      },
    ],
    tables: [cargoTable([order])],
    notes: [
      "Товарно-транспортная накладная заполняется в двух экземплярах: один остаётся у грузоотправителя, второй передаётся грузополучателю.",
      "Строки, оставленные пустыми, заполняются от руки при погрузке — данные грузополучателя в заказе не хранятся.",
    ],
    signatures: [
      "Груз сдал (грузоотправитель) ______________ / ______________ /",
      "Груз принял (грузополучатель) ______________ / ______________ /",
      "Груз к перевозке принял (водитель) ______________ / ______________ /",
      signatureLine(carrier),
    ],
  }
}

// ---------------------------------------------------------------------------
// Путевой лист — один на рейс
// ---------------------------------------------------------------------------

export function buildWaybill(route: DocumentRoute, carrier: CarrierRequisites): PrintDocument {
  const totalWeight = route.orders.reduce((sum, order) => sum + order.weightKg, 0)
  const totalPrice = route.orders.reduce((sum, order) => sum + (orderPrice(order) ?? 0), 0)

  const taskTable: DocumentTable = {
    title: "Задание на рейс",
    columns: ["№", "Пункт отправления", "Пункт назначения", "Груз", "Вес", "Срок доставки"],
    rows: route.orders.map((order, index) => [
      String(index + 1),
      order.routeFrom,
      order.routeTo,
      order.cargoType,
      formatWeight(order.weightKg) ?? "—",
      formatDate(order.deadline) ?? "—",
    ]),
  }

  return {
    kind: "waybill",
    number: routeDocumentNumber(route, 1),
    title: DOCUMENT_TITLES.waybill,
    subtitle: routeTitle(route),
    blocks: [
      carrierBlock(carrier),
      {
        title: "Адрес базы (место стоянки)",
        fields: [
          { label: "Адрес", value: orBlank(route.baseAddress) },
          { label: "Выдача задания", value: formatDate(route.createdAt) },
        ],
      },
      crewFields(route),
      {
        title: "Время работы",
        fields: [
          { label: "Выезд", value: formatDateTime(route.startedAt) },
          { label: "Возвращение", value: formatDateTime(route.completedAt) },
        ],
      },
      {
        title: "Итоги рейса (заполняется по возвращении)",
        fields: [
          { label: "Пробег, км", value: String(route.tripDistanceKm ?? route.totalDistanceKm ?? "") || null },
          { label: "Груз, всего", value: formatWeight(totalWeight) },
          { label: "Стоимость перевозок", value: totalPrice > 0 ? formatMoney(totalPrice) : null },
          { label: "Расход топлива", value: formatMoney(route.fuelExpenseRub) },
          { label: "Расходы по рейсу", value: formatMoney(route.totalCostRub) },
        ],
      },
    ],
    tables: [taskTable],
    notes: [
      "Путевой лист печатается один на рейс, независимо от числа заказов в нём.",
      route.notes ? `Примечание к рейсу: ${route.notes}` : "",
    ].filter(Boolean),
    signatures: [
      "Задание выдал ______________ / ______________ /",
      "Водитель ______________ / ______________ /",
      signatureLine(carrier),
    ],
  }
}

// ---------------------------------------------------------------------------
// Договор-заявка — по каждому заказу рейса
// ---------------------------------------------------------------------------

export function buildContract(
  route: DocumentRoute,
  order: DocumentOrder,
  carrier: CarrierRequisites,
  orderIndex: number,
): PrintDocument {
  const price = orderPrice(order)

  return {
    kind: "contract",
    number: routeDocumentNumber(route, 2, orderIndex),
    title: DOCUMENT_TITLES.contract,
    subtitle: `${order.routeFrom} — ${order.routeTo}`,
    blocks: [
      carrierBlock(carrier),
      {
        title: "Заказчик (клиент)",
        fields: [
          { label: "Наименование", value: orBlank(order.clientName) },
          { label: "Контактное лицо", value: orBlank(order.clientContact) },
          { label: "ИНН / КПП", value: null },
          { label: "Адрес", value: null },
        ],
      },
      {
        title: "Предмет заявки",
        fields: [
          { label: "Маршрут", value: `${order.routeFrom} — ${order.routeTo}` },
          { label: "Дата погрузки", value: formatDateLong(order.deadline) },
          {
            label: "Стоимость перевозки",
            value: formatMoney(price) ?? "по договорённости",
          },
          { label: "Порядок оплаты", value: paymentTerms(order) },
          { label: "Порядковый номер в рейсе", value: String(orderIndex + 1) },
        ],
      },
      crewFields(route),
    ],
    tables: [cargoTable([order])],
    notes: [
      `Перевозчик обязуется доставить груз по маршруту ${order.routeFrom} — ${order.routeTo}, Заказчик — обеспечить погрузку/выгрузку и оплатить перевозку.`,
      order.notes ? `Условия заказа: ${order.notes}` : "",
    ].filter(Boolean),
    signatures: ["Заказчик ______________ / ______________ /", signatureLine(carrier)],
  }
}

// ---------------------------------------------------------------------------
// Сборка комплекта
// ---------------------------------------------------------------------------

/**
 * Документы по рейсу выбранных видов.
 *
 * ТТН и договор-заявка печатаются на каждый заказ рейса (по одному бланку),
 * путевой лист — один на рейс. Если в рейсе ещё нет ни одного заказа, путевой
 * лист всё равно печатается (машина и водитель могут быть назначены раньше
 * точек), а ТТН и заявки — нет: печатать пустой бланк без груза бессмысленно.
 */
export function buildRouteDocuments(input: {
  route: DocumentRoute
  carrier: CarrierRequisites
  kinds: DocumentKind[]
}): PrintDocument[] {
  const { route, carrier, kinds } = input
  const documents: PrintDocument[] = []

  for (const kind of kinds) {
    if (kind === "waybill") {
      documents.push(buildWaybill(route, carrier))
      continue
    }

    route.orders.forEach((order, index) => {
      documents.push(
        kind === "ttn"
          ? buildTtn(route, order, carrier, index)
          : buildContract(route, order, carrier, index),
      )
    })
  }

  return documents
}

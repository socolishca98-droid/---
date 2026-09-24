// lib/documents/types.ts
//
// Формирование документов по маршруту (задача 3, пункт 3).
//
// Документы описаны как ДАННЫЕ, а не как разметка: набор блоков, таблиц и
// строк. Так один и тот же набор можно показать на печатной странице,
// выгрузить в файл или отправить в другое место, а сами тексты документов
// проверяются тестами без браузера.
//
// Модуль чистый: без Prisma и без Next.js — его можно тестировать в Node
// (tests/documents.test.mjs) и импортировать где угодно.

/** Виды документов. Ровно то, что печатает логист по рейсу. */
export const DOCUMENT_KINDS = ["ttn", "waybill", "contract"] as const

export type DocumentKind = (typeof DOCUMENT_KINDS)[number]

export const DOCUMENT_TITLES: Record<DocumentKind, string> = {
  ttn: "Транспортная накладная",
  waybill: "Путевой лист",
  contract: "Договор-заявка на перевозку груза",
}

/** Короткое описание — для галочек в интерфейсе. */
export const DOCUMENT_HINTS: Record<DocumentKind, string> = {
  ttn: "по каждому заказу: груз, вес, стоимость, подписи сдал/принял",
  waybill: "один на рейс: машина, водитель, задание, время выезда и возврата",
  contract: "по каждому заказу: стороны, маршрут, стоимость и порядок оплаты",
}

export function isDocumentKind(value: unknown): value is DocumentKind {
  return typeof value === "string" && (DOCUMENT_KINDS as readonly string[]).includes(value)
}

/**
 * Разбор параметра `types=ttn,waybill` в набор видов.
 * Возвращает только известные виды, порядок — как в DOCUMENT_KINDS.
 * Если не выбрано ничего — отдаём полный комплект: молча пустая печать хуже
 * лишней страницы, а набор видов всё равно виден в интерфейсе галочками.
 */
export function parseDocumentKinds(value: unknown): DocumentKind[] {
  const raw = Array.isArray(value)
    ? value.flatMap((item) => String(item).split(","))
    : typeof value === "string"
      ? value.split(",")
      : []

  const picked = new Set(raw.map((item) => item.trim().toLowerCase()).filter(Boolean))
  const known = DOCUMENT_KINDS.filter((kind) => picked.has(kind))

  return known.length > 0 ? known : [...DOCUMENT_KINDS]
}

/** Строка блока «реквизиты»: подпись и значение (пустое — печатается как прочерк). */
export type DocumentField = {
  label: string
  value: string | null
}

/** Таблица документа: шапка и строки. */
export type DocumentTable = {
  title: string
  columns: string[]
  rows: string[][]
}

/** Блок документа: заголовок раздела и строки реквизитов. */
export type DocumentBlock = {
  title: string
  fields: DocumentField[]
}

/** Готовый к печати документ. */
export type PrintDocument = {
  kind: DocumentKind
  /** Человекочитаемый номер документа (например, «Р-2026-09-24-1/1»). */
  number: string
  title: string
  subtitle: string | null
  blocks: DocumentBlock[]
  tables: DocumentTable[]
  /** Пояснения под таблицами: например, что стоимость — без НДС, если так задано. */
  notes: string[]
  /** Кто подписывает: печатается внизу. */
  signatures: string[]
}

/** Данные перевозчика — реквизиты организации из настроек. */
export type CarrierRequisites = {
  /** Название, если реквизиты ещё не заполнены: «ИП Фролов Иван Александрович». */
  name: string
  legalName: string | null
  inn: string | null
  kpp: string | null
  ogrn: string | null
  legalAddress: string | null
  phone: string | null
  email: string | null
  bankName: string | null
  bankBic: string | null
  bankAccount: string | null
  signerName: string | null
  signerPosition: string | null
}

/** Заказ в том виде, в каком он нужен документам. */
export type DocumentOrder = {
  id: string
  routeFrom: string
  routeTo: string
  cargoType: string
  weightKg: number
  volumeM3: number | null
  priceRub: number | null
  /** Цена, о которой договорились в переговорах (приоритетнее прайса). */
  agreedPriceRub: number | null
  clientName: string | null
  clientContact: string | null
  paymentType: string | null
  vatType: string | null
  deferredDays: number | null
  /** Дата погрузки/доставки: срок из заказа. */
  deadline: Date | null
  notes: string | null
}

/** Машина и водитель — то, что печатается в путевом листе и ТТН. */
export type DocumentCrew = {
  vehiclePlate: string | null
  vehicleType: string | null
  vehicleBrand: string | null
  vehicleModel: string | null
  vehicleCapacityKg: number | null
  driverName: string | null
  driverPhone: string | null
}

/** Рейс: номер, даты, маршрут и состав. */
export type DocumentRoute = {
  id: string
  name: string | null
  status: string
  startedAt: Date | null
  completedAt: Date | null
  createdAt: Date
  totalDistanceKm: number | null
  totalCostRub: number | null
  fuelExpenseRub: number | null
  cargoWeightKg: number | null
  notes: string | null
  baseAddress: string | null
  orders: DocumentOrder[]
  crew: DocumentCrew
}

// lib/clients/import.ts
//
// Импорт клиентской базы (задача 5).
//
// Сложность в том, что базу ведут по-разному: у кого-то файл с точкой с запятой
// из Excel, у кого-то выгрузка из 1С с табуляцией, колонки идут в разном
// порядке, называются по-разному («Наименование», «Контрагент», «Клиент»,
// «Фирма»), над таблицей бывает строка-заголовок файла, а в одной колонке
// лежат и ИНН, и КПП. Поэтому импорт не требует точного формата, а:
//   1. сам определяет разделитель;
//   2. находит строку заголовков;
//   3. сопоставляет колонки с полями клиента (и показывает, что не распознал);
//   4. раскладывает значения по полям, приводя телефон, ИНН, отсрочку;
//   5. показывает предпросмотр с пометками: что создастся, что обновится,
//      что пропустят (дубли, пустые названия).
//
// Модуль чистый: без Prisma и Next.js — проверяется тестами (tests/client-import.test.mjs).

import {
  cleanClientName,
  clientNameKey,
  normalizeDeferredDays,
  normalizeInn,
  normalizeKpp,
  normalizePaymentType,
  normalizePhone,
  normalizeVatType,
} from "./normalize"

/** Поля, которые импорт умеет разложить. */
export const IMPORT_FIELDS = [
  "name",
  "inn",
  "kpp",
  "address",
  "contactName",
  "phone",
  "email",
  "paymentType",
  "vatType",
  "deferredDays",
  "notes",
] as const

export type ImportField = (typeof IMPORT_FIELDS)[number]

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  name: "Название клиента",
  inn: "ИНН",
  kpp: "КПП",
  address: "Адрес",
  contactName: "Контактное лицо",
  phone: "Телефон",
  email: "E-mail",
  paymentType: "Форма оплаты",
  vatType: "НДС",
  deferredDays: "Отсрочка, дней",
  notes: "Примечание",
}

/**
 * Синонимы заголовков. Русский и английский, разные привычки письма.
 * Порядок внутри списка не важен — важно лишь совпадение по вхождению.
 */
const HEADER_SYNONYMS: Record<ImportField, string[]> = {
  name: [
    "наименование",
    "название",
    "клиент",
    "контрагент",
    "компания",
    "фирма",
    "организация",
    "заказчик",
    "грузовладелец",
    "name",
    "client",
    "customer",
    "company",
  ],
  inn: ["инн", "инн/кпп", "инн кпп", "инн/ кпп", "inn", "tax"],
  kpp: ["кпп", "kpp"],
  address: ["адрес", "юр адрес", "юридический адрес", "address", "город"],
  contactName: [
    "контактное лицо",
    "контакт",
    "фио",
    "менеджер",
    "представитель",
    "лицо",
    "contact",
    "manager",
  ],
  phone: ["телефон", "тел", "моб", "phone", "mobile", "тлф"],
  email: ["email", "e-mail", "почта", "мейл", "mail"],
  paymentType: ["форма оплаты", "оплата", "вид оплаты", "payment"],
  vatType: ["ндс", "vat"],
  deferredDays: ["отсрочка", "отсрочка дней", "дни", "срок оплаты", "deferral"],
  notes: ["примечание", "комментарий", "заметка", "notes", "comment"],
}

export type ColumnMapping = Partial<Record<ImportField, number>>

export type ImportIssue =
  | "no_name"
  | "duplicate_existing"
  | "duplicate_in_file"
  | "invalid_inn"

export type ImportRow = {
  /** Номер строки в исходном тексте (с 1) — чтобы человек нашёл её в файле. */
  line: number
  values: string[]
  fields: Partial<Record<ImportField, string | number | null>>
  /** id клиента, которого строка касается (по совпадению ключа названия). */
  existingClientId: string | null
  issues: ImportIssue[]
}

export type ImportColumn = {
  index: number
  header: string
  /** Распознанное поле или null, если колонку не поняли. */
  field: ImportField | null
  /** Первое непустое значение колонки — человек видит, что в ней лежит. */
  sample: string | null
  /** Колонка содержит и ИНН, и КПП (заголовок вида «ИНН/КПП»). */
  combinedInnKpp: boolean
}

export type ImportPreview = {
  delimiter: string
  delimiterLabel: string
  headerRow: number
  columns: ImportColumn[]
  rows: ImportRow[]
  summary: {
    /** Данных строк (без заголовка и пустых). */
    total: number
    /** Будут созданы новые карточки. */
    create: number
    /** Совпали с существующими клиентами. */
    update: number
    /** Пропускаются: нет названия или дубль (в режиме «только новые»). */
    skip: number
    noName: number
    duplicateExisting: number
    duplicateInFile: number
    invalidInn: number
    /** Заголовки, которые не удалось сопоставить. */
    unmappedHeaders: string[]
    /** Поля, которых в файле нет вовсе. */
    missingFields: ImportField[]
  }
}

// ---------------------------------------------------------------------------
// Разбор текста
// ---------------------------------------------------------------------------

const DELIMITERS: { value: string; label: string }[] = [
  { value: ";", label: "точка с запятой" },
  { value: "\t", label: "табуляция" },
  { value: ",", label: "запятая" },
  { value: "|", label: "вертикальная черта" },
]

export function delimiterLabel(delimiter: string): string {
  return DELIMITERS.find((item) => item.value === delimiter)?.label ?? "неизвестный"
}

/**
 * Разбор строки с разделителями (правила CSV: кавычки, удвоенные кавычки,
 * перевод строки внутри кавычек).
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let inQuotes = false

  const source = text.replace(/^\uFEFF/, "")

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]

    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        cell += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
      continue
    }

    if (char === delimiter) {
      row.push(cell)
      cell = ""
      continue
    }

    if (char === "\n") {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
      continue
    }

    if (char === "\r") continue

    cell += char
  }

  // последняя строка без перевода строки
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  return rows
}

/**
 * Определение разделителя: берём тот, при котором строки дают больше колонок и
 * одинаковое их число. Так файл «Москва;Ромашка» не принимается за две колонки
 * с запятой, а обычный CSV не ломается из-за запятой внутри адреса.
 */
export function detectDelimiter(text: string): string {
  const sample = text.replace(/^\uFEFF/, "").split(/\r?\n/).slice(0, 20).join("\n")

  let best = { delimiter: ";", score: -1 }

  for (const { value } of DELIMITERS) {
    const rows = parseDelimited(sample, value).filter((row) => row.some((cell) => cell.trim() !== ""))
    if (rows.length === 0) continue

    const counts = rows.map((row) => row.length)
    const max = Math.max(...counts)
    if (max < 2) continue

    const sameCount = counts.filter((count) => count === max).length
    const score = sameCount * 10 + max

    if (score > best.score) best = { delimiter: value, score }
  }

  return best.delimiter
}

// ---------------------------------------------------------------------------
// Заголовки и сопоставление колонок
// ---------------------------------------------------------------------------

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'`.,:;()\[\]{}\/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Поле, которому соответствует заголовок, или null. */
export function fieldForHeader(header: string): { field: ImportField | null; combinedInnKpp: boolean } {
  const normalized = normalizeHeader(header)
  if (!normalized) return { field: null, combinedInnKpp: false }

  // \b не работает с кириллицей: границы задаём через пробелы и края строки
  const combinedInnKpp =
    /(^|\s)инн(\s|$)/.test(normalized) &&
    /(^|\s)кпп(\s|$)/.test(normalized)

  // Длинные синонимы проверяем первыми: «контактное лицо» точнее, чем «лицо»
  const candidates: { field: ImportField; synonym: string }[] = []
  for (const field of IMPORT_FIELDS) {
    for (const synonym of HEADER_SYNONYMS[field]) {
      candidates.push({ field, synonym })
    }
  }
  candidates.sort((a, b) => b.synonym.length - a.synonym.length)

  for (const { field, synonym } of candidates) {
    const clean = normalizeHeader(synonym)
    if (clean && normalized.includes(clean)) {
      return { field, combinedInnKpp: field === "inn" && combinedInnKpp }
    }
  }

  return { field: null, combinedInnKpp: false }
}

/**
 * Строка заголовков. Заголовок файла над таблицей («Клиентская база 2026»)
 * отличается тем, что распознаётся мало колонок, поэтому ищем строку с
 * наибольшим числом распознанных заголовков среди первых 15 строк.
 */
export function detectHeaderRow(rows: string[][]): number {
  let best = { index: 0, matched: -1 }

  const limit = Math.min(rows.length, 15)
  for (let index = 0; index < limit; index += 1) {
    const row = rows[index]
    const filled = row.filter((cell) => cell.trim() !== "")
    if (filled.length < 2) continue

    const matched = row.filter((cell) => fieldForHeader(cell).field !== null).length
    if (matched > best.matched) best = { index, matched }
  }

  return best.matched > 0 ? best.index : 0
}

/**
 * Сопоставление колонок с полями. Если поле в файле одно — берём первую
 * подходящую колонку. Для «ИНН/КПП» в одной колонке ставим поле inn и флаг:
 * значение раскладывается по длине (10 цифр — ИНН, 9 — КПП).
 */
export function mapColumns(headerRow: string[], dataRows: string[][]): ImportColumn[] {
  const used = new Map<ImportField, number>()

  const columns: ImportColumn[] = headerRow.map((header, index) => {
    const { field, combinedInnKpp } = fieldForHeader(header)
    const sample =
      dataRows
        .map((row) => (row[index] ?? "").trim())
        .find((value) => value !== "") ?? null

    let assigned = field
    if (field) {
      if (combinedInnKpp) {
        used.set("inn", index)
        used.set("kpp", index)
      } else if (used.has(field)) {
        // вторую колонку с тем же смыслом («Телефон 2») не подставляем молча:
        // пусть человек решит сам в интерфейсе
        assigned = null
      } else {
        used.set(field, index)
      }
    }

    return { index, header: header.trim(), field: assigned, sample, combinedInnKpp }
  })

  return columns
}

// ---------------------------------------------------------------------------
// Разбор строк данных
// ---------------------------------------------------------------------------

/** Разложить значение колонки «ИНН/КПП» на два поля. */
function splitInnKpp(value: string): { inn: string | null; kpp: string | null } {
  const parts = value
    .split(/[\/\\;|,]/)
    .map((part) => part.trim())
    .filter(Boolean)

  let inn: string | null = null
  let kpp: string | null = null

  for (const part of parts) {
    const digits = part.replace(/[^\d]/g, "")
    if (digits.length === 9 && !kpp) {
      kpp = digits
      continue
    }
    if ((digits.length === 10 || digits.length === 12) && !inn) {
      inn = digits
      continue
    }
  }

  if (!inn && !kpp) {
    const digits = value.replace(/[^\d]/g, "")
    if (digits.length === 9) kpp = digits
    else if (digits.length === 10 || digits.length === 12) inn = digits
  }

  return { inn, kpp }
}

function cellAt(row: string[], index: number | undefined): string {
  if (index === undefined) return ""
  return (row[index] ?? "").trim()
}

export function buildImportPreview(input: {
  text: string
  /** Существующие клиенты организации: для поиска дублей. */
  existing: { id: string; name: string; nameKey?: string }[]
  /** Человек может поправить разделитель, строку заголовков и колонки вручную. */
  delimiter?: string
  headerRow?: number
  mapping?: ColumnMapping
}): ImportPreview {
  const { text, existing } = input
  const delimiter = input.delimiter || detectDelimiter(text)
  const allRows = parseDelimited(text, delimiter)

  const headerRowIndex = input.headerRow ?? detectHeaderRow(allRows)
  const rawHeader = allRows[headerRowIndex] ?? []
  const dataRows = allRows.slice(headerRowIndex + 1)

  const columns = mapColumns(rawHeader, dataRows)

  // ручные правки сопоставления имеют приоритет над автоматическими
  if (input.mapping) {
    for (const [field, index] of Object.entries(input.mapping) as [ImportField, number][]) {
      for (const column of columns) {
        if (column.field === field) column.field = null
      }
      const target = columns[index]
      if (target) target.field = field
    }
  }

  const indexOf = (field: ImportField): number | undefined =>
    columns.find((column) => column.field === field)?.index

  const innColumn = columns.find((column) => column.field === "inn")
  const existingByKey = new Map<string, { id: string; name: string }>()
  for (const client of existing) {
    const key = client.nameKey ?? clientNameKey(client.name)
    if (key && !existingByKey.has(key)) existingByKey.set(key, { id: client.id, name: client.name })
  }

  const rows: ImportRow[] = []
  const seenInFile = new Map<string, number>()
  let duplicateInFile = 0
  let noName = 0
  let duplicateExisting = 0
  let invalidInn = 0

  dataRows.forEach((values, offset) => {
    const line = headerRowIndex + 2 + offset
    if (values.every((cell) => cell.trim() === "")) return

    const rawName = cellAt(values, indexOf("name"))
    const name = cleanClientName(rawName)
    const nameKey = clientNameKey(name)

    const fields: ImportRow["fields"] = {}
    const issues: ImportIssue[] = []

    if (name) fields.name = name

    // ИНН и КПП: либо из своей колонки, либо из общей «ИНН/КПП»
    const combined = innColumn?.combinedInnKpp ? cellAt(values, innColumn.index) : ""
    if (combined) {
      const split = splitInnKpp(combined)
      if (split.inn) fields.inn = split.inn
      if (split.kpp) fields.kpp = split.kpp
    } else {
      const rawInn = cellAt(values, indexOf("inn"))
      if (rawInn) {
        const inn = normalizeInn(rawInn)
        if (inn) fields.inn = inn
        else issues.push("invalid_inn")
      }
      const rawKpp = cellAt(values, indexOf("kpp"))
      if (rawKpp) {
        const kpp = normalizeKpp(rawKpp)
        if (kpp) fields.kpp = kpp
      }
    }

    if (issues.includes("invalid_inn")) invalidInn += 1

    const address = cellAt(values, indexOf("address"))
    if (address) fields.address = address

    const contactName = cellAt(values, indexOf("contactName"))
    if (contactName) fields.contactName = contactName

    const phone = normalizePhone(cellAt(values, indexOf("phone")))
    if (phone) fields.phone = phone

    const email = cellAt(values, indexOf("email"))
    if (email) fields.email = email

    const paymentType = normalizePaymentType(cellAt(values, indexOf("paymentType")))
    if (paymentType) fields.paymentType = paymentType

    const vatType = normalizeVatType(cellAt(values, indexOf("vatType")))
    if (vatType) fields.vatType = vatType

    const deferredDays = normalizeDeferredDays(cellAt(values, indexOf("deferredDays")))
    if (deferredDays !== null) fields.deferredDays = deferredDays

    const notes = cellAt(values, indexOf("notes"))
    if (notes) fields.notes = notes

    const existingClient = nameKey ? existingByKey.get(nameKey) ?? null : null

    if (!nameKey) {
      issues.push("no_name")
      noName += 1
    } else if (seenInFile.has(nameKey)) {
      // вторая строка с тем же клиентом в одном файле: первую берём, вторую
      // показываем как дубль (у человека бывает «Ромашка» и «Ромашка Москва» —
      // решает он, а не импорт)
      issues.push("duplicate_in_file")
      duplicateInFile += 1
    } else {
      seenInFile.set(nameKey, line)
      if (existingClient) {
        issues.push("duplicate_existing")
        duplicateExisting += 1
      }
    }

    rows.push({
      line,
      values,
      fields,
      existingClientId: existingClient?.id ?? null,
      issues,
    })
  })

  // Блокирующие пометки: без названия карточку завести не из чего, повтор внутри
  // файла — почти наверняка одна и та же строка. Остальное (например, мусорный
  // ИНН) — предупреждение: карточка создаётся, а ИНН человек поправит.
  const isBlocked = (row: ImportRow) =>
    row.issues.includes("no_name") || row.issues.includes("duplicate_in_file")

  const skip = rows.filter(isBlocked).length
  const update = rows.filter((row) => !isBlocked(row) && row.issues.includes("duplicate_existing")).length
  const create = rows.filter((row) => !isBlocked(row) && !row.issues.includes("duplicate_existing")).length

  const unmappedHeaders = columns
    .filter((column) => column.field === null && column.header !== "")
    .map((column) => column.header)

  const mappedFields = new Set(columns.map((column) => column.field).filter(Boolean) as ImportField[])
  if (innColumn?.combinedInnKpp) mappedFields.add("kpp")
  const missingFields = IMPORT_FIELDS.filter((field) => !mappedFields.has(field))

  return {
    delimiter,
    delimiterLabel: delimiterLabel(delimiter),
    headerRow: headerRowIndex,
    columns,
    rows,
    summary: {
      total: rows.length,
      create,
      update,
      skip,
      noName,
      duplicateExisting,
      duplicateInFile,
      invalidInn,
      unmappedHeaders,
      missingFields,
    },
  }
}

// ---------------------------------------------------------------------------
// План импорта
// ---------------------------------------------------------------------------

export type ImportMode =
  /** Обновлять существующих клиентов (заполняем пустые поля, не стираем данные). */
  | "merge"
  /** Ничего не трогать: заводим только тех, кого ещё нет. */
  | "add"

export type ImportAction = "create" | "update" | "skip"

export type ImportPlanRow = {
  line: number
  action: ImportAction
  name: string | null
  existingClientId: string | null
  fields: ImportRow["fields"]
  issues: ImportIssue[]
  /** Какие поля у существующего клиента реально изменятся (для режима merge). */
  changedFields: ImportField[]
}

export type ImportPlan = {
  mode: ImportMode
  rows: ImportPlanRow[]
  summary: { create: number; update: number; skip: number }
}

/**
 * Что именно сделает импорт.
 *
 * В режиме «merge» строки, совпавшие с существующим клиентом, обновляют только
 * ПУСТЫЕ поля: если у клиента уже записан телефон, а в файле другой — это
 * изменение не применяется молча, строка помечается в предпросмотре.
 */
export function planImport(
  preview: ImportPreview,
  mode: ImportMode,
  existingValues: Record<string, Partial<Record<ImportField, string | number | null>>> = {},
): ImportPlan {
  const rows: ImportPlanRow[] = preview.rows.map((row) => {
    const name = (row.fields.name as string | undefined) ?? null

    if (row.issues.includes("no_name") || row.issues.includes("duplicate_in_file")) {
      return {
        line: row.line,
        action: "skip" as ImportAction,
        name,
        existingClientId: row.existingClientId,
        fields: row.fields,
        issues: row.issues,
        changedFields: [],
      }
    }

    if (row.existingClientId && row.issues.includes("duplicate_existing")) {
      if (mode === "add") {
        return {
          line: row.line,
          action: "skip" as ImportAction,
          name,
          existingClientId: row.existingClientId,
          fields: row.fields,
          issues: row.issues,
          changedFields: [],
        }
      }

      const current = existingValues[row.existingClientId] ?? {}
      // «name» не в счёт: клиент найден именно по названию, менять тут нечего
      const changedFields = IMPORT_FIELDS.filter((field) => {
        if (field === "name") return false
        const incoming = row.fields[field]
        if (incoming === null || incoming === undefined || incoming === "") return false
        const currentValue = current[field]
        return currentValue === null || currentValue === undefined || currentValue === ""
      })

      return {
        line: row.line,
        action: changedFields.length > 0 ? ("update" as ImportAction) : ("skip" as ImportAction),
        name,
        existingClientId: row.existingClientId,
        fields: row.fields,
        issues: row.issues,
        changedFields,
      }
    }

    return {
      line: row.line,
      action: "create" as ImportAction,
      name,
      existingClientId: null,
      fields: row.fields,
      issues: row.issues,
      changedFields: [],
    }
  })

  return {
    mode,
    rows,
    summary: {
      create: rows.filter((row) => row.action === "create").length,
      update: rows.filter((row) => row.action === "update").length,
      skip: rows.filter((row) => row.action === "skip").length,
    },
  }
}

/**
 * Ключ, по которому заказ привязывается к клиенту после импорта:
 * сравнение по имени заказа и названию карточки (те же правила нормализации).
 */
export function matchOrdersToClients(
  orders: { id: string; clientName: string | null }[],
  clients: { id: string; name: string }[],
): { orderId: string; clientId: string }[] {
  const byKey = new Map<string, string>()
  for (const client of clients) {
    const key = clientNameKey(client.name)
    if (key && !byKey.has(key)) byKey.set(key, client.id)
  }

  const links: { orderId: string; clientId: string }[] = []
  for (const order of orders) {
    const key = clientNameKey(order.clientName ?? "")
    if (!key) continue
    const clientId = byKey.get(key)
    if (clientId) links.push({ orderId: order.id, clientId })
  }

  return links
}

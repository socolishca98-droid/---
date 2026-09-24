// app/api/clients/import/route.ts
//
// Импорт клиентской базы (задача 5).
//
// POST /api/clients/import
//   { text, mode?, delimiter?, headerRow?, mapping?, apply? }
//
// Без `apply` — только предпросмотр: что импорт распознал, какие колонки понял,
// кого создаст, кого обновит и почему кого-то пропускает. Файл приходит текстом
// (файл читает браузер), поэтому формат не важен: разделитель, строку заголовков
// и сопоставление колонок импорт определяет сам, а человек может поправить.
//
// С `apply: true` — применяет план и дополнительно привязывает к карточкам уже
// существующие заказы по совпадению названия клиента.

import { NextRequest, NextResponse } from "next/server"

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization } from "@/lib/org"
import { IMPORT_FIELDS, type ImportField, type ImportMode } from "@/lib/clients/import"
import { importClients, previewClientImport } from "@/lib/clients/service"

export const dynamic = "force-dynamic"

/** Текст файла ограничиваем: 2 МБ — это десятки тысяч строк клиентской базы. */
const MAX_TEXT_LENGTH = 2_000_000

function parseMapping(value: unknown): Partial<Record<ImportField, number>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined

  const mapping: Partial<Record<ImportField, number>> = {}
  for (const [field, index] of Object.entries(value as Record<string, unknown>)) {
    if (!(IMPORT_FIELDS as readonly string[]).includes(field)) continue
    const column = Number(index)
    if (Number.isInteger(column) && column >= 0) mapping[field as ImportField] = column
  }

  return Object.keys(mapping).length > 0 ? mapping : undefined
}

export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error

  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) {
      return NextResponse.json({ success: false, error: "Некорректное тело запроса" }, { status: 400 })
    }

    const text = typeof body.text === "string" ? body.text : ""
    if (!text.trim()) {
      return NextResponse.json(
        { success: false, error: "Пустой файл: вставьте данные или выберите файл клиентской базы" },
        { status: 400 },
      )
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json(
        { success: false, error: "Файл слишком большой: до 2 МБ за один импорт" },
        { status: 413 },
      )
    }

    const mode: ImportMode = body.mode === "add" ? "add" : "merge"
    const delimiter = typeof body.delimiter === "string" && body.delimiter.length === 1 ? body.delimiter : undefined
    const headerRow =
      Number.isInteger(Number(body.headerRow)) && Number(body.headerRow) >= 0
        ? Number(body.headerRow)
        : undefined
    const mapping = parseMapping(body.mapping)

    const params = {
      organizationId: org.organizationId,
      text,
      mode,
      delimiter,
      headerRow,
      mapping,
    }

    if (body.apply !== true) {
      const { preview, plan } = await previewClientImport(params)
      return NextResponse.json({ success: true, applied: false, mode, preview, plan })
    }

    const { result, preview } = await importClients(params)

    return NextResponse.json({
      success: true,
      applied: true,
      mode,
      preview,
      result: {
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        linkedOrders: result.linkedOrders,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось импортировать базу"
    console.error("[Clients Import] POST error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

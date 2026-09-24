// app/api/fleet/settings/route.ts

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization, scopedWhere } from "@/lib/org"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(request: NextRequest) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  try {
    // Настройки автопарка свои у каждой организации (раньше была одна на всю базу)
    let settings = await prisma.fleetSettings.findFirst({
      where: scopedWhere(__org.organizationId),
    })

    if (!settings) {
      settings = await prisma.fleetSettings.create({
        data: {
          organizationId: __org.organizationId,
          parkName: "Наш автопарк",
          baseAddress: null,
          baseLat: null,
          baseLng: null,
        },
      })
    }

    return NextResponse.json({ success: true, settings })
  } catch (error: any) {
    console.error("[Fleet Settings] GET Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Fleet settings GET error" },
      { status: 500 },
    )
  }
}

/**
 * Поля настроек, которые можно менять через этот роут.
 * Белый список: тело запроса не уходит в базу спредом, неизвестное поле —
 * ошибка 400, а не молчаливая запись в чужое поле.
 */
const TEXT_FIELDS = [
  "parkName",
  "baseAddress",
  // Реквизиты перевозчика для печатных документов (ТТН, путевой лист, заявка)
  "legalName",
  "inn",
  "kpp",
  "ogrn",
  "legalAddress",
  "phone",
  "email",
  "bankName",
  "bankBic",
  "bankAccount",
  "signerName",
  "signerPosition",
] as const

const NUMBER_FIELDS = ["baseLat", "baseLng"] as const

/** Длинные значения не режем, но и не принимаем бесконечные. */
const MAX_TEXT_LENGTH = 500

// POST /api/fleet/settings
// body: { parkName?, baseAddress?, baseLat?, baseLng?, legalName?, inn?, … }
// Реквизиты печатаются в документах от имени ЭТОЙ организации.
export async function POST(request: NextRequest) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const allowed = new Set<string>([...TEXT_FIELDS, ...NUMBER_FIELDS])
    const unknownFields = Object.keys(body).filter((key) => !allowed.has(key))
    if (unknownFields.length > 0) {
      return NextResponse.json(
        { success: false, error: `Неизвестные поля настроек: ${unknownFields.join(", ")}` },
        { status: 400 },
      )
    }

    const data: Record<string, string | number | null> = {}

    for (const field of TEXT_FIELDS) {
      if (!(field in body)) continue
      const raw = body[field]
      if (raw === null || raw === undefined) {
        // parkName в схеме обязателен и со значением по умолчанию
        if (field === "parkName") continue
        data[field] = null
        continue
      }
      if (typeof raw !== "string") {
        return NextResponse.json(
          { success: false, error: `Поле «${field}» должно быть строкой` },
          { status: 400 },
        )
      }
      const trimmed = raw.trim()
      if (trimmed.length > MAX_TEXT_LENGTH) {
        return NextResponse.json(
          { success: false, error: `Поле «${field}» длиннее ${MAX_TEXT_LENGTH} символов` },
          { status: 400 },
        )
      }
      data[field] = trimmed
    }

    for (const field of NUMBER_FIELDS) {
      if (!(field in body)) continue
      const raw = body[field]
      if (raw === null || raw === "") {
        data[field] = null
        continue
      }
      const value = Number(raw)
      if (!Number.isFinite(value)) {
        return NextResponse.json(
          { success: false, error: `Поле «${field}» должно быть числом` },
          { status: 400 },
        )
      }
      data[field] = value
    }

    const parkName = typeof data.parkName === "string" ? data.parkName : undefined
    const baseAddress = typeof data.baseAddress === "string" ? data.baseAddress : undefined
    const baseLat = typeof data.baseLat === "number" ? data.baseLat : null
    const baseLng = typeof data.baseLng === "number" ? data.baseLng : null

    /** Реквизиты: только те поля, что пришли в запросе. */
    const requisiteFields = (): Record<string, string | null> => {
      const out: Record<string, string | null> = {}
      for (const field of TEXT_FIELDS) {
        if (field === "parkName" || field === "baseAddress") continue
        if (field in data) out[field] = data[field] as string | null
      }
      return out
    }

    const settings = await prisma.fleetSettings.upsert({
      // organizationId — уникальный ключ настроек организации (@@unique в схеме)
      where: { organizationId: __org.organizationId },
      create: {
        organizationId: __org.organizationId,
        parkName: parkName || "Наш автопарк",
        baseAddress: baseAddress || null,
        baseLat: baseLat ?? null,
        baseLng: baseLng ?? null,
        ...requisiteFields(),
      },
      update: data,
    })

    return NextResponse.json({ success: true, settings })
  } catch (error: any) {
    console.error("[Fleet Settings] POST Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Fleet settings POST error" },
      { status: 500 },
    )
  }
}
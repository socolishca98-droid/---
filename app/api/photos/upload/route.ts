// app/api/photos/upload/route.ts
//
// Настоящая загрузка фотографий (задача 7).
//
// Раньше «загрузка» была имитацией: браузер присылал blob:-ссылку на файл,
// а тип и данные «распознавания» подбирались случайным числом. Файл никуда
// не сохранялся, поэтому ни в истории рейса, ни в карточке клиента фото быть
// не могло. Теперь файл приходит на сервер, кладётся в public/uploads,
// а чек и накладная сразу распознаются локальным OCR.

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireAnySession } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { logRouteEvent } from "@/lib/routes/service"
import { ocrDataPayload, recognizeDocumentOnPhoto } from "@/lib/ocr/service"

export const dynamic = "force-dynamic"

/** Типы фото, которые понимает система (как в POST /api/photos). */
const PHOTO_TYPES = [
  "cargo_before",
  "cargo_after",
  "receipt",
  "waybill",
  "damage",
  "document",
] as const

/** Куда распознаём: чек — в расход, накладная — в документ заказа. */
const OCR_TYPES = new Set(["receipt", "waybill", "document"])

/** 15 МБ — хватает фото с телефона, и не даёт залить что-то тяжёлое. */
const MAX_BYTES = 15 * 1024 * 1024

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
}

function safeName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\-]+/g, "_")
  return base.slice(-40) || "photo"
}

export async function POST(request: NextRequest) {
  const auth = await requireAnySession(request)
  if (!auth.ok) return auth.response

  const session = auth.value
  const org = requireOrganization(session)
  if (!org.ok) return org.response

  try {
    const form = await request.formData().catch(() => null)
    if (!form) {
      return NextResponse.json(
        { success: false, error: "Ожидается multipart/form-data с файлом" },
        { status: 400 },
      )
    }

    const file = form.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "Файл не передан" }, { status: 400 })
    }

    const type = String(form.get("type") || "").trim()
    if (!(PHOTO_TYPES as readonly string[]).includes(type)) {
      return NextResponse.json(
        { success: false, error: `Неизвестный тип фото: ${type || "пусто"}` },
        { status: 400 },
      )
    }

    const extension = ALLOWED_MIME[file.type]
    if (!extension) {
      return NextResponse.json(
        { success: false, error: `Формат ${file.type || "неизвестный"} не поддерживается` },
        { status: 415 },
      )
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: "Файл больше 15 МБ — сожмите фото" },
        { status: 413 },
      )
    }

    // Автор фото: водитель — всегда из сессии, логист или админ — из тела запроса
    const driverId =
      session.kind === "driver" ? session.driver.id : String(form.get("driverId") || "").trim()

    if (!driverId) {
      return NextResponse.json(
        { success: false, error: "Не указан водитель, которому принадлежит фото" },
        { status: 400 },
      )
    }

    const driver = await prisma.driver.findFirst({
      where: scopedWhere(org.organizationId, { id: driverId }),
      select: { id: true },
    })
    if (!driver) {
      return NextResponse.json({ success: false, error: "Водитель не найден" }, { status: 404 })
    }

    const orderId = String(form.get("orderId") || "").trim() || null
    const routeId = String(form.get("routeId") || "").trim() || null
    const description = String(form.get("description") || "").trim() || null

    if (orderId) {
      const order = await prisma.order.findFirst({
        where: scopedWhere(org.organizationId, { id: orderId }),
        select: { id: true, routeId: true },
      })
      if (!order) {
        return NextResponse.json({ success: false, error: "Заказ не найден" }, { status: 404 })
      }
    }

    // Рейс: если он не передан, а заказ в рейсе — берём рейс заказа,
    // иначе фото потерялось бы для истории рейса
    let finalRouteId = routeId
    if (!finalRouteId && orderId) {
      const order = (await prisma.order.findFirst({
        where: scopedWhere(org.organizationId, { id: orderId }),
        select: { routeId: true },
      })) as { routeId: string | null } | null
      finalRouteId = order?.routeId ?? null
    }

    if (finalRouteId) {
      const route = await prisma.route.findFirst({
        where: scopedWhere(org.organizationId, { id: finalRouteId }),
        select: { id: true },
      })
      if (!route) {
        return NextResponse.json({ success: false, error: "Рейс не найден" }, { status: 404 })
      }
    }

    // Сохраняем файл: public/uploads/<организация>/<дата>/<имя>.
    // Корень каталога — константа (папка задана статически), динамическая часть
    // добавляется второй ступенью: иначе сборщик считает путь произвольным и
    // тянет в образ весь проект целиком
    const uploadsRoot = path.join(process.cwd(), "public", "uploads")
    const relativeDir = path.join(
      org.organizationId ?? "shared",
      new Date().toISOString().slice(0, 10),
    )
    const absoluteDir = path.join(uploadsRoot, relativeDir)

    await mkdir(absoluteDir, { recursive: true })

    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName(file.name || "photo")}`
    const absolutePath = path.join(absoluteDir, fileName)
    const bytes = Buffer.from(await file.arrayBuffer())
    await writeFile(absolutePath, bytes)

    const url = `/uploads/${relativeDir.split(path.sep).join("/")}/${fileName}`

    const photo = (await prisma.photo.create({
      data: {
        organizationId: org.organizationId,
        url,
        type,
        driverId,
        orderId,
        routeId: finalRouteId,
        description,
      },
    })) as { id: string; url: string; type: string; createdAt: Date }

    // Логисту полезно узнать о фото от водителя (особенно о повреждении):
    // раньше это делал старый JSON-эндпоинт /api/m/photos, теперь — здесь,
    // потому что загрузка у водителя одна
    if (session.kind === "driver") {
      await prisma.notification.create({
        data: {
          organizationId: org.organizationId,
          userId: "logist",
          userRole: "logist",
          type: "new_photo",
          title: "Новое фото от водителя",
          message: `Водитель загрузил фото: ${type}`,
          driverId,
          orderId,
          photoId: photo.id,
          priority: type === "damage" ? "high" : "normal",
        },
      })
    }

    if (finalRouteId) {
      await logRouteEvent(prisma, {
        organizationId: org.organizationId,
        routeId: finalRouteId,
        driverId,
        type: "photo",
        orderId,
        // в событии рейса храним, что за фото и где оно лежит
        data: JSON.stringify({ photoId: photo.id, photoType: type, url }),
      })
    }

    // Распознаём сразу, чтобы водитель не ждал отдельной кнопки.
    // Ошибка OCR не отменяет загрузку: фото уже сохранено и видно.
    let parsed: unknown = null
    let ocrWarnings: string[] = []

    if (OCR_TYPES.has(type)) {
      const hint = type === "waybill" ? "waybill" : type === "receipt" ? "receipt" : null
      const outcome = await recognizeDocumentOnPhoto({ url, hint })

      if (outcome.ok) {
        parsed = outcome.parsed
        ocrWarnings = outcome.parsed.warnings

        // org-audit: ok — фото создано выше внутри организации
        await prisma.photo.update({
          where: { id: photo.id },
          data: {
            ocrText: outcome.ocr.text.slice(0, 8000),
            ocrData: JSON.stringify(ocrDataPayload(outcome.ocr, outcome.parsed)),
          },
        })
      } else {
        ocrWarnings = [outcome.error]
      }
    }

    return NextResponse.json({
      success: true,
      photo: {
        id: photo.id,
        url: photo.url,
        type: photo.type,
        orderId,
        routeId: finalRouteId,
        createdAt: photo.createdAt,
      },
      ocr: parsed,
      warnings: ocrWarnings,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить фото"
    console.error("[Photos Upload] error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

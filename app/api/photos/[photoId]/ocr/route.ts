// app/api/photos/[photoId]/ocr/route.ts
//
// Распознать чек или накладную на уже загруженном фото (задача 7).
//
// Нужно в двух случаях: переснять/перезалить фото (распознавание было плохим)
// и разобрать накладную, которую загрузили как обычное фото рейса. Результат
// сохраняется в Photo.ocrText/ocrData, поэтому повторно распознавать не нужно.

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization, scopedWhere } from "@/lib/org"
import { ocrDataPayload, recognizeDocumentOnPhoto } from "@/lib/ocr/service"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ photoId: string }> }

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error

  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  try {
    const { photoId } = await params
    const body = (await request.json().catch(() => null)) as { hint?: string } | null

    const photo = (await prisma.photo.findFirst({
      where: scopedWhere(org.organizationId, { id: photoId }),
      select: { id: true, url: true, type: true },
    })) as { id: string; url: string; type: string } | null

    if (!photo) {
      return NextResponse.json({ success: false, error: "Фото не найдено" }, { status: 404 })
    }

    const hint =
      body?.hint === "receipt" || body?.hint === "waybill"
        ? body.hint
        : photo.type === "receipt"
          ? "receipt"
          : photo.type === "waybill"
            ? "waybill"
            : null

    const outcome = await recognizeDocumentOnPhoto({ url: photo.url, hint })

    if (!outcome.ok) {
      return NextResponse.json({ success: false, error: outcome.error }, { status: 422 })
    }

    // org-audit: ok — фото найдено выше через scopedWhere(organizationId)
    await prisma.photo.update({
      where: { id: photoId },
      data: {
        ocrText: outcome.ocr.text.slice(0, 8000),
        ocrData: JSON.stringify(ocrDataPayload(outcome.ocr, outcome.parsed)),
      },
    })

    return NextResponse.json({
      success: true,
      photoId,
      detectedKind: outcome.detectedKind,
      parsed: outcome.parsed,
      text: outcome.ocr.text.slice(0, 2000),
      confidence: Math.round(outcome.ocr.confidence),
      durationMs: outcome.ocr.durationMs,
      warnings: outcome.parsed.warnings,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось распознать фото"
    console.error("[Photo OCR] error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

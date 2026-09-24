// app/api/m/photos/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

import { forbidden, requireDriver } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
// GET — фото водителя (только свои)
export async function GET(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const driverId = auth.value.driver.id

  try {
    const { searchParams } = new URL(request.url)
    const orderId = searchParams.get("orderId")
    const type = searchParams.get("type")

    const where: Record<string, string> = { driverId }
    if (orderId) where.orderId = orderId
    if (type) where.type = type

    const photos = await prisma.photo.findMany({
      where: scopedWhere(org.organizationId, where),
      orderBy: { createdAt: "desc" },
      take: 50,
    })

    return NextResponse.json({
      success: true,
      photos,
    })
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error"
    console.error("[Photos GET] Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    )
  }
}

// Загрузка фото водителем — POST /api/photos/upload (multipart, файл + OCR).
//
// Раньше здесь принимался JSON с url вида data:image/...;base64 — «фото»
// складывалось прямо в базу, не было ни файла, ни распознавания, ни события
// рейса. Такой путь убран: фото обязано быть файлом на диске, а чек — попадать
// в расходы рейса. Поэтому у этого обработчика остались только чтение и
// удаление своих фото.

export async function DELETE(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json(
        { success: false, error: "id обязателен" },
        { status: 400 },
      )
    }

    const photo = await prisma.photo.findFirst({
      where: scopedWhere(org.organizationId, { id }),
      select: { id: true, driverId: true },
    })

    if (!photo) {
      return NextResponse.json(
        { success: false, error: "Фото не найдено" },
        { status: 404 },
      )
    }

    if (photo.driverId !== auth.value.driver.id) {
      return forbidden("Можно удалять только свои фото")
    }

    await prisma.photo.deleteMany({
      where: scopedWhere(org.organizationId, { id }),
    })

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error"
    console.error("[Photos DELETE] Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    )
  }
}
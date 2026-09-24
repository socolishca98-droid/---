// app/api/photos/route.ts
// Веб-API для работы с фотографиями (страница /photos)
//
// GET  /api/photos          - список фото (опциональные фильтры)
// POST /api/photos          - сохранить новое фото с AI-метаданными (mock AI)

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization, scopedWhere } from "@/lib/org"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

type MetaPayload = {
  aiClassification?: any
  ocrData?: any
}

function mapPhoto(dbPhoto: any) {
  let aiClassification: any = undefined
  let ocrData: any = undefined

  if (dbPhoto.ocrData) {
    try {
      const meta = JSON.parse(dbPhoto.ocrData) as {
        aiClassification?: any
        ocrData?: any
      }
      if (meta && typeof meta === "object") {
        aiClassification = meta.aiClassification
        ocrData = meta.ocrData ?? meta
      }
    } catch {
      // старые/битые данные просто игнорируем
    }
  }

  return {
    id: dbPhoto.id,
    url: dbPhoto.url,
    type: dbPhoto.type,
    driverId: dbPhoto.driverId,
    orderId: dbPhoto.orderId,
    description: dbPhoto.description,
    createdAt: dbPhoto.createdAt,
    uploadedAt: dbPhoto.createdAt,
    aiClassification,
    ocrData,
  }
}

/**
 * Фотографии заказов, отобранные по клиенту/рейсу/машине (задача 5).
 *
 * Фото привязано к заказу, а не к клиенту: фильтры по клиенту, рейсу и машине
 * сначала превращаются в список заказов своей организации, а уже затем
 * ограничивают выборку фотографий. Так фильтр не может вывести за границы
 * организации, даже если чужой id пришёл в параметре.
 */
async function orderIdsForFilters(params: {
  organizationId: string
  clientId?: string | null
  routeId?: string | null
  vehicleId?: string | null
}): Promise<string[] | null> {
  const { organizationId, clientId, routeId, vehicleId } = params
  if (!clientId && !routeId && !vehicleId) return null

  const where: Record<string, unknown> = {}
  if (clientId) where.clientId = clientId
  if (routeId) where.routeId = routeId
  if (vehicleId) where.assignedVehicleId = vehicleId

  const orders = await prisma.order.findMany({
    where: scopedWhere(organizationId, where),
    select: { id: true },
    take: 1000,
  })

  return orders.map((order) => order.id)
}

// GET /api/photos?driverId=&orderId=&type=&clientId=&routeId=&vehicleId=&limit=
export async function GET(request: NextRequest) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  try {
    const { searchParams } = new URL(request.url)
    const driverId = searchParams.get("driverId")
    const orderId = searchParams.get("orderId")
    const type = searchParams.get("type")
    const clientId = searchParams.get("clientId")
    const routeId = searchParams.get("routeId")
    const vehicleId = searchParams.get("vehicleId")
    const limit = parseInt(searchParams.get("limit") || "100", 10)

    const where: Record<string, unknown> = {}

    if (driverId) where.driverId = driverId
    if (orderId) where.orderId = orderId
    if (type) where.type = type

    const filteredOrderIds = await orderIdsForFilters({
      organizationId: __org.organizationId,
      clientId,
      routeId,
      vehicleId,
    })
    if (filteredOrderIds) where.orderId = { in: filteredOrderIds }

    const photos = await prisma.photo.findMany({
      where: scopedWhere(__org.organizationId, where),
      orderBy: { createdAt: "desc" },
      take: Number.isFinite(limit) && limit > 0 ? limit : 100,
    })

    return NextResponse.json({
      success: true,
      photos: photos.map(mapPhoto),
    })
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error"
    console.error("[Photos API] GET error:", message, error)
    return NextResponse.json(
      { success: false, error: message, photos: [] },
      { status: 500 },
    )
  }
}

// POST /api/photos
// body: { url, type, driverId, orderId?, description?, aiClassification?, ocrData? }
export async function POST(request: NextRequest) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  try {
    const body = (await request.json().catch(() => null)) as
      | {
          url?: string
          type?: string
          driverId?: string
          orderId?: string | null
          description?: string | null
          aiClassification?: any
          ocrData?: any
        }
      | null

    if (!body) {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body" },
        { status: 400 },
      )
    }

    const { url, type, driverId, orderId, description } = body

    if (!url || !type || !driverId) {
      return NextResponse.json(
        {
          success: false,
          error: "url, type и driverId обязательны",
        },
        { status: 400 },
      )
    }

    const meta: MetaPayload = {}
    if (body.aiClassification) meta.aiClassification = body.aiClassification
    if (body.ocrData) meta.ocrData = body.ocrData

    const hasMeta =
      meta.aiClassification != null || meta.ocrData != null

    // Фото привязывается к водителю своей организации: чужой driverId не пройдёт
    const driver = await prisma.driver.findFirst({
      where: scopedWhere(__org.organizationId, { id: driverId }),
      select: { id: true },
    })
    if (!driver) {
      return NextResponse.json(
        { success: false, error: "Водитель не найден" },
        { status: 404 },
      )
    }

    if (orderId) {
      const order = await prisma.order.findFirst({
        where: scopedWhere(__org.organizationId, { id: orderId }),
        select: { id: true },
      })
      if (!order) {
        return NextResponse.json(
          { success: false, error: "Заказ не найден" },
          { status: 404 },
        )
      }
    }

    const dbPhoto = await prisma.photo.create({
      data: {
        organizationId: __org.organizationId,
        url,
        type,
        driverId,
        orderId: orderId || null,
        description: description || null,
        ocrText: null,
        ocrData: hasMeta ? JSON.stringify(meta) : null,
      },
    })

    const photo = mapPhoto(dbPhoto)

    return NextResponse.json({
      success: true,
      photo,
    })
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error"
    console.error("[Photos API] POST error:", message, error)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    )
  }
}
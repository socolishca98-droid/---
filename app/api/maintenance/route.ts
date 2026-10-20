// app/api/maintenance/route.ts
//
// Обслуживание и документы машин для организаторов: сроки ТО, страховки
// и техосмотра по каждой машине + журнал ремонтов (MaintenanceLog).
// Все данные — только своей организации (scopedWhere из сессии).

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { friendlyDbError, friendlyDbErrorStatus } from "@/lib/db/errors"
import {
  MAINTENANCE_TYPES,
  maintenanceSpend,
  maintenanceTotals,
  vehicleDeadlines,
} from "@/lib/maintenance/schedule"
import { paginationMeta, parsePagination } from "@/lib/pagination"

// GET /api/maintenance — сроки по машинам и журнал обслуживания
export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const { searchParams } = new URL(request.url)

    // Журнал ремонтов — постранично: раньше он молча брал MAX_LOGS строк,
    // и страница не могла показать, что записей больше.
    const pagination = parsePagination({
      limit: searchParams.get("limit"),
      offset: searchParams.get("offset"),
      page: searchParams.get("page"),
      pageSize: searchParams.get("pageSize"),
    })

    // Сводка «Потрачено на ремонты» считается по всей базе за период,
    // а не по текущей странице журнала.
    const fromParam = searchParams.get("from")
    const toParam = searchParams.get("to")
    const spendFrom = fromParam && !Number.isNaN(new Date(fromParam).getTime()) ? new Date(fromParam) : null
    const spendTo = toParam && !Number.isNaN(new Date(toParam).getTime())
      ? new Date(new Date(toParam).getTime() + 24 * 60 * 60 * 1000)
      : null

    const spendLogs = await prisma.maintenanceLog.findMany({
      where: scopedWhere(org.organizationId, {
        startedAt: {
          ...(spendFrom ? { gte: spendFrom } : {}),
          ...(spendTo ? { lte: spendTo } : {}),
        },
      }),
      select: {
        cost: true,
        vehicle: { select: { id: true, plate: true } },
      },
    })

    const [vehicleRows, logRows, logsTotal] = await Promise.all([
      prisma.vehicle.findMany({
        where: scopedWhere(org.organizationId, {}),
        orderBy: { plate: "asc" },
        select: {
          id: true,
          plate: true,
          brand: true,
          model: true,
          year: true,
          mileage: true,
          status: true,
          lastMaintenanceDate: true,
          nextMaintenanceDate: true,
          insuranceExpiry: true,
          inspectionExpiry: true,
        },
      }),
      prisma.maintenanceLog.findMany({
        where: scopedWhere(org.organizationId, {}),
        orderBy: { startedAt: "desc" },
        skip: pagination.offset,
        take: pagination.limit,
        include: {
          vehicle: { select: { id: true, plate: true } },
          driver: { select: { id: true, name: true } },
        },
      }),
      prisma.maintenanceLog.count({ where: scopedWhere(org.organizationId, {}) }),
    ])

    const now = new Date()

    // Худший срок машины определяет её место в списке: сначала проблемы.
    const severity: Record<string, number> = { expired: 2, soon: 1, ok: 0 }
    const vehicles = vehicleRows
      .map((vehicle: any) => {
        const deadlines = vehicleDeadlines(vehicle, now)
        return {
          id: vehicle.id,
          plate: vehicle.plate,
          brand: vehicle.brand,
          model: vehicle.model,
          year: vehicle.year,
          mileage: vehicle.mileage,
          status: vehicle.status,
          lastMaintenanceDate: vehicle.lastMaintenanceDate,
          deadlines,
        }
      })
      .sort((a: any, b: any) => {
        const sa = a.deadlines.worst ? severity[a.deadlines.worst] : -1
        const sb = b.deadlines.worst ? severity[b.deadlines.worst] : -1
        return sb - sa
      })

    const logs = logRows.map((log: any) => ({
      id: log.id,
      type: log.type,
      description: log.description,
      mileage: log.mileage,
      costRub: log.cost,
      performer: log.performer,
      serviceName: log.serviceName,
      status: log.status,
      startedAt: log.startedAt,
      completedAt: log.completedAt,
      vehicleId: log.vehicle?.id ?? null,
      vehiclePlate: log.vehicle?.plate ?? null,
      driverName: log.driver?.name ?? null,
    }))

    const expiredCount = vehicles.filter((v: any) => v.deadlines.worst === "expired").length
    const soonCount = vehicles.filter((v: any) => v.deadlines.worst === "soon").length

    return NextResponse.json({
      success: true,
      now: now.toISOString(),
      totals: {
        vehicles: vehicles.length,
        inMaintenance: vehicleRows.filter((vehicle: any) => vehicle.status === "maintenance").length,
        expiredCount,
        soonCount,
        ...maintenanceTotals(logs),
      },
      vehicles,
      logs,
      // Потрачено на ремонты: за период (from/to) по парку и по машинам
      spend: maintenanceSpend(
        spendLogs.map((log) => ({
          cost: log.cost,
          vehicleId: log.vehicle?.id ?? null,
          vehiclePlate: log.vehicle?.plate ?? null,
        })),
      ),
      spendPeriod: { from: fromParam ?? null, to: toParam ?? null },
      // Мета пагинации журнала: «показано N из M» вместо прежней тишины
      pagination: paginationMeta(logsTotal, pagination, logs.length),
    })
  } catch (error) {
    const status = friendlyDbErrorStatus(error)
    return NextResponse.json(
      { success: false, error: friendlyDbError(error) ?? "Не удалось загрузить обслуживание" },
      { status },
    )
  }
}

// POST /api/maintenance — записать работу в журнал ремонтов.
// Логист или сотрудник заводит ремонт: машина своей организации, архивные
// машины не принимаются. Удаления нет — запись остаётся в истории.
export async function POST(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) {
    return NextResponse.json({ success: false, error: "Некорректное тело запроса" }, { status: 400 })
  }

  const allowed = [
    "vehicleId",
    "type",
    "description",
    "mileage",
    "cost",
    "serviceName",
    "workOrderNumber",
    "startedAt",
    "status",
  ]
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    return NextResponse.json(
      { success: false, error: `Неизвестные поля: ${unknown.join(", ")}` },
      { status: 400 },
    )
  }

  const vehicleId = typeof body.vehicleId === "string" ? body.vehicleId.trim() : ""
  if (!vehicleId) {
    return NextResponse.json({ success: false, error: "Укажите машину" }, { status: 400 })
  }

  const vehicle = await prisma.vehicle.findFirst({
    where: scopedWhere(org.organizationId, { id: vehicleId }),
    select: { id: true, archivedAt: true },
  })
  if (!vehicle) {
    return NextResponse.json({ success: false, error: "Машина не найдена" }, { status: 404 })
  }
  if (vehicle.archivedAt) {
    return NextResponse.json(
      { success: false, error: "Машина в архиве — работу по ней записать нельзя" },
      { status: 409 },
    )
  }

  const type = typeof body.type === "string" ? body.type.trim() : "repair"
  if (!(MAINTENANCE_TYPES as readonly string[]).includes(type)) {
    return NextResponse.json({ success: false, error: `Неизвестный вид работы: ${type}` }, { status: 400 })
  }

  const description = typeof body.description === "string" ? body.description.trim() : ""
  if (description.length < 3) {
    return NextResponse.json({ success: false, error: "Опишите работу (хотя бы пару слов)" }, { status: 400 })
  }

  const costRaw = body.cost === undefined || body.cost === null || body.cost === "" ? null : Number(body.cost)
  if (costRaw !== null && (!Number.isFinite(costRaw) || costRaw < 0 || costRaw > 10_000_000)) {
    return NextResponse.json({ success: false, error: "Некорректная стоимость" }, { status: 400 })
  }
  const mileageRaw = body.mileage === undefined || body.mileage === null || body.mileage === "" ? null : Number(body.mileage)
  if (mileageRaw !== null && (!Number.isFinite(mileageRaw) || mileageRaw < 0 || mileageRaw > 10_000_000)) {
    return NextResponse.json({ success: false, error: "Некорректный пробег" }, { status: 400 })
  }

  const startedAt =
    typeof body.startedAt === "string" && !Number.isNaN(new Date(body.startedAt).getTime())
      ? new Date(body.startedAt)
      : new Date()

  try {
    const log = await prisma.maintenanceLog.create({
      data: {
        organizationId: org.organizationId,
        vehicleId: vehicle.id,
        type,
        description,
        mileage: mileageRaw === null ? null : Math.round(mileageRaw),
        cost: costRaw === null ? null : Math.round(costRaw),
        serviceName: typeof body.serviceName === "string" ? body.serviceName.trim() || null : null,
        workOrderNumber:
          typeof body.workOrderNumber === "string" ? body.workOrderNumber.trim().slice(0, 100) || null : null,
        status: body.status === "completed" ? "completed" : "in_progress",
        startedAt,
        ...(body.status === "completed" ? { completedAt: startedAt } : {}),
        performer: "staff",
      },
      select: { id: true },
    })

    return NextResponse.json({ success: true, id: log.id, message: "Работа записана" })
  } catch (error) {
    const status = friendlyDbErrorStatus(error)
    return NextResponse.json(
      { success: false, error: friendlyDbError(error) ?? "Не удалось записать работу" },
      { status },
    )
  }
}

// PATCH /api/maintenance — изменить запись журнала (по id в теле).
// Удаления нет: история ремонтов остаётся, можно закрыть работу или поправить
// данные, например дописать номер заказ-наряда.
export async function PATCH(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) {
    return NextResponse.json({ success: false, error: "Некорректное тело запроса" }, { status: 400 })
  }

  const id = typeof body.id === "string" ? body.id.trim() : ""
  if (!id) {
    return NextResponse.json({ success: false, error: "Укажите запись" }, { status: 400 })
  }

  const allowed = [
    "id",
    "status",
    "cost",
    "mileage",
    "description",
    "serviceName",
    "workOrderNumber",
    "startedAt",
    "completedAt",
  ]
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    return NextResponse.json(
      { success: false, error: `Неизвестные поля: ${unknown.join(", ")}` },
      { status: 400 },
    )
  }

  const existing = await prisma.maintenanceLog.findFirst({
    where: scopedWhere(org.organizationId, { id }),
    select: { id: true },
  })
  if (!existing) {
    return NextResponse.json({ success: false, error: "Запись не найдена" }, { status: 404 })
  }

  const data: Record<string, unknown> = {}

  if (body.status !== undefined) {
    if (body.status !== "in_progress" && body.status !== "completed") {
      return NextResponse.json({ success: false, error: "Неизвестный статус" }, { status: 400 })
    }
    data.status = body.status
    if (body.status === "completed") data.completedAt = new Date()
    if (body.status === "in_progress") data.completedAt = null
  }
  if (body.cost !== undefined && body.cost !== null && body.cost !== "") {
    const cost = Number(body.cost)
    if (!Number.isFinite(cost) || cost < 0 || cost > 10_000_000) {
      return NextResponse.json({ success: false, error: "Некорректная стоимость" }, { status: 400 })
    }
    data.cost = Math.round(cost)
  }
  if (body.mileage !== undefined && body.mileage !== null && body.mileage !== "") {
    const mileage = Number(body.mileage)
    if (!Number.isFinite(mileage) || mileage < 0 || mileage > 10_000_000) {
      return NextResponse.json({ success: false, error: "Некорректный пробег" }, { status: 400 })
    }
    data.mileage = Math.round(mileage)
  }
  if (typeof body.description === "string") {
    const description = body.description.trim()
    if (description.length < 3) {
      return NextResponse.json({ success: false, error: "Опишите работу (хотя бы пару слов)" }, { status: 400 })
    }
    data.description = description
  }
  if (typeof body.serviceName === "string") {
    data.serviceName = body.serviceName.trim() || null
  }
  if (typeof body.workOrderNumber === "string") {
    data.workOrderNumber = body.workOrderNumber.trim().slice(0, 100) || null
  }
  if (typeof body.startedAt === "string" && !Number.isNaN(new Date(body.startedAt).getTime())) {
    data.startedAt = new Date(body.startedAt)
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ success: false, error: "Нечего менять" }, { status: 400 })
  }

  try {
    await prisma.maintenanceLog.update({
      where: { id: existing.id },
      data,
    })
    return NextResponse.json({ success: true, message: "Запись обновлена" })
  } catch (error) {
    const status = friendlyDbErrorStatus(error)
    return NextResponse.json(
      { success: false, error: friendlyDbError(error) ?? "Не удалось обновить запись" },
      { status },
    )
  }
}

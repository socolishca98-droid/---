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
import { maintenanceTotals, vehicleDeadlines } from "@/lib/maintenance/schedule"
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

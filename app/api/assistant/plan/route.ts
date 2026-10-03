// app/api/assistant/plan/route.ts
//
// GET /api/assistant/plan?vehicleId=&exclude=id1,id2
//
// «Мозг» виртуального логиста: из базы заказов организации собирает
// предложения маршрута (цепочки заказов) для свободной машины. Машина —
// выбранная логистом (vehicleId) или свободная с наибольшей
// грузоподъёмностью. exclude — заказы, которые логист отклонил: цепочки
// пересобираются без них (другой вариант).
//
// Логика — lib/assistant/planner.ts (чистая), данные — строго в границах
// организации из сессии. Создание рейса — через проверенный POST /api/routes.

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/auth/session";
import { requireOrganization, scopedWhere } from "@/lib/org";
import {
  availableVehicles,
  buildPlanProposals,
  pickDefaultVehicle,
} from "@/lib/assistant/planner";

export const dynamic = "force-dynamic";

const VEHICLE_SELECT = {
  id: true,
  plate: true,
  type: true,
  brand: true,
  model: true,
  capacity: true,
  volume: true,
  status: true,
} as const;

const ORDER_SELECT = {
  id: true,
  routeFrom: true,
  routeTo: true,
  distance: true,
  weight: true,
  volume: true,
  price: true,
  agreedPrice: true,
  deadline: true,
  status: true,
  clientName: true,
  routeId: true,
} as const;

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request);
  if (!auth.ok) return auth.response;

  const org = requireOrganization(auth.value);
  if (!org.ok) return org.response;

  try {
    const { searchParams } = new URL(request.url);
    const vehicleId = searchParams.get("vehicleId")?.trim() || null;
    const excludeIds = (searchParams.get("exclude") || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    const [vehicles, orders] = await Promise.all([
      prisma.vehicle.findMany({
        where: scopedWhere(org.organizationId),
        select: VEHICLE_SELECT,
        orderBy: { createdAt: "asc" },
      }),
      prisma.order.findMany({
        where: scopedWhere(org.organizationId, { routeId: null }),
        select: ORDER_SELECT,
        orderBy: [{ deadline: "asc" }, { createdAt: "desc" }],
        take: 400,
      }),
    ]);

    const free = availableVehicles(vehicles);

    // Машина: выбранная логистом (только своя, иначе 404) или свободная по умолчанию
    let vehicle = null;
    if (vehicleId) {
      vehicle = vehicles.find((item: any) => item.id === vehicleId) ?? null;
      if (!vehicle) {
        return NextResponse.json(
          { success: false, error: "Машина не найдена" },
          { status: 404 },
        );
      }
    } else {
      vehicle = pickDefaultVehicle(vehicles);
    }

    if (!vehicle) {
      return NextResponse.json({
        success: true,
        vehicle: null,
        vehicles: free,
        proposals: [],
        stats: { candidates: 0, overweight: 0, excluded: 0 },
        warning:
          free.length === 0
            ? "Свободных машин нет: все в рейсах или на обслуживании"
            : "Не выбрано ни одной машины",
      });
    }

    const { proposals, stats } = buildPlanProposals({
      orders,
      vehicle,
      excludeIds,
    });

    return NextResponse.json({
      success: true,
      vehicle,
      // Для переключателя машин — только свободные
      vehicles: free,
      proposals,
      stats,
      warning:
        proposals.length === 0
          ? stats.candidates === 0
            ? "Актуальных заказов нет: все закрыты или уже в рейсах"
            : "Под эту машину заказы не подобрать: не помещаются по весу или объёму"
          : null,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Не удалось собрать предложения маршрута";
    console.error("[api/assistant/plan GET] Error:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

// app/api/assistant/plan/route.ts
//
// GET /api/assistant/plan?vehicleId=&exclude=id1,id2&routeId=
//
// «Мозг» виртуального логиста: из базы заказов организации собирает
// предложения маршрута (цепочки заказов) для свободной машины. Машина —
// выбранная логистом (vehicleId) или свободная с наибольшей
// грузоподъёмностью. exclude — заказы, которые логист отклонил: цепочки
// пересобираются без них (другой вариант). routeId — дособорка существующего
// рейса: цепочка продолжается с города последней выгрузки, а бюджет машины
// уменьшается на уже загруженный вес. Неактуальные заказы (срок истёк или
// давно без движения) в план не попадают и возвращаются отдельным списком.
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
  isPlanCandidate,
  orderRelevance,
  pickDefaultVehicle,
} from "@/lib/assistant/planner";
import { OCCUPYING_ORDER_STATUSES } from "@/lib/routes/model";

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
  negotiationStatus: true,
  clientName: true,
  updatedAt: true,
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
    const routeId = searchParams.get("routeId")?.trim() || null;
    const excludeIds = (searchParams.get("exclude") || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    const [vehicles, orders, route] = await Promise.all([
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
      routeId
        ? prisma.route.findFirst({
            where: scopedWhere(org.organizationId, { id: routeId }),
            select: { id: true, name: true, status: true, vehicleId: true },
          })
        : Promise.resolve(null),
    ]);

    // Дособорка: чужой или несуществующий рейс — сразу 404
    if (routeId && !route) {
      return NextResponse.json(
        { success: false, error: "Рейс не найден" },
        { status: 404 },
      );
    }
    // Завершённый рейс дособирать нельзя — attach-orders всё равно откажет
    if (
      route &&
      (route.status === "completed" || route.status === "cancelled")
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Рейс завершён или отменён — дособирать нельзя",
        },
        { status: 409 },
      );
    }

    // Заказы рейса: занятый бюджет и город продолжения цепочки. Считаем до
    // выбора машины — они нужны даже тогда, когда машины нет.
    let routeOrders: any[] = [];
    if (route) {
      routeOrders = await prisma.order.findMany({
        where: scopedWhere(org.organizationId, { routeId: route.id }),
        select: {
          id: true,
          routeTo: true,
          weight: true,
          volume: true,
          status: true,
          routeSequence: true,
        },
        orderBy: { routeSequence: "asc" },
      });
    }
    const occupying = routeOrders.filter((order: any) =>
      (OCCUPYING_ORDER_STATUSES as readonly string[]).includes(order.status),
    );
    // Вес/объём занимают только незакрытые заказы: доставленное выгружено.
    const usedWeightKg = occupying.reduce(
      (sum: number, order: any) => sum + (order.weight ?? 0),
      0,
    );
    const usedVolumeM3 = occupying.reduce(
      (sum: number, order: any) => sum + (order.volume ?? 0),
      0,
    );
    // Конечная точка машины — последний по порядку НЕотменённый заказ:
    // доставленный заказ машина уже проехала, отменённый — не поедет.
    const lastPhysical = [...routeOrders]
      .reverse()
      .find(
        (order: any) =>
          order.status !== "cancelled" && order.status !== "rejected",
      );
    const startCity: string | null = route
      ? (lastPhysical?.routeTo ?? null)
      : null;

    const free = availableVehicles(vehicles);

    // Машина: при дособорке бюджет задаёт машина рейса — груз физически
    // поедет в ней, «выбрать другую» здесь бессмысленно. Если у рейса машины
    // нет, считаем для выбранной логистом (её он рейсу и назначит). Без
    // рейса — выбранная логистом или свободная с наибольшей грузоподъёмностью.
    let vehicle = null;
    if (route?.vehicleId) {
      vehicle =
        vehicles.find((item: any) => item.id === route.vehicleId) ?? null;
    }
    if (!vehicle && vehicleId) {
      vehicle = vehicles.find((item: any) => item.id === vehicleId) ?? null;
      if (!vehicle) {
        return NextResponse.json(
          { success: false, error: "Машина не найдена" },
          { status: 404 },
        );
      }
    }
    if (!vehicle && !route) {
      vehicle = pickDefaultVehicle(vehicles);
    }

    if (!vehicle) {
      // Машины нет, но честная статистика важнее нулей: иначе UI решит, что
      // база пуста. Актуальность — чистые функции, машина для них не нужна.
      const exclude = new Set(excludeIds);
      const candidates = (orders as any[]).filter((order) =>
        isPlanCandidate(order),
      );
      const afterExclude = candidates.filter((order) => !exclude.has(order.id));
      const staleList: any[] = [];
      afterExclude.forEach((order) => {
        const verdict = orderRelevance(order);
        if (!verdict.relevant) {
          staleList.push({
            id: order.id,
            routeFrom: order.routeFrom,
            routeTo: order.routeTo,
            clientName: order.clientName,
            deadline: order.deadline,
            reason: verdict.reason ?? "Неактуальный заказ",
          });
        }
      });
      return NextResponse.json({
        success: true,
        vehicle: null,
        vehicles: free,
        route: route
          ? {
              id: route.id,
              name: route.name,
              status: route.status,
              vehiclePlate: null,
              ordersCount: routeOrders.length,
              usedWeightKg,
              freeWeightKg: null,
              lastCity: startCity,
            }
          : null,
        proposals: [],
        stats: {
          candidates: candidates.length,
          overweight: 0,
          excluded: candidates.length - afterExclude.length,
          stale: staleList.length,
        },
        staleOrders: staleList,
        warning: route
          ? "У рейса не назначена машина — свободный остаток не рассчитать. Назначьте машину рейсу или выберите свободную."
          : free.length === 0
            ? "Свободных машин нет: все в рейсах или на обслуживании"
            : "Не выбрано ни одной машины",
      });
    }

    const routeInfo = route
      ? {
          id: route.id,
          name: route.name,
          status: route.status,
          // Номер — только если бюджет считала настоящая машина рейса
          vehiclePlate:
            route.vehicleId === vehicle.id ? (vehicle.plate ?? null) : null,
          ordersCount: routeOrders.length,
          usedWeightKg,
          freeWeightKg: Math.max(0, vehicle.capacity - usedWeightKg),
          lastCity: startCity,
        }
      : null;

    const { proposals, stats, staleOrders } = buildPlanProposals({
      orders,
      vehicle,
      excludeIds,
      startCity,
      usedWeightKg,
      usedVolumeM3,
    });

    return NextResponse.json({
      success: true,
      vehicle,
      // Для переключателя машин — только свободные
      vehicles: free,
      route: routeInfo,
      proposals,
      stats,
      // Неактуальные заказы: срок истёк или давно без движения
      staleOrders,
      warning:
        proposals.length === 0
          ? stats.candidates === 0
            ? "Актуальных заказов нет: все закрыты или уже в рейсах"
            : routeInfo && routeInfo.freeWeightKg <= 0
              ? "В машине рейса не осталось свободного места"
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

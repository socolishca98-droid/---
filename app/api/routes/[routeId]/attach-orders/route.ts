// app/api/routes/[routeId]/attach-orders/route.ts
//
// POST /api/routes/[routeId]/attach-orders { orderIds: [...] }
//
// Дособорка рейса: добавить существующие согласованные заказы в уже
// созданный рейс (виртуальный логист предлагает продолжение цепочки,
// логист подтверждает). Повторяет проверенный путь POST /api/routes:
//   * рейс и заказы — только своей организации;
//   * брать можно только согласованные заказы (isOrderRouteable) и только
//     те, что ещё не в другом рейсе;
//   * порядковый номер продолжается от последнего в рейсе;
//   * статус переводится в in_route, если канон перехода разрешает, и это
//     попадает в ленту согласования заказа;
//   * итоги рейса пересчитываются (recalcRoute).

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/auth/session";
import { requireOrganization, scopedWhere } from "@/lib/org";
import { recalcRoute } from "@/lib/routes/service";
import {
  canChangeOrderStatus,
  isOrderRouteable,
  normalizeOrderStatus,
  orderStatusLabel,
} from "@/lib/orders/stages";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ routeId: string }> };

/** Сколько заказов можно добавить за один раз. */
const MAX_ATTACH = 20;

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireStaff(request);
  if (!auth.ok) return auth.response;

  const org = requireOrganization(auth.value);
  if (!org.ok) return org.response;

  try {
    const { routeId } = await params;
    if (!routeId) {
      return NextResponse.json(
        { success: false, error: "Не указан рейс" },
        { status: 400 },
      );
    }

    const body = (await request.json().catch(() => null)) as {
      orderIds?: unknown;
    } | null;
    const orderIds = Array.isArray(body?.orderIds)
      ? body!.orderIds.filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0,
        )
      : [];

    if (orderIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Передайте orderIds[] — какие заказы добавить",
        },
        { status: 400 },
      );
    }
    if (orderIds.length > MAX_ATTACH) {
      return NextResponse.json(
        {
          success: false,
          error: `За раз можно добавить не больше ${MAX_ATTACH} заказов`,
        },
        { status: 400 },
      );
    }

    // Рейс — только своей организации
    const route = await prisma.route.findFirst({
      where: scopedWhere(org.organizationId, { id: routeId }),
      select: { id: true, status: true, driverId: true, vehicleId: true },
    });
    if (!route) {
      return NextResponse.json(
        { success: false, error: "Рейс не найден" },
        { status: 404 },
      );
    }
    if (route.status === "completed" || route.status === "cancelled") {
      return NextResponse.json(
        {
          success: false,
          error: "Рейс завершён или отменён — добавлять заказы нельзя",
        },
        { status: 409 },
      );
    }

    // Заказы — только своей организации
    const orders: any[] = await prisma.order.findMany({
      where: scopedWhere(org.organizationId, { id: { in: orderIds } }),
      select: {
        id: true,
        status: true,
        routeId: true,
        routeFrom: true,
        routeTo: true,
      },
    });

    const notFound = orderIds.filter(
      (id) => !orders.some((order) => order.id === id),
    );
    if (notFound.length > 0) {
      return NextResponse.json(
        { success: false, error: `Заказы не найдены: ${notFound.length}` },
        { status: 404 },
      );
    }

    const notAgreed = orders.filter((order) => !isOrderRouteable(order.status));
    if (notAgreed.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `В рейс можно брать только согласованные заказы. Не подходят: ${notAgreed
            .map(
              (order) =>
                `${order.routeFrom} → ${order.routeTo} (${orderStatusLabel(order.status)})`,
            )
            .join("; ")}`,
          code: "orders_not_agreed",
          orderIds: notAgreed.map((order) => order.id),
        },
        { status: 409 },
      );
    }

    const alreadyInRoute = orders.filter((order) => order.routeId);
    if (alreadyInRoute.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Заказы уже включены в рейс: ${alreadyInRoute
            .map((order) => `${order.routeFrom} → ${order.routeTo}`)
            .join("; ")}`,
          code: "orders_already_in_route",
          orderIds: alreadyInRoute.map((order) => order.id),
        },
        { status: 409 },
      );
    }

    const actorName = auth.value.user?.name ?? auth.value.user?.email ?? null;

    const attached = await prisma.$transaction(async (tx: any) => {
      // Порядковый номер продолжается от последнего в рейсе
      const last = await tx.order.findFirst({
        where: scopedWhere(org.organizationId, { routeId: route.id }),
        select: { routeSequence: true },
        orderBy: { routeSequence: "desc" },
      });
      let sequence = last?.routeSequence ?? 0;

      const result: { id: string; status: string }[] = [];

      for (const order of orders) {
        sequence += 1;
        const current = normalizeOrderStatus(order.status);
        const next = canChangeOrderStatus(order.status, "in_route")
          ? "in_route"
          : current;

        await tx.order.updateMany({
          where: scopedWhere(org.organizationId, {
            id: order.id,
            routeId: null,
          }),
          data: {
            routeId: route.id,
            routeSequence: sequence,
            addedToRouteAt: new Date(),
            ...(next && { status: next }),
            ...(route.vehicleId && { assignedVehicleId: route.vehicleId }),
            ...(route.driverId && { assignedDriverId: route.driverId }),
          },
        });

        if (next && current && next !== current) {
          await tx.orderNegotiation.create({
            data: {
              organizationId: org.organizationId,
              orderId: order.id,
              kind: "status_change",
              text: `Статус: ${orderStatusLabel(order.status)} → ${orderStatusLabel(next)} (дособран в рейс)`,
              priceOffer: null,
              authorId: org.userId,
              authorName: actorName,
            },
          });
        }

        result.push({ id: order.id, status: next ?? order.status });
      }

      return result;
    });

    // Итоги рейса (км, вес, стоимость, статус) пересчитываются по заказам
    const summary = await recalcRoute(prisma, route.id, org.organizationId);

    return NextResponse.json({
      success: true,
      attached: attached.length,
      orders: attached,
      route: {
        id: route.id,
        name: summary.name,
        status: summary.status,
        ordersCount: summary.totalOrders,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Не удалось добавить заказы в рейс";
    console.error("[api/routes/attach-orders POST] Error:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

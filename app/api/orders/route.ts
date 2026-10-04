// app/api/orders/route.ts - P0 secured + P1-6 zod
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaffAuth } from "@/lib/api-auth";
import { requireStaffOrganization, scopedWhere } from "@/lib/org";
import { createOrderSchema, zodErrorResponse } from "@/lib/validators";
import { linkOrderToClientByName } from "@/lib/clients/service";
import { recalcRoute } from "@/lib/routes/service";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireStaffAuth(request);
    if (auth.error) return auth.error;
    const org = requireStaffOrganization(auth.user);
    if (!org.ok) return org.response;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const driverId = searchParams.get("driverId");
    const routeId = searchParams.get("routeId");
    const limit = Math.min(
      parseInt(searchParams.get("limit") || "100", 10),
      200,
    );
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    // Фильтры из query; организация добавляется отдельно в каждом запросе —
    // её нельзя ни снять, ни подменить параметром.
    const where: any = {};
    if (status) {
      if (status.includes(",")) {
        where.status = { in: status.split(",") };
      } else {
        where.status = status;
      }
    }
    if (driverId) where.assignedDriverId = driverId;
    if (routeId) where.routeId = routeId;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: scopedWhere(org.organizationId, where),
        orderBy: [{ routeSequence: "asc" }, { createdAt: "desc" }],
        take: limit,
        skip: offset,
      }),
      prisma.order.count({ where: scopedWhere(org.organizationId, where) }),
    ]);

    return NextResponse.json({
      success: true,
      orders,
      total,
      limit,
      offset,
      hasMore: offset + orders.length < total,
    });
  } catch (error: any) {
    console.error("[Orders API] GET Error:", error);
    return NextResponse.json(
      { success: false, error: error.message, orders: [] },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireStaffAuth(request);
    if (auth.error) return auth.error;
    const org = requireStaffOrganization(auth.user);
    if (!org.ok) return org.response;

    const rawBody = await request.json().catch(() => null);
    if (!rawBody) {
      return NextResponse.json(
        { success: false, error: "Invalid JSON" },
        { status: 400 },
      );
    }

    const parsed = createOrderSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(zodErrorResponse(parsed.error), { status: 400 });
    }

    const {
      source = "manual",
      sourceId,
      routeFrom,
      routeTo,
      distance,
      weight,
      volume,
      cargoType,
      price,
      clientName,
      clientContact,
      clientId,
      paymentType,
      vatType,
      deferredDays,
      deadline,
      assignedDriverId,
      assignedVehicleId,
      routeId,
      requirements,
      atiCacheId,
      agreedPrice,
      negotiationStatus,
      nextFollowUpAt,
    } = parsed.data;

    // Заказ на строку накопленной базы может быть у организации только один
    if (atiCacheId) {
      const taken = await prisma.order.findFirst({
        where: scopedWhere(org.organizationId, { atiCacheId }),
        select: { id: true },
      });
      if (taken) {
        return NextResponse.json(
          {
            success: false,
            error: "Этот груз уже взят в работу",
            code: "already_taken",
            orderId: taken.id,
          },
          { status: 409 },
        );
      }
    }

    // Назначить можно только своего водителя и свою машину
    if (assignedDriverId) {
      const driver = await prisma.driver.findFirst({
        where: scopedWhere(org.organizationId, { id: assignedDriverId }),
        select: { id: true },
      });
      if (!driver) {
        return NextResponse.json(
          { success: false, error: "Водитель не найден" },
          { status: 404 },
        );
      }
    }
    if (assignedVehicleId) {
      const vehicle = await prisma.vehicle.findFirst({
        where: scopedWhere(org.organizationId, { id: assignedVehicleId }),
        select: { id: true },
      });
      if (!vehicle) {
        return NextResponse.json(
          { success: false, error: "Машина не найдена" },
          { status: 404 },
        );
      }
    }
    // Рейс из тела запроса тоже проверяется: заказ своей организации
    // не должен ссылаться на рейс другой компании
    if (routeId) {
      const ownRoute = await prisma.route.findFirst({
        where: scopedWhere(org.organizationId, { id: routeId }),
        select: { id: true, status: true },
      });
      if (!ownRoute) {
        return NextResponse.json(
          { success: false, error: "Рейс не найден" },
          { status: 404 },
        );
      }
      // Закрытый рейс не оживает: в завершённый или отменённый рейс заказ
      // добавить нельзя — иначе его итоги и статус снова станут врать.
      if (ownRoute.status === "completed" || ownRoute.status === "cancelled") {
        return NextResponse.json(
          {
            success: false,
            error: "Рейс закрыт — заказ нельзя в него добавить",
            code: "route_closed",
          },
          { status: 409 },
        );
      }
    }

    // Заказ от постоянного клиента: карточка обязана принадлежать организации
    // вызывающего, условия оплаты наследуются из карточки, если не заданы в запросе.
    let client: {
      id: string;
      name: string;
      contactName: string | null;
      phone: string | null;
      paymentType: string | null;
      vatType: string | null;
      deferredDays: number | null;
    } | null = null;
    if (clientId) {
      client = await prisma.client.findFirst({
        where: scopedWhere(org.organizationId, { id: clientId }),
        select: {
          id: true,
          name: true,
          contactName: true,
          phone: true,
          paymentType: true,
          vatType: true,
          deferredDays: true,
        },
      });
      if (!client) {
        return NextResponse.json(
          { success: false, error: "Клиент не найден" },
          { status: 404 },
        );
      }
    }

    const order = await prisma.$transaction(async (tx: any) => {
      let finalRouteId = routeId;
      if (!finalRouteId && (assignedDriverId || assignedVehicleId)) {
        finalRouteId = `route_${Date.now()}`;
        await tx.route.create({
          data: {
            id: finalRouteId,
            organizationId: org.organizationId,
            name: `Рейс: ${routeFrom} — ${routeTo}`,
            status: "active",
            driverId: assignedDriverId || null,
            vehicleId: assignedVehicleId || null,
            totalDistance: distance || 0,
            totalCost: price || 0,
            cargoWeight: weight || 0,
          },
        });
      }

      const created = await tx.order.create({
        data: {
          organizationId: org.organizationId,
          source,
          sourceId,
          routeFrom,
          routeTo,
          distance: distance || 0,
          weight: weight || 0,
          volume,
          cargoType: cargoType || "Груз",
          price: price || 0,
          clientName: clientName || client?.name || null,
          clientContact:
            clientContact ||
            (client
              ? [client.contactName, client.phone].filter(Boolean).join(", ")
              : ""),
          clientId: client?.id ?? null,
          paymentType: paymentType || client?.paymentType || null,
          vatType: vatType || client?.vatType || null,
          deferredDays: deferredDays ?? client?.deferredDays ?? null,
          deadline: deadline
            ? new Date(deadline as any)
            : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          // Этап заказа определяется тем, что уже известно (канон — lib/orders/stages.ts):
          // назначен водитель → «Назначение», заказ в рейсе → «Маршрут»,
          // иначе заказ, заведённый вручную, начинается с «Согласования».
          status: assignedDriverId
            ? "assigned"
            : finalRouteId
              ? "in_route"
              : "negotiation",
          assignedDriverId,
          assignedVehicleId,
          routeId: finalRouteId,
          requirements: requirements || null,
          atiCacheId: atiCacheId || null,
          agreedPrice: agreedPrice ?? null,
          negotiationStatus: negotiationStatus ?? "new",
          nextFollowUpAt: nextFollowUpAt ?? null,
        },
      });

      if (assignedDriverId) {
        await tx.driver.updateMany({
          where: scopedWhere(org.organizationId, { id: assignedDriverId }),
          data: { status: "busy" },
        });
      }
      if (assignedVehicleId) {
        await tx.vehicle.updateMany({
          where: scopedWhere(org.organizationId, { id: assignedVehicleId }),
          data: { status: "in_use" },
        });
      }

      return created;
    });

    // Рейс адаптируется сразу: новый заказ меняет итоги и статус рейса.
    if (routeId) {
      await recalcRoute(prisma, routeId, org.organizationId).catch(() => {});
    }

    // Клиентская база (задача 5): если карточка этого клиента уже есть,
    // заказ сразу попадает в его историю. Нет карточки — не выдумываем её.
    if (clientName) {
      await linkOrderToClientByName({
        organizationId: org.organizationId,
        orderId: order.id,
        clientName,
      });
    }

    return NextResponse.json({ success: true, order });
  } catch (error: any) {
    console.error("[Orders API] POST Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}

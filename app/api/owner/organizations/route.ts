// app/api/owner/organizations/route.ts
//
// GET /api/owner/organizations?search=… — список ВСЕХ организаций платформы
// с укрупнёнными счётчиками. Только для владельца (PLATFORM_OWNER_EMAIL):
// сначала штатный гард requireStaff, затем персональная проверка.

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/auth/session";
import { ownerGuardResponse } from "@/lib/auth/owner";

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request);
  if (!auth.ok) return auth.response;
  const denied = ownerGuardResponse(auth.value);
  if (denied) return denied;

  const search = (request.nextUrl.searchParams.get("search") || "").trim();

  try {
    const organizations = await prisma.organization.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search } },
              { nameKey: { contains: search.toLowerCase() } },
            ],
          }
        : {},
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        _count: {
          select: { users: true, orders: true, routes: true, drivers: true },
        },
      },
    });

    return NextResponse.json({
      success: true,
      organizations: organizations.map(
        (org: {
          id: string;
          name: string;
          createdAt: Date;
          _count: {
            users: number;
            drivers: number;
            orders: number;
            routes: number;
          };
        }) => ({
          id: org.id,
          name: org.name,
          createdAt: org.createdAt,
          users: org._count.users,
          drivers: org._count.drivers,
          orders: org._count.orders,
          routes: org._count.routes,
        }),
      ),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Не удалось загрузить организации";
    console.error("[owner/organizations] GET error:", message);
    return NextResponse.json(
      { success: false, error: "Не удалось получить список организаций" },
      { status: 500 },
    );
  }
}

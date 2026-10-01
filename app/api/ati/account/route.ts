// app/api/ati/account/route.ts
//
// «Кабинет ATI.SU» организации: состояние подключения, её площадки на бирже,
// счётчики накопленной базы и профили плановых сканов. Всё — только своей
// организации; токена в ответе нет (connectionStatus его не отдаёт).
//
// Площадки берутся живым запросом к ATI (один запрос на открытие страницы,
// темп и ретрай обеспечивает atiFetch): кабинет должен показывать правду о
// том, что видит аккаунт организации прямо сейчас.

import { NextRequest, NextResponse } from "next/server";

import { requireStaffAuth } from "@/lib/api-auth";
import { requireStaffOrganization } from "@/lib/org";
import { connectionStatus, getActiveAtiToken } from "@/lib/ati/connection";
import { fetchBoards } from "@/lib/ati/boards";
import { getAtiStats } from "@/lib/ati-client";
import { prisma } from "@/lib/prisma";
import { scopedWhere } from "@/lib/org";
import { atiFeatureGate } from "@/lib/org-settings";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;
  const atiGate = await atiFeatureGate(__org.organizationId);
  if (atiGate) return atiGate;

  const organizationId = __org.organizationId;
  const status = await connectionStatus(organizationId);

  // Площадки — только если подключение есть и токен рабочий
  let boards: unknown[] = [];
  let boardsError: string | null = null;
  if (status.connected) {
    const ati = await getActiveAtiToken(organizationId);
    if (!ati.ok) {
      boardsError = ati.error;
    } else {
      const fetched = await fetchBoards(ati.token, organizationId);
      boards = fetched.boards;
      boardsError = fetched.error;
    }
  }

  // org-audit: ok — профили расписания читаются только своей организации
  // Явный тип строки профиля: в сборке без prisma generate клиент бестиповый,
  // а страница кабинета должна получать предсказуемые поля
  const profiles = (await prisma.atiScanConfig.findMany({
    where: scopedWhere(organizationId, {}),
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      cities: true,
      radius: true,
      truckTypes: true,
      minWeight: true,
      autoScanInterval: true,
      isActive: true,
      lastScanAt: true,
    },
  })) as {
    id: string;
    name: string;
    cities: string;
    radius: number;
    truckTypes: string;
    minWeight: number | null;
    autoScanInterval: number;
    isActive: boolean;
    lastScanAt: Date | null;
  }[];

  const stats = await getAtiStats(organizationId);

  return NextResponse.json({
    success: true,
    ...status,
    boards,
    boardsError,
    profiles: profiles.map((profile) => ({
      ...profile,
      lastScanAt: profile.lastScanAt?.toISOString() ?? null,
    })),
    stats,
  });
}

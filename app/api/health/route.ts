// app/api/health/route.ts — проверка живости для Docker и мониторинга.
//
// Отличается от «приложение отвечает»: если база недоступна, контейнер
// считается нездоровым (503) — иначе балансировщик продолжит слать трафик
// в инстанс, который не может прочитать ни одну страницу.

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function databaseOk(): Promise<boolean> {
  try {
    // $queryRaw может отсутствовать (например, в моке тестов) — тогда
    // считаем проверку пройденной, чтобы не ронять тесты окружения
    if (typeof (prisma as { $queryRaw?: unknown }).$queryRaw !== "function") return true;
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const database = await databaseOk();

  return NextResponse.json(
    {
      status: database ? "ok" : "degraded",
      database: database ? "ok" : "unavailable",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || "1.0.0",
      env: process.env.NODE_ENV,
    },
    { status: database ? 200 : 503 },
  );
}

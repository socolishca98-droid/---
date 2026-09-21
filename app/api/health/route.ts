/**
 * GET /api/health — публичная проверка доступности сервиса.
 *
 * Не раскрывает данных: только статус, имя продукта и время.
 * Удобно для мониторинга и для быстрой диагностики «сервер жив?»
 * без авторизации.
 */

import { NextResponse } from "next/server"
import { PRODUCT_NAME } from "@/lib/auth/constants"

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({
    success: true,
    status: "ok",
    product: PRODUCT_NAME,
    time: new Date().toISOString(),
  })
}

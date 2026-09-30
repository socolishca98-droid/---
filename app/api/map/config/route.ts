// app/api/map/config/route.ts
//
// Ключ подложки CARTO для клиента. NEXT_PUBLIC_* переменные запекаются в
// бандл на старте dev-сервера: если ключ добавили в .env позже (или назвали
// без NEXT_PUBLIC_), карта оставалась без ключа и CARTO рисовал водяные
// знаки «API KEY REQUIRED». Этот маршрут отдаёт ключ из process.env сервера
// в рантайме — .env читается целиком, имя переменной может быть любым из
// трёх поддержанных.
//
// Секрета здесь нет: ключ всё равно виден в URL каждого тайла в браузере.

import { NextRequest, NextResponse } from "next/server"

import { requireStaff } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

// org-audit: manual — маршрут отдаёт только ключ подложки CARTO из process.env
// (в браузере он и так виден в URL каждого тайла); бизнес-данных и запросов к
// базе нет. Guard нужен, чтобы ключ не отдавался анонимам.
export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  const cartoKey =
    process.env.NEXT_PUBLIC_CARTO_API_KEY ||
    process.env.CARTO_API_KEY ||
    process.env.CARTO_KEY ||
    ""
  return NextResponse.json({ cartoKey })
}

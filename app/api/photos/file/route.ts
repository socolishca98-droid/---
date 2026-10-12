// app/api/photos/file/route.ts
//
// Отдаёт файл фотографии ПОСЛЕ проверки доступа.
//
// Зачем: фото лежат в хранилище (public/uploads либо S3-совместимое —
// см. lib/storage.ts), и если отдавать их напрямую, ссылку на снимок ТТН
// достаточно переслать в мессенджере, и её откроет кто угодно. Поэтому
// обращения к /uploads/** переписываются на этот роут (proxy.ts), который
// проверяет, что человек вошёл и что фото принадлежит его организации.
// Файл читается через lib/storage — роут не знает, где физически лежит фото.
//
// Путь берётся из query-параметра path в том же виде, в каком он хранится в
// Photo.url: /uploads/<организация>/<дата>/<имя файла>.

import { NextRequest, NextResponse } from "next/server"

import { requireAnySession } from "@/lib/auth/session"
import {
  contentTypeForFileName,
  normalizeStorageKey,
  organizationFromStorageKey,
  readPhoto,
} from "@/lib/storage"

export async function GET(request: NextRequest) {
  const auth = await requireAnySession(request)
  if (!auth.ok) return auth.response

  const organizationId =
    auth.value.kind === "driver"
      ? auth.value.driver.organizationId
      : auth.value.user.organizationId

  if (!organizationId) {
    return NextResponse.json(
      { success: false, error: "Организация не определена — фото недоступны" },
      { status: 403 },
    )
  }

  // Путь фото приходит двумя путями, и оба нужно поддержать:
  //   * прямой вызов роута с ?path=/uploads/... (так его зовут тесты и API);
  //   * обращение к /uploads/**, которое proxy переписывает на этот роут.
  // Во втором случае query рерайта до обработчика не доходит — роут видит
  // исходный адрес, поэтому путь берём из pathname.
  const requested =
    request.nextUrl.searchParams.get("path") ?? request.nextUrl.pathname ?? ""

  // Попытка выйти за пределы каталога загрузок («../..», обратные слэши) —
  // это не «фото не нашлось», а заведомо недопустимый путь.
  if (requested.includes("..") || requested.includes("\\")) {
    return NextResponse.json({ success: false, error: "Недопустимый путь" }, { status: 400 })
  }

  const key = normalizeStorageKey(requested)

  // /uploads/<организация>/<дата>/<имя> — организация, дата и имя файла.
  if (!key || key.split("/").length !== 3) {
    return NextResponse.json({ success: false, error: "Фото не найдено" }, { status: 404 })
  }

  if (organizationFromStorageKey(key) !== organizationId) {
    // Не раскрываем, существует ли файл: чужая организация — просто «нет доступа»
    return NextResponse.json(
      { success: false, error: "Фото принадлежит другой организации" },
      { status: 403 },
    )
  }

  const bytes = await readPhoto(key)
  if (!bytes) {
    return NextResponse.json({ success: false, error: "Фото не найдено" }, { status: 404 })
  }

  const fileName = key.split("/").pop() as string

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": contentTypeForFileName(fileName),
      // Кэш только свой (private): ссылку нельзя передать и открыть без входа
      "cache-control": "private, max-age=300, must-revalidate",
      "x-content-type-options": "nosniff",
      "content-length": String(bytes.length),
    },
  })
}

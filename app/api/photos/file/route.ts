// app/api/photos/file/route.ts
//
// Отдаёт файл фотографии ПОСЛЕ проверки доступа.
//
// Зачем: обращения к /uploads/** переписываются на этот роут (proxy.ts),
// который проверяет, что человек вошёл и что фото принадлежит его организации.
// Сами файлы лежат в data/uploads — вне public: даже если запрос минует прокси
// (внешний статик-сервер, регистр символов, дрейф конфига), фото не отдастся
// без сессии — в публичном каталоге его физически нет. Legacy-файлы старых
// установок дочитываются из public/uploads.
//
// Путь берётся из query-параметра path в том же виде, в каком он хранится в
// Photo.url: /uploads/<организация>/<дата>/<имя файла>.

import { NextRequest, NextResponse } from "next/server"

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { requireAnySession } from "@/lib/auth/session"

const UPLOADS_ROOT = path.join(process.cwd(), "data", "uploads")
/** Хранилище до переноса файлов из public: старые фото дочитываются оттуда. */
const LEGACY_UPLOADS_ROOT = path.join(process.cwd(), "public", "uploads")

/** Расширения, которые реально приходят с телефона водителя и из сканера. */
const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".pdf": "application/pdf",
}

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

  const requested = request.nextUrl.searchParams.get("path") ?? ""
  const segments = requested.split("/").filter(Boolean)

  // /uploads/<организация>/<дата>/<имя>
  if (segments[0] !== "uploads" || segments.length < 4) {
    return NextResponse.json({ success: false, error: "Фото не найдено" }, { status: 404 })
  }

  const [, photoOrganizationId, ...rest] = segments as [string, string, ...string[]]

  if (photoOrganizationId !== organizationId) {
    // Не раскрываем, существует ли файл: чужая организация — просто «нет доступа»
    return NextResponse.json(
      { success: false, error: "Фото принадлежит другой организации" },
      { status: 403 },
    )
  }

  // Каталог организации — часть пути на диске: <хранилище>/<организация>/<дата>/<имя>.
  // Берём уже сверенный с сессией сегмент, а не сырую строку из запроса.
  // Основное хранилище — data/uploads, legacy — public/uploads: containment
  // проверяется для обоих корней.
  const candidates: string[] = []
  for (const root of [UPLOADS_ROOT, LEGACY_UPLOADS_ROOT]) {
    const resolvedRoot = path.resolve(root)
    const absolute = path.resolve(path.join(resolvedRoot, photoOrganizationId, ...rest))
    if (absolute !== resolvedRoot && !absolute.startsWith(resolvedRoot + path.sep)) {
      return NextResponse.json({ success: false, error: "Недопустимый путь" }, { status: 400 })
    }
    candidates.push(absolute)
  }

  const absolute = candidates.find((candidate) => existsSync(candidate))
  if (!absolute) {
    return NextResponse.json({ success: false, error: "Фото не найдено" }, { status: 404 })
  }

  const extension = path.extname(absolute).toLowerCase()
  const bytes = readFileSync(absolute)

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": CONTENT_TYPES[extension] ?? "application/octet-stream",
      // Кэш только свой (private): ссылку нельзя передать и открыть без входа
      "cache-control": "private, max-age=300, must-revalidate",
      "x-content-type-options": "nosniff",
      "content-length": String(bytes.length),
    },
  })
}

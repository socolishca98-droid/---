// app/api/ati/import/route.ts
//
// Совместимый вход для прежних клиентов: «импорт груза» больше не помечает общую
// базу ATI (иначе груз исчезал у других организаций), а берёт груз в работу —
// создаёт заказ своей организации на этапе «Поиск».
//
// Канонический эндпоинт — POST /api/orders/from-cache; этот роут просто вызывает
// его, чтобы не держать две копии одной логики.

import { NextRequest } from "next/server"

import { requireStaff } from "@/lib/auth/session"
import { requireOrganization } from "@/lib/org"
import { POST as takeFromCache } from "@/app/api/orders/from-cache/route"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  // Доступ проверяется и здесь, и в основном роуте: старый адрес не должен
  // становиться лазейкой в обход сессии.
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  return takeFromCache(request)
}

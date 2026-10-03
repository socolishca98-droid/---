// app/api/orders/[id]/documents/route.ts
//
// GET /api/orders/[id]/documents?types=ttn,act,invoice
//
// Документы одного заказа для печати из карточки заказа: транспортная
// накладная, акт оказанных услуг и счёт на оплату. Виды выбираются в
// интерфейсе и приходят в `types`; без параметра отдаётся полный комплект.
//
// Заказ ищется в границах организации из сессии: чужой заказ — 404,
// документы по нему не собираются. Реквизиты перевозчика — из настроек ЭТОЙ
// организации, чужие данные в бланк попасть не могут.

import { NextRequest, NextResponse } from "next/server";

import { requireStaffAuth } from "@/lib/api-auth";
import { requireStaffOrganization } from "@/lib/org";
import { loadOrderDocuments } from "@/lib/documents/load";
import {
  ORDER_DOCUMENT_KINDS,
  parseOrderDocumentKinds,
} from "@/lib/documents/types";

export const dynamic = "force-dynamic";

type OrderParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: OrderParams) {
  const auth = await requireStaffAuth(request);
  if (auth.error) return auth.error;

  const org = requireStaffOrganization(auth.user);
  if (!org.ok) return org.response;

  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { success: false, error: "Не указан заказ" },
        { status: 400 },
      );
    }

    const raw = request.nextUrl.searchParams.get("types");

    // Явно переданный неизвестный вид — ошибка, а не молчаливый полный комплект
    if (raw) {
      const requested = raw
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
      const unknown = requested.filter(
        (item) => !(ORDER_DOCUMENT_KINDS as readonly string[]).includes(item),
      );
      if (unknown.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: `Неизвестные виды документов: ${unknown.join(", ")}`,
            allowed: [...ORDER_DOCUMENT_KINDS],
          },
          { status: 400 },
        );
      }
    }

    const kinds = parseOrderDocumentKinds(raw);

    const result = await loadOrderDocuments({
      organizationId: org.organizationId,
      orderId: id,
      kinds,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: "Заказ не найден" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      order: result.order,
      kinds,
      documents: result.documents,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Не удалось собрать документы";
    console.error("[Order Documents] GET error:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

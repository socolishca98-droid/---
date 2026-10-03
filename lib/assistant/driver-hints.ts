// lib/assistant/driver-hints.ts — помощник водителя.
//
// Один вопрос водителя на рейсе: «что делать дальше?». Правила маппят статус
// заказа (канон lib/orders/stages.ts + легас) на короткую подсказку следующего
// шага. Подсказки показывает экран «Мои заказы» в контуре /m и страница фото.

import { normalizeOrderStatus } from "@/lib/orders/stages";

/** Подсказка следующего шага по статусу заказа. null — подсказка не нужна. */
export function nextStepForStatus(
  rawStatus: string | null | undefined,
): string | null {
  if (!rawStatus) return null;
  const status = normalizeOrderStatus(rawStatus);

  switch (status) {
    case "assigned":
      return "Машина и рейс назначены — выезжайте на погрузку и начните рейс отметкой «Начал».";
    case "in_route":
      return "Рейс начат — держите статус свежим: прибытие, погрузка, выезд отмечайте сразу.";
    case "documents":
      return "Документы на оформлении — проверьте накладную и путевой лист перед выездом.";
    case "control":
      return "Вы на маршруте. На выгрузке сфотографируйте накладную и отметьте доставку.";
    case "delivered":
      return null;
    case "search":
    case "negotiation":
    case "agreed":
      return "Заказ ещё согласуется логистом — ждите подтверждения рейса.";
    case "cancelled":
    case "rejected":
      return "Заказ отменён — уточните детали у логиста в чате.";
    default:
      return null;
  }
}

/** Статусы, на которых фото накладной означает «почти доставлено». */
export function isDeliveryStage(rawStatus: string | null | undefined): boolean {
  if (!rawStatus) return false;
  const status = normalizeOrderStatus(rawStatus);
  return status === "control" || status === "in_route";
}

/** Подсказка после загрузки фото на финальной стадии. */
export function photoUploadHint(
  rawStatus: string | null | undefined,
): string | null {
  if (!isDeliveryStage(rawStatus)) return null;
  return "Фото прикреплено. Если выгрузка завершена — отметьте заказ доставленным в «Моих заказах», логист увидит это сразу.";
}

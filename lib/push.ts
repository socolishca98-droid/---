// lib/push.ts — веб-пуш уведомления (VAPID, web-push).
//
// Push доходит до телефона даже из закрытого приложения — service worker
// (public/sw.js) показывает системное уведомление. Ключи VAPID задаются в
// .env один раз (npx web-push generate-vapid-keys); без ключей пуш тихо
// выключен — приложение работает как раньше, ничего не ломается.
//
// Подписки хранятся в PushSubscription (endpoint уникален). Мёртвые подписки
// (404/410 от пуш-сервиса) удаляются автоматически.

import webpush from "web-push";

import { prisma } from "@/lib/prisma";

export interface PushPayload {
  title: string;
  body?: string;
  /** Куда вести по тапу на уведомление (относительный путь). */
  url?: string;
  /** Группировка: новое уведомление с тем же tag заменяет прежнее. */
  tag?: string;
  icon?: string;
}

let vapidReady = false;

/** Настроен ли пуш (ключи VAPID в окружении). */
export function pushConfigured(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT?.trim() || "mailto:admin@loginex.local",
      publicKey,
      privateKey,
    );
    vapidReady = true;
  }
  return true;
}

/** Публичный ключ для браузерного pushManager.subscribe (или null). */
export function vapidPublicKey(): string | null {
  return pushConfigured()
    ? (process.env.VAPID_PUBLIC_KEY?.trim() ?? null)
    : null;
}

/** Отправить пуш одному пользователю (все его устройства). */
export async function pushToUser(
  userId: string,
  payload: PushPayload,
): Promise<void> {
  if (!pushConfigured()) return;
  const subs = await prisma.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  await sendToAll(
    subs as Array<{
      id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>,
    payload,
  );
}

/** Отправить пуш всем сотрудникам организации (admin/logist). */
export async function pushToOrgStaff(
  organizationId: string,
  payload: PushPayload,
  exceptUserId?: string,
): Promise<void> {
  if (!pushConfigured() || !organizationId) return;
  const staffIds = await prisma.user.findMany({
    where: {
      organizationId,
      role: { in: ["admin", "logist"] },
      isActive: true,
      ...(exceptUserId ? { id: { not: exceptUserId } } : {}),
    },
    select: { id: true },
  });
  if (staffIds.length === 0) return;
  const subs = await prisma.pushSubscription.findMany({
    where: { userId: { in: staffIds.map((row: any) => row.id) } },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  await sendToAll(
    subs as Array<{
      id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>,
    payload,
  );
}

/** Отправить пуш всем водителям организации. */
export async function pushToOrgDrivers(
  organizationId: string,
  payload: PushPayload,
): Promise<void> {
  if (!pushConfigured() || !organizationId) return;
  const driverIds = await prisma.user.findMany({
    where: { organizationId, role: "driver", isActive: true },
    select: { id: true },
  });
  if (driverIds.length === 0) return;
  const subs = await prisma.pushSubscription.findMany({
    where: { userId: { in: driverIds.map((row: any) => row.id) } },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  await sendToAll(
    subs as Array<{
      id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>,
    payload,
  );
}

async function sendToAll(
  subs: Array<{ id: string; endpoint: string; p256dh: string; auth: string }>,
  payload: PushPayload,
): Promise<void> {
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload),
        );
      } catch (error: any) {
        // 404/410 — подписка мертва (сменили браузер/отозвали разрешение)
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await prisma.pushSubscription
            .deleteMany({ where: { id: sub.id } })
            .catch(() => {});
        }
      }
    }),
  );
}

/** Неблокирующая отправка: пуш не имеет права ронять основной запрос. */
export function firePush(promise: Promise<void>): void {
  promise.catch((error) => {
    console.error(
      "[push] send failed:",
      error instanceof Error ? error.message : error,
    );
  });
}

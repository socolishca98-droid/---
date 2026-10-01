/**
 * lib/auth/owner.ts — режим владельца платформы.
 *
 * Владелец — ОДИН конкретный сотрудник, чей email задан в .env
 * (PLATFORM_OWNER_EMAIL). Только он видит список всех организаций и может
 * войти в любую из них (выпускается настоящая сессия сотрудника этой
 * организации). Каждый вход и выход пишется в журнал аудита организации,
 * поэтому действия владельца никогда не бывают невидимыми.
 *
 * Без PLATFORM_OWNER_EMAIL режим выключен для всех, включая админов.
 */

import { NextResponse } from "next/server";

import { forbidden, type StaffSession } from "@/lib/auth/session";

/** Email владельца из окружения (нормализованный) или null. */
export function platformOwnerEmail(): string | null {
  const raw = process.env.PLATFORM_OWNER_EMAIL;
  const email = raw?.trim().toLowerCase();
  return email ? email : null;
}

/** Является ли текущая сессия владельца платформы. */
export function isPlatformOwner(session: StaffSession): boolean {
  const owner = platformOwnerEmail();
  if (!owner) return false;
  return (session.user.email || "").trim().toLowerCase() === owner;
}

/**
 * Проверка для owner-роутов: null — пропускаем, иначе готовый ответ 403.
 * Вызывается ПОСЛЕ requireStaff, чтобы роут оставался под штатным гардом.
 */
export function ownerGuardResponse(session: StaffSession): NextResponse | null {
  if (isPlatformOwner(session)) return null;
  return forbidden("Раздел доступен только владельцу платформы");
}

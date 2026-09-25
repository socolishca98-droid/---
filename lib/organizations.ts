// lib/organizations.ts — операции с организациями.
//
// Организация — граница видимости всех бизнес-данных. Здесь живут:
//   * приведение и проверка названия (nameKey нужен для уникальности без учёта
//     регистра: SQLite не поддерживает mode: "insensitive" в Prisma);
//   * создание организации вместе с базовыми настройками автопарка;
//   * чтение состава организации (сотрудники, заявки, водители).
//
// Принадлежность данных организации определяется в lib/org.ts из сессии.

import { prisma } from "@/lib/prisma"

export const MIN_ORGANIZATION_NAME = 2
export const MAX_ORGANIZATION_NAME = 120

/** «  ООО   Ромашка » → «ооо ромашка» */
export function normalizeOrganizationName(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
}

export type OrganizationNameCheck =
  | { ok: true; name: string; nameKey: string }
  | { ok: false; error: string }

/** Проверка названия организации: длина + приведение. */
export function checkOrganizationName(raw: unknown): OrganizationNameCheck {
  const name = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
  const nameKey = normalizeOrganizationName(name)

  if (nameKey.length < MIN_ORGANIZATION_NAME) {
    return {
      ok: false,
      error: `Название организации: не короче ${MIN_ORGANIZATION_NAME} символов`,
    }
  }
  if (name.length > MAX_ORGANIZATION_NAME) {
    return {
      ok: false,
      error: `Название организации: не длиннее ${MAX_ORGANIZATION_NAME} символов`,
    }
  }
  return { ok: true, name, nameKey }
}

export interface CreateOrganizationInput {
  name: string
  nameKey?: string
}

/**
 * Создание организации + её базовых настроек автопарка.
 * Настройки создаются сразу: экран автопарка читает их по организации,
 * а без записи пришлось бы показывать пустоту.
 */
export async function createOrganization(input: CreateOrganizationInput) {
  const nameKey = input.nameKey ?? normalizeOrganizationName(input.name)

  const organization = await prisma.organization.create({
    data: { name: input.name, nameKey },
    select: { id: true, name: true, nameKey: true, createdAt: true },
  })

  await prisma.fleetSettings.create({
    data: { organizationId: organization.id, parkName: organization.name },
  })

  return organization
}

/** Организация по id (с проверкой, что id — из сессии вызывающего). */
export async function getOrganization(id: string) {
  return prisma.organization.findUnique({
    where: { id },
    select: { id: true, name: true, createdAt: true },
  })
}

/** Состав организации: сотрудники, заявки, водители, машины. */
export async function getOrganizationSummary(organizationId: string) {
  const [members, pending, drivers, vehicles] = await Promise.all([
    prisma.user.count({
      where: { organizationId, status: "active", role: { in: ["admin", "logist"] } },
    }),
    prisma.user.count({ where: { organizationId, status: "pending" } }),
    prisma.driver.count({ where: { organizationId } }),
    prisma.vehicle.count({ where: { organizationId } }),
  ])

  return { members, pending, drivers, vehicles }
}

/** Заявки на присоединение к организации (статус pending). */
export async function listPendingApplications(organizationId: string) {
  return prisma.user.findMany({
    where: { organizationId, status: "pending" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      inviteCode: { select: { id: true, code: true, role: true, createdById: true } },
    },
  })
}

/** Сотрудники организации (активные и заблокированные). */
export async function listMembers(organizationId: string) {
  return prisma.user.findMany({
    where: { organizationId, status: { in: ["active", "suspended"] } },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      driverId: true,
      createdAt: true,
      lastLoginAt: true,
      suspendedAt: true,
      suspendReason: true,
    },
  })
}

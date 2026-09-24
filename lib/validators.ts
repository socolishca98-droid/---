// lib/validators.ts - Zod validation schemas (P1-6)
import { z } from "zod"
import {
  LEGACY_ORDER_STATUS_MAP,
  NEGOTIATION_STATUSES,
  ORDER_STATUSES,
  normalizeOrderStatus,
} from "@/lib/orders/stages"

/** Допустимые значения статуса заказа: канон + прежние (для обратной совместимости). */
const ORDER_STATUS_VALUES = [...ORDER_STATUSES] as [string, ...string[]]
const LEGACY_ORDER_STATUS_VALUES = Object.keys(LEGACY_ORDER_STATUS_MAP).filter(
  (value) => !(ORDER_STATUSES as readonly string[]).includes(value),
) as [string, ...string[]]
const NEGOTIATION_STATUS_VALUES = [...NEGOTIATION_STATUSES] as [string, ...string[]]

// -------------------- Helpers --------------------
export function formatZodError(error: z.ZodError) {
  return {
    message: "Validation failed",
    issues: error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
      code: i.code,
    })),
  }
}

export function zodErrorResponse(error: z.ZodError) {
  return {
    success: false,
    error: "Validation failed",
    details: formatZodError(error),
  }
}

// -------------------- Auth --------------------
export const loginSchema = z.object({
  email: z.string().min(1, "Email required").email("Invalid email").max(254).trim().toLowerCase(),
  password: z.string().min(1, "Password required").max(128),
})

/**
 * Регистрация сотрудника. Ровно один из двух сценариев:
 *   organizationName — создать свою организацию и стать её администратором;
 *   inviteCode       — присоединиться к существующей организации.
 * Организация и роль НИКОГДА не берутся из тела запроса напрямую:
 * при присоединении их источником является код приглашения.
 */
export const registerSchema = z
  .object({
    name: z
      .string({ required_error: "Укажите имя и фамилию" })
      .trim()
      .min(2, "Укажите имя и фамилию (от 2 до 80 символов)")
      .max(80, "Укажите имя и фамилию (от 2 до 80 символов)"),
    email: z
      .string({ required_error: "Укажите email" })
      .trim()
      .toLowerCase()
      .min(1, "Укажите email")
      .max(254, "Email слишком длинный")
      .email("Некорректный email"),
    password: z
      .string({ required_error: "Укажите пароль" })
      .min(8, "Пароль: не короче 8 символов")
      .max(128, "Пароль: не длиннее 128 символов"),
    // Название приводим к каноническому виду (один пробел, без краёв) —
    // так же, как lib/organizations.normalizeOrganizationName
    organizationName: z
      .string()
      .max(120, "Название организации: не длиннее 120 символов")
      .transform((value) => value.replace(/\s+/g, " ").trim())
      .optional()
      .or(z.literal("")),
    inviteCode: z
      .string()
      .trim()
      .max(20, "Код приглашения слишком длинный")
      .optional()
      .or(z.literal("")),
  })
  .superRefine((value, ctx) => {
    const hasOrganization = (value.organizationName ?? "").trim().length > 0
    const hasInvite = (value.inviteCode ?? "").trim().length > 0

    if (hasOrganization && hasInvite) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["organizationName"],
        message: "Выберите один сценарий: создать свою организацию или присоединиться по коду",
      })
    }
    if (!hasOrganization && !hasInvite) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inviteCode"],
        message: "Укажите название своей организации или код приглашения от администратора",
      })
    }
  })

export type RegisterInput = z.infer<typeof registerSchema>

/**
 * Вход водителя в мобильное приложение: телефон + пароль.
 * Организация не передаётся — она берётся из карточки водителя на сервере.
 */
export const driverLoginSchema = z.object({
  phone: z
    .string({ required_error: "Укажите телефон" })
    .trim()
    .min(5, "Укажите телефон")
    .max(30, "Телефон слишком длинный"),
  password: z
    .string({ required_error: "Укажите пароль" })
    .min(1, "Укажите пароль")
    .max(128, "Пароль слишком длинный"),
})

// -------------------- Drivers --------------------
export const createDriverSchema = z.object({
  name: z.string().trim().min(1, "Name required").max(100),
  phone: z.string().trim().min(10, "Phone min 10").max(30),
  vehicleId: z.string().cuid().optional().or(z.literal("")).or(z.null()),
  vehicleType: z.string().trim().max(50).optional().or(z.literal("")),
  vehiclePlate: z.string().trim().max(20).optional().or(z.literal("")),
  licenseNumber: z.string().trim().max(50).optional().or(z.literal("")).or(z.null()),
  licenseExpiry: z.string().or(z.date()).optional().or(z.null()),
  medicalExpiry: z.string().or(z.date()).optional().or(z.null()),
  status: z.enum(["available", "busy", "maintenance", "offline"]).optional(),
})

export const updateDriverSchema = createDriverSchema.partial().extend({
  id: z.string().optional(),
})

export const driverLocationSchema = z.object({
  driverId: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().max(500).optional(),
  speed: z.number().min(0).optional(),
  heading: z.number().min(0).max(360).optional(),
})

// -------------------- Vehicles --------------------
export const createVehicleSchema = z.object({
  plate: z.string().trim().min(1, "Plate required").max(20),
  type: z.string().trim().min(1, "Type required").max(50),
  brand: z.string().trim().max(50).optional().or(z.literal("")).or(z.null()),
  model: z.string().trim().max(50).optional().or(z.literal("")).or(z.null()),
  year: z.union([z.string(), z.number()]).optional().transform((v) => {
    if (v === undefined || v === "") return undefined
    const n = typeof v === "string" ? parseInt(v, 10) : v
    return isNaN(n) ? undefined : n
  }).pipe(z.number().int().min(1900).max(2100).optional().or(z.undefined())),
  capacity: z.union([z.string(), z.number()]).transform((v) => {
    if (typeof v === "string") return parseInt(v, 10)
    return v
  }).pipe(z.number().int().min(1, "Capacity min 1").max(100000)),
  volume: z.union([z.string(), z.number(), z.null(), z.undefined()]).optional().transform((v) => {
    if (v === null || v === undefined || v === "") return undefined
    const n = typeof v === "string" ? parseFloat(v) : v
    return isNaN(n as number) ? undefined : (n as number)
  }).pipe(z.number().min(0).optional().or(z.undefined())),
  length: z.union([z.string(), z.number(), z.null(), z.undefined()]).optional().transform((v) => {
    if (v === null || v === undefined || v === "") return undefined
    const n = typeof v === "string" ? parseFloat(v) : v
    return isNaN(n as number) ? undefined : (n as number)
  }).pipe(z.number().min(0).optional().or(z.undefined())),
  width: z.union([z.string(), z.number(), z.null(), z.undefined()]).optional().transform((v) => {
    if (v === null || v === undefined || v === "") return undefined
    const n = typeof v === "string" ? parseFloat(v) : v
    return isNaN(n as number) ? undefined : (n as number)
  }).pipe(z.number().min(0).optional().or(z.undefined())),
  height: z.union([z.string(), z.number(), z.null(), z.undefined()]).optional().transform((v) => {
    if (v === null || v === undefined || v === "") return undefined
    const n = typeof v === "string" ? parseFloat(v) : v
    return isNaN(n as number) ? undefined : (n as number)
  }).pipe(z.number().min(0).optional().or(z.undefined())),
  features: z.union([z.array(z.string()), z.string()]).optional(),
  status: z.enum(["available", "in_use", "maintenance"]).optional(),
})

export const updateVehicleSchema = createVehicleSchema.partial()

// -------------------- Orders --------------------
export const createOrderSchema = z.object({
  source: z.string().max(50).optional().default("manual"),
  sourceId: z.string().max(100).optional().or(z.null()),
  routeFrom: z.string().trim().min(1, "routeFrom required").max(200),
  routeTo: z.string().trim().min(1, "routeTo required").max(200),
  distance: z.union([z.string(), z.number()]).optional().transform((v) => {
    if (v === undefined) return 0
    const n = typeof v === "string" ? parseInt(v, 10) : v
    return isNaN(n as number) ? 0 : (n as number)
  }).pipe(z.number().int().min(0).max(100000).optional()),
  weight: z.union([z.string(), z.number()]).optional().transform((v) => {
    if (v === undefined) return 0
    const n = typeof v === "string" ? parseInt(v, 10) : v
    return isNaN(n as number) ? 0 : (n as number)
  }).pipe(z.number().int().min(0).max(1000000).optional()),
  volume: z.union([z.string(), z.number(), z.null()]).optional().transform((v) => {
    if (v === null || v === undefined || v === "") return undefined
    const n = typeof v === "string" ? parseFloat(v) : v
    return isNaN(n as number) ? undefined : (n as number)
  }).pipe(z.number().min(0).optional().or(z.undefined())),
  cargoType: z.string().trim().max(100).optional().default("Груз"),
  price: z.union([z.string(), z.number(), z.null()]).optional().transform((v) => {
    if (v === null || v === undefined || v === "") return 0
    const n = typeof v === "string" ? parseInt(v, 10) : v
    return isNaN(n as number) ? 0 : (n as number)
  }).pipe(z.number().int().min(0).optional()),
  clientName: z.string().trim().max(100).optional().or(z.literal("")).or(z.null()),
  clientContact: z.string().trim().max(200).optional().default(""),
  deadline: z.string().or(z.date()).optional(),
  assignedDriverId: z.string().cuid().optional().or(z.literal("")).or(z.null()),
  assignedVehicleId: z.string().cuid().optional().or(z.literal("")).or(z.null()),
  routeId: z.string().max(100).optional().or(z.literal("")).or(z.null()),
  /** Особые требования к грузу/погрузке (текст из заявки). */
  requirements: z.string().trim().max(2000).optional().or(z.literal("")).or(z.null()),
  /** Ид строки накопленной базы ATI, из которой взят заказ (связь с общей базой). */
  atiCacheId: z.string().max(100).optional().or(z.literal("")).or(z.null()),
  /** Цена, о которой договорились с клиентом (итог согласования). */
  agreedPrice: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((v) => {
      if (v === null || v === undefined || v === "") return null
      const n = typeof v === "string" ? parseInt(v, 10) : v
      return isNaN(n as number) ? null : (n as number)
    })
    .pipe(z.number().int().min(0).nullable().optional()),
  negotiationStatus: z.enum(NEGOTIATION_STATUS_VALUES).optional(),
  nextFollowUpAt: z
    .string()
    .or(z.date())
    .optional()
    .or(z.null())
    .transform((v) => (v ? new Date(v as string | Date) : null)),
})

export const updateOrderSchema = createOrderSchema.partial().extend({
  /**
   * Статус заказа — канон из lib/orders/stages.ts. Прежние значения
   * («new», «processing», «confirmed», «in_transit», «loading», «unloading», …)
   * принимаются и сразу приводятся к канону, поэтому старые клиенты не ломаются.
   */
  status: z
    .enum([...ORDER_STATUS_VALUES, ...LEGACY_ORDER_STATUS_VALUES])
    .transform((value) => normalizeOrderStatus(value))
    .optional(),
})

// -------------------- Admin --------------------
export const adminUserActionSchema = z.object({
  userId: z.string().min(1, "userId required"),
  action: z.enum(["approve", "deactivate", "activate", "change_role"]),
  role: z.enum(["admin", "logist"]).optional(),
})

// -------------------- Fleet --------------------
export const fleetAssignSchema = z.object({
  vehicleId: z.string().min(1),
  driverId: z.string().min(1).optional().or(z.literal("")).or(z.null()),
  orderIds: z.array(z.string()).optional(),
})

export const fleetSettingsSchema = z.object({
  parkName: z.string().trim().min(1).max(100).optional(),
  baseAddress: z.string().trim().max(500).optional().or(z.null()),
  baseLat: z.number().min(-90).max(90).optional().or(z.null()),
  baseLng: z.number().min(-180).max(180).optional().or(z.null()),
})

// -------------------- Routes --------------------
export const createRouteSchema = z.object({
  name: z.string().trim().max(200).optional(),
  driverId: z.string().cuid().optional().or(z.null()),
  vehicleId: z.string().cuid().optional().or(z.null()),
  totalDistance: z.number().int().min(0).optional(),
  totalCost: z.number().int().min(0).optional(),
  cargoWeight: z.number().int().min(0).optional(),
  notes: z.string().max(1000).optional(),
  /** Существующие заказы организации, которые включаются в рейс (обычно согласованные). */
  orderIds: z.array(z.string().min(1)).max(50).optional(),
  orders: z.array(z.object({
    routeFrom: z.string().min(1),
    routeTo: z.string().min(1),
    distance: z.number().optional(),
    weight: z.number().optional(),
    price: z.number().optional(),
    cargo: z.string().optional(),
    clientCompany: z.string().optional(),
    clientPhone: z.string().optional(),
    groupId: z.string().optional().or(z.null()),
    atiCacheId: z.string().optional().or(z.null()),
  })).optional(),
})

export const addLoadSchema = z.object({
  atiCacheId: z.string().optional(),
  routeFrom: z.string().optional(),
  routeTo: z.string().optional(),
  distance: z.number().optional(),
  weight: z.number().optional(),
  price: z.number().optional(),
  cargo: z.string().optional(),
})

export const completeRouteSchema = z.object({
  fuelExpense: z.number().min(0).optional(),
  notes: z.string().max(1000).optional(),
})

// -------------------- Chat --------------------
export const chatMessageSchema = z.object({
  content: z.string().trim().min(1, "Content required").max(2000),
  recipientId: z.string().optional().or(z.null()),
  type: z.enum(["text", "system", "important"]).optional().default("text"),
  isImportant: z.boolean().optional(),
})

// -------------------- Payments --------------------
export const createPaymentSchema = z.object({
  orderId: z.string().min(1).optional(),
  amount: z.number().min(0),
  type: z.string().max(50).optional(),
  method: z.string().max(50).optional(),
  status: z.enum(["pending", "paid", "failed", "cancelled"]).optional(),
  dueDate: z.string().or(z.date()).optional(),
})

// -------------------- Photos --------------------
export const photoUploadSchema = z.object({
  driverId: z.string().min(1),
  orderId: z.string().optional().or(z.null()),
  type: z.string().min(1).max(50),
  description: z.string().max(500).optional(),
})

// -------------------- Mobile --------------------
export const driverShiftSchema = z.object({
  driverId: z.string().min(1),
  status: z.enum(["driving", "resting", "loading", "waiting", "offline"]).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
})

export const sosSchema = z.object({
  driverId: z.string().min(1),
  orderId: z.string().optional().or(z.null()),
  type: z.string().min(1).max(50),
  message: z.string().max(1000).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().max(500).optional(),
})

export const maintenanceSchema = z.object({
  vehicleId: z.string().min(1),
  driverId: z.string().optional().or(z.null()),
  type: z.string().min(1).max(50),
  description: z.string().trim().min(1).max(1000),
  mileage: z.number().int().min(0).optional(),
  cost: z.number().int().min(0).optional(),
  performer: z.enum(["driver", "service"]).optional(),
  serviceName: z.string().max(100).optional(),
  status: z.enum(["in_progress", "completed", "cancelled"]).optional(),
})

// -------------------- Generic helper --------------------
export async function parseBody<T>(req: Request, schema: z.ZodSchema<T>): Promise<{ success: true; data: T } | { success: false; error: ReturnType<typeof formatZodError> }> {
  try {
    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return { success: false, error: formatZodError(parsed.error) }
    }
    return { success: true, data: parsed.data }
  } catch (e) {
    return {
      success: false,
      error: {
        message: "Invalid JSON",
        issues: [{ path: "", message: "Body must be valid JSON", code: "custom" as any }],
      },
    }
  }
}

// -------------------- Organizations --------------------
/**
 * Создание инвайт-кода. Роль и срок задаёт админ своей организации;
 * организация в теле запроса не принимается — она берётся из сессии.
 */
export const createInviteSchema = z.object({
  role: z
    .enum(["admin", "logist"], { errorMap: () => ({ message: "Роль: admin или logist" }) })
    .default("logist"),
  /** null/не задано = бессрочный код */
  expiresInDays: z
    .number({ invalid_type_error: "Срок действия — число дней" })
    .int("Срок действия — целое число дней")
    .min(1, "Минимум 1 день")
    .max(365, "Максимум 365 дней")
    .nullable()
    .optional(),
  /** null/не задано = многоразовый без лимита */
  maxUses: z
    .number({ invalid_type_error: "Лимит использований — число" })
    .int("Лимит использований — целое число")
    .min(1, "Минимум 1 использование")
    .max(1000, "Максимум 1000 использований")
    .nullable()
    .optional(),
})

export type CreateInviteInput = z.infer<typeof createInviteSchema>

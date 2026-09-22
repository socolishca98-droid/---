// lib/validators.ts - Zod validation schemas (P1-6)
import { z } from "zod"

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

export const registerSchema = z.object({
  email: z.string().min(1).email().max(254).trim().toLowerCase(),
  password: z.string().min(8, "Password min 8").max(128),
  name: z.string().trim().max(100).optional().or(z.literal("")),
})

export const driverLoginSchema = z.object({
  phone: z.string().min(5, "Phone required").max(30),
  organization: z.string().min(1, "Organization required").max(100),
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
})

export const updateOrderSchema = createOrderSchema.partial().extend({
  status: z.enum(["new", "confirmed", "in_transit", "delivered", "cancelled", "assigned", "in_route", "completed", "proposed", "needs_clarification"]).optional(),
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

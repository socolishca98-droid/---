// lib/plans/types.ts
// SaaS commercial model — technical foundation (Task 9)
// Not tied to any payment provider. Production billing requires external provider.

export type PlanName = "start" | "pro" | "business"

export interface PlanLimits {
  /** Maximum vehicles in fleet */
  maxVehicles: number
  /** Maximum drivers */
  maxDrivers?: number
  /** Maximum orders per month */
  maxOrdersPerMonth?: number
  /** Maximum ATI scan frequency (requests/min) */
  maxAtiScanRate?: number
  /** Feature flags */
  features: {
    multiDriverAccess: boolean
    routeOptimization: boolean
    financialReports: boolean
    customBranding: boolean
    apiAccess: boolean
    backupRestore: boolean
  }
}

export interface Plan {
  name: PlanName
  label: string
  description: string
  monthlyPriceRub: number
  limits: PlanLimits
  isActive: boolean
}

export const PLANS: Record<PlanName, Plan> = {
  start: {
    name: "start",
    label: "START",
    description: "До 5 машин — старт для небольшого автопарка",
    monthlyPriceRub: 0,
    limits: {
      maxVehicles: 5,
      maxDrivers: 10,
      maxOrdersPerMonth: 300,
      maxAtiScanRate: 10,
      features: {
        multiDriverAccess: false,
        routeOptimization: false,
        financialReports: false,
        customBranding: false,
        apiAccess: false,
        backupRestore: false,
      },
    },
    isActive: true,
  },
  pro: {
    name: "pro",
    label: "PRO",
    description: "До 20 машин — для растущих компаний",
    monthlyPriceRub: 4990,
    limits: {
      maxVehicles: 20,
      maxDrivers: 50,
      maxOrdersPerMonth: 2000,
      maxAtiScanRate: 30,
      features: {
        multiDriverAccess: true,
        routeOptimization: true,
        financialReports: true,
        customBranding: false,
        apiAccess: true,
        backupRestore: false,
      },
    },
    isActive: true,
  },
  business: {
    name: "business",
    label: "BUSINESS",
    description: "50+ машин — полный набор функций",
    monthlyPriceRub: 14990,
    limits: {
      maxVehicles: 200,
      maxDrivers: 500,
      maxOrdersPerMonth: 10000,
      maxAtiScanRate: 120,
      features: {
        multiDriverAccess: true,
        routeOptimization: true,
        financialReports: true,
        customBranding: true,
        apiAccess: true,
        backupRestore: true,
      },
    },
    isActive: true,
  },
}

export type SubscriptionStatus = "trial" | "active" | "past_due" | "cancelled" | "expired"

export interface Subscription {
  organizationId: string
  planName: PlanName
  status: SubscriptionStatus
  trialEndsAt?: Date | null
  currentPeriodStart: Date
  currentPeriodEnd: Date
  cancelledAt?: Date | null
  cancelReason?: string | null
  updatedAt: Date
  createdAt: Date
}

export interface UsageStats {
  organizationId: string
  periodStart: Date
  periodEnd: Date
  vehiclesUsed: number
  driversUsed: number
  ordersCreated: number
  atiScansPerformed: number
}

/** Check if organization exceeds its plan limits */
export function checkLimits(
  planName: PlanName,
  usage: { vehicles: number; drivers?: number; orders?: number },
): { exceeded: boolean; exceededFields: string[]; message: string } {
  const plan = PLANS[planName]
  if (!plan) return { exceeded: true, exceededFields: ["plan"], message: "Plan not found" }

  const exceededFields: string[] = []
  if (usage.vehicles > plan.limits.maxVehicles) exceededFields.push("vehicles")
  if (plan.limits.maxDrivers !== undefined && usage.drivers !== undefined && usage.drivers > plan.limits.maxDrivers) exceededFields.push("drivers")

  if (exceededFields.length > 0) {
    return {
      exceeded: true,
      exceededFields,
      message: `Превышен лимит тарифа ${plan.label}: ${exceededFields.join(", ")}. Для продолжения работы перейдите на более высокий тариф.`,
    }
  }
  return { exceeded: false, exceededFields: [], message: "Within limits" }
}

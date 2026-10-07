// lib/plans/subscription.ts
// Basic subscription and trial management (Task 9 — technical model)
// Production billing requires external payment provider integration.

import { PLANS, Subscription, SubscriptionStatus, UsageStats, checkLimits, PlanName } from "./types"

/** Start trial for organization */
export function startTrial(organizationId: string): Partial<Subscription> {
  const now = new Date()
  const trialEndsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000) // 14-day trial
  return {
    organizationId,
    planName: "start" as PlanName,
    status: "trial" as SubscriptionStatus,
    trialEndsAt,
    currentPeriodStart: now,
    currentPeriodEnd: trialEndsAt,
    updatedAt: now,
    createdAt: now,
  }
}

/** Upgrade/downgrade plan */
export function changePlan(
  current: Partial<Subscription>,
  newPlanName: PlanName,
): Partial<Subscription> {
  const now = new Date()
  const plan = PLANS[newPlanName]
  if (!plan) throw new Error(`Unknown plan: ${newPlanName}`)
  return {
    ...current,
    planName: newPlanName,
    status: "active" as SubscriptionStatus,
    currentPeriodStart: now,
    currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    updatedAt: now,
  }
}

/** Check trial expiration */
export function checkTrialStatus(subscription: Partial<Subscription>): SubscriptionStatus {
  if (subscription.status !== "trial") return subscription.status || "expired"
  if (subscription.trialEndsAt && new Date() > subscription.trialEndsAt) {
    return "expired"
  }
  return "trial"
}

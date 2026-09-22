// lib/audit.ts - Audit logging for admin actions (P1-4)
import { prisma } from "@/lib/prisma"

export type AuditAction =
  | "approve"
  | "deactivate"
  | "activate"
  | "change_role"
  | "login"
  | "register"
  | "create"
  | "update"
  | "delete"

export interface AuditLogInput {
  actorId: string
  actorEmail?: string | null
  action: AuditAction | string
  targetId?: string | null
  targetType?: string // default user
  targetEmail?: string | null
  metadata?: Record<string, any> | null
  ip?: string | null
}

export async function logAudit(input: AuditLogInput): Promise<void> {
  try {
    const metadataStr = input.metadata ? JSON.stringify(input.metadata) : null
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        actorEmail: input.actorEmail || null,
        action: input.action,
        targetId: input.targetId || null,
        targetType: input.targetType || "user",
        targetEmail: input.targetEmail || null,
        metadata: metadataStr,
        ip: input.ip || null,
      },
    })
  } catch (e) {
    // Don't fail main action if audit fails, just log
    console.error("[Audit] Failed to log:", e)
  }
}

export async function getAuditLogs(params?: {
  limit?: number
  offset?: number
  actorId?: string
  targetId?: string
  action?: string
}) {
  const limit = Math.min(params?.limit || 100, 500)
  const where: any = {}
  if (params?.actorId) where.actorId = params.actorId
  if (params?.targetId) where.targetId = params.targetId
  if (params?.action) where.action = params.action

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: params?.offset || 0,
  })

  return logs.map((log: any) => ({
    ...log,
    metadata: log.metadata ? safeParseJson(log.metadata) : null,
  }))
}

function safeParseJson(str: string): any {
  try {
    return JSON.parse(str)
  } catch {
    return str
  }
}

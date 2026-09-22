// app/api/admin/users/route.ts - P1-4 audit + P1-6 zod
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getStaffSession } from "@/lib/auth-server"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/rate-limiter"
import { adminUserActionSchema, zodErrorResponse } from "@/lib/validators"

export async function GET(req: NextRequest) {
  try {
    const sessionUser = await getStaffSession(req)
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: "Требуется авторизация" }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get("status")
    const query = searchParams.get("q")

    const where: any = {}
    if (status && status !== "all") where.status = status
    if (query) {
      where.OR = [{ name: { contains: query } }, { email: { contains: query } }]
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        approvedBy: true,
        approvedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    })

    const counts = {
      total: await prisma.user.count(),
      pending: await prisma.user.count({ where: { status: "pending_approval" } }),
      active: await prisma.user.count({ where: { status: "active" } }),
      deactivated: await prisma.user.count({ where: { status: "deactivated" } }),
    }

    return NextResponse.json({ success: true, users, counts })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const sessionUser = await getStaffSession(req)
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: "Требуется авторизация" }, { status: 401 })
    }

    const rawBody = await req.json().catch(() => null)
    if (!rawBody) {
      return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
    }

    const parsed = adminUserActionSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(zodErrorResponse(parsed.error), { status: 400 })
    }

    const { userId, action, role } = parsed.data

    const targetUser = await prisma.user.findUnique({ where: { id: userId } })
    if (!targetUser) {
      return NextResponse.json({ success: false, error: "Пользователь не найден" }, { status: 404 })
    }

    if (targetUser.id === sessionUser.id && action === "deactivate") {
      return NextResponse.json(
        { success: false, error: "Вы не можете деактивировать собственный аккаунт" },
        { status: 400 }
      )
    }

    let updateData: any = {}
    switch (action) {
      case "approve":
        updateData = { status: "active", approvedBy: sessionUser.id, approvedAt: new Date() }
        break
      case "deactivate":
        updateData = { status: "deactivated" }
        break
      case "activate":
        updateData = { status: "active" }
        break
      case "change_role":
        if (role) updateData = { role }
        break
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        approvedBy: true,
        approvedAt: true,
        updatedAt: true,
      },
    })

    const ip = getClientIp(req)
    await logAudit({
      actorId: sessionUser.id,
      actorEmail: (sessionUser as any).email || null,
      action,
      targetId: targetUser.id,
      targetType: "user",
      targetEmail: targetUser.email,
      metadata: {
        previousStatus: targetUser.status,
        previousRole: targetUser.role,
        newStatus: (updated as any).status,
        newRole: (updated as any).role,
        requestedRole: role,
      },
      ip,
    })

    return NextResponse.json({ success: true, user: updated })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

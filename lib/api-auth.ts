// lib/api-auth.ts - P0 shared auth helpers for API routes
import { NextRequest, NextResponse } from "next/server"
import { getStaffSession, getDriverSession } from "@/lib/auth-server"

export async function requireStaffAuth(req: NextRequest) {
  const user = await getStaffSession(req)
  if (!user) {
    return {
      error: NextResponse.json({ success: false, error: "Unauthorized - staff authentication required" }, { status: 401 }),
      user: null as any,
    }
  }
  return { user, error: null }
}

export async function requireDriverAuth(req: NextRequest) {
  const session = await getDriverSession(req)
  if (!session) {
    // Also allow staff to access driver endpoints for admin purposes
    const staff = await getStaffSession(req)
    if (staff) {
      return { driver: null, staff, error: null, isStaff: true }
    }
    return {
      error: NextResponse.json({ success: false, error: "Unauthorized - driver authentication required" }, { status: 401 }),
      driver: null as any,
      staff: null as any,
      isStaff: false,
    }
  }
  return { driver: session.driver, driverId: session.driverId, staff: null, error: null, isStaff: false }
}

export async function requireAnyAuth(req: NextRequest) {
  const driverSession = await getDriverSession(req)
  if (driverSession) {
    return { type: 'driver' as const, driver: driverSession.driver, user: null, error: null }
  }
  const staffSession = await getStaffSession(req)
  if (staffSession) {
    return { type: 'staff' as const, user: staffSession, driver: null, error: null }
  }
  return {
    error: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    type: null as any,
    user: null as any,
    driver: null as any,
  }
}

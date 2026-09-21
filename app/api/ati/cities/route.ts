import { NextRequest } from "next/server"
import { requireStaff } from "@/lib/auth/session"

import { NextResponse } from 'next/server'
import { getCitiesList } from '@/lib/ati-client'

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const cities = getCitiesList()
  return NextResponse.json(cities)
}
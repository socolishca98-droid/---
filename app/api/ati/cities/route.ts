import { requireStaffAuth } from "@/lib/api-auth"
import { NextRequest, NextResponse } from "next/server"
import { getCitiesList } from '@/lib/ati-client'

export async function GET(request: NextRequest) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;


  const cities = getCitiesList()
  return NextResponse.json(cities)
}
import { requireStaffAuth } from "@/lib/api-auth"
import {requireStaffOrganization} from "@/lib/org"
import { NextRequest, NextResponse } from "next/server"
import { getCitiesList } from '@/lib/ati-client'

export async function GET(request: NextRequest) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  const cities = getCitiesList()
  return NextResponse.json(cities)
}
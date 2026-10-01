// app/api/owner/me/route.ts
//
// GET /api/owner/me — является ли текущий сотрудник владельцем платформы.
// Используется интерфейсом, чтобы показывать раздел «Владелец» только ему.

import { NextRequest, NextResponse } from "next/server";

import { requireStaff } from "@/lib/auth/session";
import { isPlatformOwner } from "@/lib/auth/owner";

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request);
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    success: true,
    owner: isPlatformOwner(auth.value),
  });
}

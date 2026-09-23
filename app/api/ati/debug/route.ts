import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization, scopedWhere } from "@/lib/org"
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  const token = process.env.ATI_TOKEN;
  
  if (!token) return NextResponse.json({ error: "No Token" });

  const results: any = { 
      token_preview: token.substring(0, 10) + "...",
      me: {}, 
      permissions: {} 
  };

  // 1. Кто я? (Проверка токена)
  try {
      const res = await fetch("https://api.ati.su/v1.0/users/me", {
          headers: { "Authorization": `Bearer ${token}` }
      });
      const data = await res.json();
      results.me = { status: res.status, data };
  } catch (e) { results.me = { error: (e as Error).message }; }

  // 2. Моя фирма (Проверка связи с аккаунтом)
  try {
      const res = await fetch("https://api.ati.su/v1.0/firms/my", {
          headers: { "Authorization": `Bearer ${token}` }
      });
      const data = await res.json();
      results.firm = { status: res.status, id: data.id, name: data.name, city: data.city };
  } catch (e) { results.firm = { error: (e as Error).message }; }

  return NextResponse.json(results);
}
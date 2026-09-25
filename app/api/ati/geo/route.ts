// app/api/ati/geo/route.ts
import { requireStaffAuth } from "@/lib/api-auth"
import {requireStaffOrganization} from "@/lib/org"
import { NextRequest, NextResponse } from "next/server"
import { getCitiesList } from "@/lib/ati-client"

// Тип, который ждет фронтенд (компонент GeoSelect)
interface GeoOption {
  id: number
  name: string
  fullName: string
  region: string
}

export async function GET(request: NextRequest) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  const { searchParams } = new URL(request.url)
  const query = searchParams.get("q")?.toLowerCase().trim()

  if (!query || query.length < 2) {
    return NextResponse.json([])
  }

  // 1. Берем наш жесткий список городов (где правильные ID)
  const allCities = getCitiesList()

  // 2. Фильтруем по запросу
  const filtered = allCities.filter(c => 
    c.name.toLowerCase().includes(query) || 
    c.region.toLowerCase().includes(query)
  )

  // 3. ПРЕВРАЩАЕМ В НУЖНЫЙ ФОРМАТ (Маппинг)
  // Это самое важное: фронт ждет 'name' и 'fullName', если их нет — будет undefined
  const results: GeoOption[] = filtered.slice(0, 15).map(c => ({
    id: c.atiId, // Используем atiId как основной идентификатор
    name: c.name,
    region: c.region,
    // Формируем полное имя, чтобы в списке было красиво
    fullName: `${c.name}, ${c.region}`
  }))

  return NextResponse.json(results)
}
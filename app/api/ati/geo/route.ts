// app/api/ati/geo/route.ts
import { requireStaffAuth } from "@/lib/api-auth"
import {requireStaffOrganization} from "@/lib/org"
import { NextRequest, NextResponse } from "next/server"
import { getCitiesList } from "@/lib/ati-client"
import { fetchAtiRegions, findRegionByName } from "@/lib/ati/regions"
import { getActiveAtiToken } from "@/lib/ati/connection"

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

  // Города нет в старом списке — предлагаем РЕГИОН. Общая биржа ищет именно
  // по региону (id в её фильтре — это RegionId), поэтому «Вологодская
  // область» даст грузы, а ненайденный id города — ноль. Без этого живой
  // поиск работал бы только у организаций из 28 зашитых городов.
  if (results.length === 0) {
    try {
      const ati = await getActiveAtiToken(__org.organizationId)
      if (ati.ok) {
        const regions = await fetchAtiRegions(ati.token, __org.organizationId)
        const region = findRegionByName(query, regions)
        if (region) {
          results.push({
            id: region.id,
            name: region.name,
            region: region.name,
            fullName: `${region.name} (регион — биржа ищет по всей области)`,
          })
        }
      }
    } catch {
      /* справочник недоступен — отдаём хотя бы то, что есть */
    }
  }

  return NextResponse.json(results)
}
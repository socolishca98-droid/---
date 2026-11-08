// lib/cargomart/persist.ts
//
// Запись грузов Cargomart в накопленную базу заявок (AtiCache).
//
// AtiCache — это ВНУТРЕННЯЯ модель «накопленная база грузов организации», а
// не собственность ATI-кода: туда пишут все источники, и помощник сборки не
// знает, откуда пришёл груз. Идентификаторы Cargomart ходят с префиксом
// «cargomart:» — груз №123 с двух бирж не сливается в одну строку.
//
// Контакты не запрашиваются и не пишутся: contactName/contactPhone — null
// (правило продукта: контакты — осознанное действие логиста, не побочный
// эффект сбора).
//
// Накопленная база не переписывает уже записанные грузы: логист мог взять
// груз в работу, и молча менять под ним города или цену нельзя. Скан только
// добавляет новое; старое живёт до своего TTL.

import { prisma } from "@/lib/prisma"
import { parseAtiRate } from "@/lib/pricing/status"
import { cargomartCityKeys, cityWithRegion, type CargomartMappedLoad } from "./mapping"

export type CargomartPersistResult = {
  created: number
  updated: number
  /** Идентификаторы в внутреннем формате (cargomart:…) — для ответа скана */
  ids: string[]
}

export async function saveCargomartLoads(
  organizationId: string,
  loads: CargomartMappedLoad[],
): Promise<CargomartPersistResult> {
  const now = new Date()
  if (loads.length === 0) return { created: 0, updated: 0, ids: [] }

  const ids = loads.map((load) => load.id)
  // org-audit: ok — строки ищутся в накопленной базе своей организации
  const existing = await prisma.atiCache.findMany({
    where: { organizationId, atiLoadId: { in: ids } },
    select: { id: true, atiLoadId: true, status: true },
  })
  const existingIds = new Set(existing.map((row) => row.atiLoadId))

  const toCreate: Array<{
    organizationId: string
    atiLoadId: string
    routeFrom: string
    routeTo: string
    expiresAt: Date
    [key: string]: unknown
  }> = []
  for (const load of loads) {
    if (existingIds.has(load.id)) continue

    const routeFrom = cityWithRegion(load.loading.location.city, load.loading.location.region)
    const routeTo = cityWithRegion(load.unloading.location.city, load.unloading.location.region)
    const { fromKey, toKey } = cargomartCityKeys(load)

    // Цена и её статус — общий разбор цен (как у ATI-грузов): сумма, статус
    // и СЫРОЕ значение, чтобы «договорная» и битый формат не терялись.
    const parsedRate = parseAtiRate({
      price: load.rate.price,
      priceNds: load.rate.priceNds,
      priceNoNds: load.rate.priceNoNds,
    })

    let loadingDate = new Date()
    if (load.loading.firstDate) {
      const d = new Date(load.loading.firstDate)
      if (!Number.isNaN(d.getTime())) loadingDate = d
    }
    let unloadingDate: Date | null = null
    if (load.unloading.firstDate) {
      const d = new Date(load.unloading.firstDate)
      if (!Number.isNaN(d.getTime())) unloadingDate = d
    }

    // TTL: 2 дня от даты погрузки — как у грузов ATI
    const expiresAt = new Date(loadingDate.getTime() + 2 * 24 * 60 * 60 * 1000)

    toCreate.push({
      organizationId,
      atiLoadId: load.id,
      routeFrom,
      routeFromId: fromKey,
      routeTo,
      routeToId: toKey,
      distance: load.route.distance ?? 0,
      weight: load.load.weight !== null ? Math.round(load.load.weight * 1000) : 0,
      volume: load.load.volume ?? null,
      cargoType: load.load.cargoType ?? "Груз",
      truckType: load.truck.carTypes.length > 0 ? load.truck.carTypes.join(", ") : null,
      loadingType: null,
      price: parsedRate.amountRub,
      priceType: load.rate.priceNds !== null ? "with_nds" : load.rate.priceNoNds !== null ? "without_nds" : null,
      priceStatus: parsedRate.status,
      priceRaw: parsedRate.raw !== null && parsedRate.raw !== undefined ? String(parsedRate.raw) : null,
      paymentType: null,
      vatIncluded: parsedRate.vatIncluded,
      loadingDate,
      unloadingDate,
      firmId: null,
      firmName: null,
      // Контакты не собираем — принципиально: осознанное действие логиста
      contactName: null,
      contactPhone: null,
      note: null,
      rawJson: null,
      status: "new",
      scannedAt: now,
      expiresAt,
    })
  }

  if (toCreate.length > 0) {
    // skipDuplicates SQLite не поддерживает — повторные сканы отсекаются
    // выше поиском existingIds, а гонок внутри одного dev-процесса нет.
    await prisma.atiCache.createMany({ data: toCreate })
  }

  return {
    created: toCreate.length,
    updated: 0,
    ids: toCreate.map((row) => String(row.atiLoadId)),
  }
}

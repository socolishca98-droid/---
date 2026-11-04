// app/api/pricing/quote/route.ts
//
// POST /api/pricing/quote — «сколько может стоить перевозка по этому направлению».
//
// Отдельный сценарий ТЗ: ПРЕДЛОЖЕНИЙ НЕТ. Логист вводит направление, и
// программа честно отвечает одним из трёх:
//   · есть аналоги — ориентир с диапазоном, ₽/км, числом аналогов, датой
//     данных, источником и уверенностью;
//   · аналогов нет, но известна себестоимость — «недостаточно данных для
//     достоверной оценки» + нижняя граница по расходам организации;
//   · нет ничего — «недостаточно данных», и НИКАКОЙ суммы.
//
// Чего здесь принципиально НЕТ: создания фиктивных заявок. Оценка направления
// — это справка, а не груз. Как только появится настоящий груз, у него будет
// свой номер и своя история.

import { NextRequest, NextResponse } from "next/server"

import { requireStaff } from "@/lib/auth/session"
import { requireOrganization } from "@/lib/org"
import { prisma } from "@/lib/prisma"
import { quotePrice } from "@/lib/pricing/service"
import { contactlessNote, describePrice, CONFIDENCE_LABELS, SOURCE_LABELS } from "@/lib/pricing/format"

export const dynamic = "force-dynamic"

/**
 * Километры по дорогам из кэша расстояний, если он уже есть.
 *
 * Сам кэш общий для установки (RouteDistance не делится по организациям), но
 * читаем его только на чтение: расчёт расстояний не входит в эту задачу, а
 * выдумывать километры нельзя — без них оценка просто не приведёт близкие
 * направления и скажет об этом словами.
 */
async function cachedKm(from: string, to: string): Promise<number | null> {
  try {
    const rows = await prisma.routeDistance.findMany({
      where: { fromId: `city:${from.toLowerCase()}`, toId: `city:${to.toLowerCase()}` },
      take: 1,
      select: { km: true },
    })
    const km = rows[0]?.km
    return typeof km === "number" && km > 0 ? km : null
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  let body: {
    fromCity?: unknown
    toCity?: unknown
    km?: unknown
    weightKg?: unknown
    volumeM3?: unknown
    bodyType?: unknown
    date?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Некорректное тело запроса" }, { status: 400 })
  }

  const fromCity = String(body.fromCity ?? "").trim()
  const toCity = String(body.toCity ?? "").trim()
  if (fromCity.length < 2 || toCity.length < 2) {
    return NextResponse.json({ success: false, error: "Нужны города отправления и назначения" }, { status: 400 })
  }

  const kmInput = Number(body.km)
  const km = Number.isFinite(kmInput) && kmInput > 0 ? kmInput : await cachedKm(fromCity, toCity)
  const weight = Number(body.weightKg)
  const volume = Number(body.volumeM3)

  const quote = await quotePrice({
    organizationId: org.organizationId,
    refKind: "direction",
    // Направление — не заявка: ключ строится из самих городов, чтобы история
    // оценок по одному и тому же направлению была видна отдельно.
    refId: `${fromCity.toLowerCase()}→${toCity.toLowerCase()}`,
    fromCity,
    toCity,
    km,
    weightKg: Number.isFinite(weight) && weight > 0 ? weight : null,
    volumeM3: Number.isFinite(volume) && volume > 0 ? volume : null,
    bodyType: typeof body.bodyType === "string" ? body.bodyType : null,
    temperature: null,
    date: body.date ? new Date(String(body.date)) : null,
  })

  const display = describePrice(
    {
      status: "NEGOTIATION_REQUIRED",
      amountRub: null,
      // Себестоимость показывается как нижняя граница расходов, а не как цена.
      costFloorRub: quote.ok ? null : quote.costFloorRub,
    },
    quote.ok ? quote.estimate : null,
  )

  // Километры неизвестны — говорим прямо: близкие направления в расчёт не
  // пошли (приводить их «на глазок» нельзя), и ₽/км не показывается.
  const kmNote =
    km === null
      ? "Километры направления неизвестны — близкие направления в расчёт не вошли, ₽/км не считается. " +
        "Поставьте километры вручную или посчитайте маршрут, чтобы уточнить оценку."
      : null

  if (!quote.ok) {
    return NextResponse.json({
      success: true,
      ok: false,
      // Честный отказ: цены нет, и мы её не придумываем.
      message: "Недостаточно данных для достоверной оценки",
      reason: quote.reason,
      rejected: quote.rejected,
      costFloorRub: quote.costFloorRub,
      km,
      kmNote,
      display,
      // Звонить по направлению некуда: предложений нет, значит и телефона нет.
      contact: { available: false, note: contactlessNote("no-offers") },
      source: "Loginex — оценка по сопоставимым данным организации и биржи",
    })
  }

  return NextResponse.json({
    success: true,
    ok: true,
    estimate: quote.estimate,
    belowCost: quote.belowCost,
    km,
    // Что именно легло в расчёт — с приведением к искомому плечу. Это не
    // «доверие на слово»: логист видит, из каких перевозок сложилась цифра.
    used: quote.used,
    rejected: quote.rejected,
    display,
    kmNote,
    sources: quote.estimate.sources.map((item) => SOURCE_LABELS[item] ?? item),
    confidenceLabel: CONFIDENCE_LABELS[quote.estimate.confidence],
    /**
     * Это НЕ предложение ATI.SU, а расчёт Loginex. Подпись обязательна: иначе
     * расчётную цену легко принять за найденную заявку.
     */
    source: "Loginex — самостоятельная оценка, не предложение ATI.SU",
    contact: { available: false, note: contactlessNote("no-offers") },
  })
}

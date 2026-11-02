// lib/routing/optimizer.ts
//
// Route Optimizer: сравнение вариантов и ранжирование.
//
// Главное отличие от прежнего выбора: не «взять самый денежный и спрятать
// остальные», а показать несколько вариантов, объяснить разницу и дать выбрать
// критерий. Правило «больше 35 % порожняка — не показываем» отменено: оно
// прятало от логиста самый денежный рейс. Теперь порожний пробег — это
// предупреждение и отдельный критерий сортировки, а не запрет.

import type { RankingCriterion, RoutePlan, Settings } from "./types"

export interface RankOutput {
  variants: RoutePlan[]
  recommended: RoutePlan | null
}

const NEAR_BEST_SHARE = 0.1 // «в пределах 10 % от лучшего» — для критериев «короче/ближе»

/**
 * Ключ уникальности: модель + ПОРЯДОК заказов + факт возврата.
 *
 * Порядок важен. Когда ключ брался по отсортированному набору, варианты
 * «А→Б→В» и «В→Б→А» считались одним и тем же маршрутом: оставался первый
 * попавшийся, и более выгодная перестановка молча выпадала из выдачи.
 */
function signature(plan: RoutePlan): string {
  return `${plan.model}|${plan.orderIds.join(">")}|${plan.returned.kind}`
}

function byCriterion(criterion: RankingCriterion, bestNet: number) {
  const floor =
    bestNet > 0 ? bestNet * (1 - NEAR_BEST_SHARE) : bestNet + Math.abs(bestNet) * NEAR_BEST_SHARE
  return (a: RoutePlan, b: RoutePlan): number => {
    switch (criterion) {
      case "profit":
        // Сравнение с возвратом на базу: открытый рейс не должен выигрывать
        // только потому, что возврат в его расчёте не учтён.
        return b.economics.netCommittedRub - a.economics.netCommittedRub
      case "profitPerKm":
        return (b.economics.netPerKm ?? -Infinity) - (a.economics.netPerKm ?? -Infinity)
      case "emptyShare": {
        // Сначала отсекаем «почти лучшие» по деньгам, внутри них — меньше порожняка.
        const aNear = a.economics.netCommittedRub >= floor ? 0 : 1
        const bNear = b.economics.netCommittedRub >= floor ? 0 : 1
        if (aNear !== bNear) return aNear - bNear
        if (a.economics.emptyShare !== b.economics.emptyShare) {
          return a.economics.emptyShare - b.economics.emptyShare
        }
        return b.economics.netCommittedRub - a.economics.netCommittedRub
      }
      case "duration": {
        const aNear = a.economics.netCommittedRub >= floor ? 0 : 1
        const bNear = b.economics.netCommittedRub >= floor ? 0 : 1
        if (aNear !== bNear) return aNear - bNear
        const aHours = a.schedule.endAt.getTime() - a.schedule.startAt.getTime()
        const bHours = b.schedule.endAt.getTime() - b.schedule.startAt.getTime()
        if (aHours !== bHours) return aHours - bHours
        return b.economics.netCommittedRub - a.economics.netCommittedRub
      }
      case "returnRequired": {
        const aHome = a.returned.kind === "loaded" ? 0 : a.returned.satisfiesMode ? 1 : 2
        const bHome = b.returned.kind === "loaded" ? 0 : b.returned.satisfiesMode ? 1 : 2
        if (aHome !== bHome) return aHome - bHome
        return b.economics.netCommittedRub - a.economics.netCommittedRub
      }
      default:
        return b.economics.netCommittedRub - a.economics.netCommittedRub
    }
  }
}

export function rankVariants(plans: RoutePlan[], settings: Settings, limit = 5): RankOutput {
  if (plans.length === 0) return { variants: [], recommended: null }

  // Убыточные не предлагаем ни при каком критерии: убыточный рейс не нужен.
  const profitable = plans.filter((plan) => plan.economics.netCommittedRub > 0)
  const allUnprofitable = profitable.length === 0
  const pool = allUnprofitable
    ? plans.map((plan) => ({
        ...plan,
        warnings: [
          ...plan.warnings,
          "рейс убыточен: выручка не покрывает расходы — рекомендации нет, решайте сами",
        ],
      }))
    : profitable

  const seen = new Set<string>()
  const unique: RoutePlan[] = []
  for (const plan of pool) {
    const key = signature(plan)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(plan)
  }

  // Режим возврата «обязательно»/«предпочтительно»: рекомендация обязана
  // возвращать машину на базу. Открытые рейсы не выбрасываются — они
  // показываются отдельно как «что было бы, если не возвращаться».
  const mustReturn = settings.returnMode !== "free"
  const returning = unique.filter((plan) => plan.returned.kind !== "none")
  const open = unique.filter((plan) => plan.returned.kind === "none")
  const primary = mustReturn && returning.length > 0 ? returning : unique
  const bestNet = Math.max(...primary.map((plan) => plan.economics.netCommittedRub))
  const sorted = [...primary].sort(byCriterion(settings.ranking, bestNet))

  // Дополнительно: в вариантах обязательно должен быть самый денежный —
  // что бы ни выбрал логист критерием, «сколько можно заработать» он должен
  // видеть, а не догадываться.
  const topByMoney = [...primary].sort(
    (a, b) => b.economics.netCommittedRub - a.economics.netCommittedRub,
  )[0]
  const variants = sorted.slice(0, limit)
  if (topByMoney && !variants.some((plan) => signature(plan) === signature(topByMoney))) {
    variants.splice(Math.min(1, variants.length), 0, topByMoney)
  }

  // Внутри вариантов — по одной модели минимум: сборный и последовательный
  // рядом, чтобы логист видел разницу, а не только победителя.
  const consolidated = [...primary]
    .filter((plan) => plan.model === "consolidated")
    .sort((a, b) => b.economics.netCommittedRub - a.economics.netCommittedRub)[0]
  if (consolidated && !variants.some((plan) => plan.model === "consolidated")) {
    variants.push(consolidated)
  }

  // Открытые рейсы — в конце, чтобы было видно цену возврата, но не вместо него.
  const openExtra = mustReturn ? open.slice(0, 1) : []
  for (const plan of openExtra) {
    if (!variants.some((item) => item.id === plan.id)) variants.push(plan)
  }

  // Если прибыльного варианта нет вообще, рекомендации тоже нет: показываем
  // расчёт и честную причину, вместо «рекомендую убыточный рейс».
  return {
    variants: variants.slice(0, limit + 2),
    recommended: allUnprofitable ? null : (variants[0] ?? null),
  }
}

/**
 * Чего не хватило заказу, чтобы попасть в план.
 *
 * Возвращается по каждому заказу, который логист видел в пуле: он должен
 * понимать, почему груз не взят, а не искать его в списке и гадать.
 */
export function explainRejections(
  orders: Array<{ id: string }>,
  plans: RoutePlan[],
  compatibleIds: Set<string>,
  details: Map<string, string[]>,
  /**
   * Экономика одиночного рейса по этому грузу: до погрузки, с грузом, домой.
   * Без неё отказ звучит «не окупает пробег» — а логисту нужно, СКОЛЬКО не
   * хватает и на чём: возврат, порожний подъезд или низкая ставка.
   */
  standalone?: (
    orderId: string,
  ) => { netRub: number; totalKm: number; emptyKm: number } | { reason: string } | null,
): Array<{ orderId: string; reason: string }> {
  const used = new Set<string>()
  for (const plan of plans) for (const id of plan.orderIds) used.add(id)
  const out: Array<{ orderId: string; reason: string }> = []
  for (const order of orders) {
    if (used.has(order.id)) continue
    if (!compatibleIds.has(order.id)) {
      out.push({
        orderId: order.id,
        reason: (details.get(order.id) ?? ["не подходит машине"]).join("; "),
      })
      continue
    }
    const single = standalone?.(order.id) ?? null
    if (single && "reason" in single) {
      out.push({ orderId: order.id, reason: `не вошёл в цепочку: ${single.reason}` })
      continue
    }
    if (single) {
      const money = Math.round(single.netRub)
      const tail =
        `${single.totalKm} км, из них порожним ${single.emptyKm}` +
        `, остаток ${money < 0 ? "−" : ""}${Math.abs(money).toLocaleString("ru-RU")} ₽`
      out.push({
        orderId: order.id,
        reason: single.netRub < 0
          ? `не вошёл в лучшие цепочки: одиночный рейс убыточен (${tail})`
          : `не вошёл в лучшие цепочки: одиночный рейс даёт меньше, чем другие цепочки (${tail})`,
      })
    } else {
      out.push({
        orderId: order.id,
        reason: "не вошёл в лучшие цепочки: не окупает пробег в этом составе",
      })
    }
  }
  return out
}

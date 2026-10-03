// lib/assistant/planner.ts — «мозг» виртуального логиста.
//
// Собирает из базы заказов максимально продуктивный маршрут для свободной
// машины: не один заказ, а цепочку (груз выгружается там, где грузится
// следующий — минимум порожних перегонов), с учётом грузоподъёмности,
// объёма, сроков и дохода. Заказы, которые ещё не согласованы, помечаются —
// логист подтверждает согласование или исключает заказ, и планировщик
// пересобирает цепочку (другой вариант).
//
// Модуль чистый: без Prisma и без сети. Порядок объезда считает проверенный
// движок lib/routes/optimizer (sequenceOrders), статусы — канон
// lib/orders/stages. Данные загружает API (app/api/assistant/plan), здесь —
// только логика, которую можно тестировать в Node (tests/planner.test.mjs).

import {
  normalizeCity,
  sequenceOrders,
  type OptimizerVariantId,
} from "../routes/optimizer";
import { isOrderClosed, isOrderRouteable } from "../orders/stages";

/** Заказ в том виде, в каком он нужен планировщику. */
export interface PlannerOrder {
  id: string;
  routeFrom: string;
  routeTo: string;
  distance: number | null;
  weight: number | null;
  volume: number | null;
  price: number | null;
  agreedPrice: number | null;
  deadline: Date | string | null;
  status: string | null;
  clientName: string | null;
  /** Заказ уже в рейсе — планировать нечего. */
  routeId: string | null;
}

/** Машина в том виде, в каком она нужна планировщику. */
export interface PlannerVehicle {
  id: string;
  plate: string;
  type: string | null;
  brand: string | null;
  model: string | null;
  capacity: number;
  volume: number | null;
  /** available | in_use | maintenance */
  status: string;
}

export type PlannerProposalOrder = PlannerOrder & {
  /** Заказ не согласован: в рейс его брать рано, нужно подтверждение цены. */
  needsApproval: boolean;
  /** Срок доставки горит: меньше 48 часов или уже прошёл. */
  deadlineSoon: boolean;
  /** Доход: согласованная цена важнее прайса. */
  revenueRub: number;
};

export type PlannerProposal = {
  id: string;
  variant: OptimizerVariantId;
  variantTitle: string;
  /** Почему цепочка именно такая — человеческим языком. */
  reason: string;
  orders: PlannerProposalOrder[];
  totalDistanceKm: number;
  totalWeightKg: number;
  revenueRub: number;
  /** Порожние перегоны: сколько раз выгрузка не совпала со следующей погрузкой. */
  emptyLegs: number;
  /** Сколько заказов можно брать в рейс прямо сейчас. */
  routeableCount: number;
  /** Сколько заказов ждут согласования. */
  approvalCount: number;
  /** Внутренняя оценка качества — по ней варианты сортируются. */
  score: number;
};

export type PlanStats = {
  /** Актуальных заказов всего (не закрыты и не в рейсе). */
  candidates: number;
  /** Не поместились в выбранную машину по весу/объёму. */
  overweight: number;
  /** Исключены логистом вручную. */
  excluded: number;
};

export type PlanResult = {
  proposals: PlannerProposal[];
  stats: PlanStats;
};

/** Сколько вариантов предлагать максимум. */
export const MAX_PROPOSALS = 3;

/** Срок «горит»: меньше 48 часов до дедлайна (или уже прошёл). */
const DEADLINE_SOON_MS = 48 * 60 * 60 * 1000;

const VARIANT_TITLES: Record<OptimizerVariantId, string> = {
  balanced: "Сбалансировано",
  fast: "Быстрее",
  cheap: "Дешевле",
};

const VARIANT_REASONS: Record<OptimizerVariantId, string> = {
  balanced:
    "Цепочка городов с минимумом порожних перегонов: баланс срока, дохода и пробега.",
  fast: "Сначала срочные заказы: минимум времени до доставки каждого груза.",
  cheap: "Максимум дохода на километр: меньше пробег и порожние перегоны.",
};

const PLAN_VARIANTS: readonly OptimizerVariantId[] = [
  "balanced",
  "fast",
  "cheap",
];

function deadlineOf(order: PlannerOrder): Date | null {
  if (!order.deadline) return null;
  const date =
    order.deadline instanceof Date ? order.deadline : new Date(order.deadline);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Доход заказа: согласованная цена важнее прайса. */
export function orderRevenue(order: PlannerOrder): number {
  if (typeof order.agreedPrice === "number" && order.agreedPrice > 0)
    return order.agreedPrice;
  if (typeof order.price === "number" && order.price > 0) return order.price;
  return 0;
}

/**
 * Актуальный заказ для планирования: не закрыт, ещё не в рейсе.
 * Просроченный дедлайн не исключает заказ — он помечается риском отдельно.
 */
export function isPlanCandidate(order: PlannerOrder): boolean {
  if (order.routeId) return false;
  return !isOrderClosed(order.status);
}

/** Свободные машины: только available (в рейсе и на ТО не планируем). */
export function availableVehicles(
  vehicles: readonly PlannerVehicle[],
): PlannerVehicle[] {
  return vehicles.filter((vehicle) => vehicle.status === "available");
}

/**
 * Машина по умолчанию: свободная с наибольшей грузоподъёмностью —
 * в неё помещается больше всего заказов из базы.
 */
export function pickDefaultVehicle(
  vehicles: readonly PlannerVehicle[],
): PlannerVehicle | null {
  const free = availableVehicles(vehicles);
  if (free.length === 0) return null;
  return [...free].sort((a, b) => b.capacity - a.capacity)[0];
}

/** Заказ помещается в машину: вес и объём (если оба заданы). */
export function orderFitsVehicle(
  order: PlannerOrder,
  vehicle: PlannerVehicle,
): boolean {
  const weight = typeof order.weight === "number" ? order.weight : 0;
  if (weight > vehicle.capacity) return false;
  if (
    typeof order.volume === "number" &&
    typeof vehicle.volume === "number" &&
    order.volume > vehicle.volume
  ) {
    return false;
  }
  return true;
}

/** Городская цепочка маршрута: города по порядку с отметкой порожнего перегона. */
export function chainCities(
  orders: readonly PlannerOrder[],
): { city: string; gapBefore: boolean }[] {
  const chain: { city: string; gapBefore: boolean }[] = [];
  let previousTo: string | null = null;

  for (const order of orders) {
    const from = normalizeCity(order.routeFrom);
    chain.push({
      city: order.routeFrom,
      gapBefore: previousTo !== null && from !== previousTo,
    });
    chain.push({ city: order.routeTo, gapBefore: false });
    previousTo = normalizeCity(order.routeTo);
  }

  return chain;
}

/** Порожние перегоны: выгрузка не совпала со следующей погрузкой. */
export function countEmptyLegs(orders: readonly PlannerOrder[]): number {
  let gaps = 0;
  for (let i = 1; i < orders.length; i += 1) {
    if (
      normalizeCity(orders[i - 1].routeTo) !==
      normalizeCity(orders[i].routeFrom)
    ) {
      gaps += 1;
    }
  }
  return gaps;
}

function toProposalOrder(order: PlannerOrder, now: Date): PlannerProposalOrder {
  const deadline = deadlineOf(order);
  return {
    ...order,
    needsApproval: !isOrderRouteable(order.status),
    deadlineSoon:
      deadline !== null &&
      deadline.getTime() - now.getTime() < DEADLINE_SOON_MS,
    revenueRub: orderRevenue(order),
  };
}

/**
 * Оценка варианта: доход важнее всего, но порожние перегоны и лишний пробег
 * штрафуются, а готовые к рейсу (согласованные) заказы поощряются — рейс,
 * который можно отправить сегодня, лучше «красивого» теоретического.
 */
function scoreProposal(
  orders: readonly PlannerProposalOrder[],
  distanceKm: number,
  emptyLegs: number,
): number {
  const revenue = orders.reduce((sum, order) => sum + order.revenueRub, 0);
  const routeable = orders.filter((order) => !order.needsApproval).length;
  return revenue / 1000 + routeable * 50 - emptyLegs * 80 - distanceKm * 0.02;
}

/**
 * Собрать предложения маршрута для машины.
 *
 * Для каждого сценария (сбалансировано / быстрее / дешевле) движок
 * sequenceOrders расставляет заказы, затем цепочка прореживается по
 * грузоподъёмности: тяжёлый заказ пропускается, но цепочка продолжается —
 * так машина заполняется максимально плотно. Одинаковые цепочки
 * схлопываются, наверх попадают MAX_PROPOSALS лучших по оценке.
 */
export function buildPlanProposals(input: {
  orders: readonly PlannerOrder[];
  vehicle: PlannerVehicle;
  excludeIds?: readonly string[];
  now?: Date;
}): PlanResult {
  const { orders, vehicle } = input;
  const now = input.now ?? new Date();
  const exclude = new Set(input.excludeIds ?? []);

  const actual = orders.filter(isPlanCandidate);
  const excluded = actual.filter((order) => exclude.has(order.id));
  const afterExclude = actual.filter((order) => !exclude.has(order.id));
  const fitting = afterExclude.filter((order) =>
    orderFitsVehicle(order, vehicle),
  );
  const overweight = afterExclude.length - fitting.length;

  const stats: PlanStats = {
    candidates: actual.length,
    overweight,
    excluded: excluded.length,
  };

  if (fitting.length === 0) return { proposals: [], stats };

  const seen = new Set<string>();
  const proposals: PlannerProposal[] = [];

  for (const variant of PLAN_VARIANTS) {
    const sequence = sequenceOrders(fitting, variant);
    const byId = new Map(fitting.map((order) => [order.id, order]));

    // Прореживание по грузоподъёмности: порядок сохранён, тяжёлое пропускаем
    const chain: PlannerProposalOrder[] = [];
    let weight = 0;
    let volume = 0;
    for (const id of sequence) {
      const order = byId.get(id);
      if (!order) continue;
      const orderWeight = typeof order.weight === "number" ? order.weight : 0;
      const orderVolume = typeof order.volume === "number" ? order.volume : 0;
      if (weight + orderWeight > vehicle.capacity) continue;
      if (vehicle.volume !== null && volume + orderVolume > vehicle.volume)
        continue;
      weight += orderWeight;
      volume += orderVolume;
      chain.push(toProposalOrder(order, now));
    }

    if (chain.length === 0) continue;

    const signature = chain.map((order) => order.id).join("|");
    if (seen.has(signature)) continue;
    seen.add(signature);

    const distanceKm = chain.reduce(
      (sum, order) =>
        sum + (typeof order.distance === "number" ? order.distance : 0),
      0,
    );
    const emptyLegs = countEmptyLegs(chain);

    proposals.push({
      id: `${variant}-${signature.slice(0, 40)}`,
      variant,
      variantTitle: VARIANT_TITLES[variant],
      reason: VARIANT_REASONS[variant],
      orders: chain,
      totalDistanceKm: Math.round(distanceKm),
      totalWeightKg: weight,
      revenueRub: chain.reduce((sum, order) => sum + order.revenueRub, 0),
      emptyLegs,
      routeableCount: chain.filter((order) => !order.needsApproval).length,
      approvalCount: chain.filter((order) => order.needsApproval).length,
      score: scoreProposal(chain, distanceKm, emptyLegs),
    });
  }

  proposals.sort((a, b) => b.score - a.score);
  return { proposals: proposals.slice(0, MAX_PROPOSALS), stats };
}

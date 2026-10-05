// app/api/dispatcher/search/route.ts
//
// GET /api/dispatcher/search?q=…&vehicleId=… — «умный диспетчер».
//
// Запрос словами («завтра из Ярославля тент 20 т, от 65 000 и 45 ₽/км»)
// разбирается в фильтры (lib/dispatcher/query.ts), грузы накопленной базы
// (AtiCache своей организации) ранжируются не просто списком, а с ожидаемой
// прибылью: цена, ₽/км, оценка топлива (расход машины × цена литра из
// последних чеков), прибыль и маржа. Если указана машина — грузы тяжелее
// её грузоподъёмности отсекаются сразу.
//
// Взятие груза в работу — существующий поток POST /api/orders/from-cache.

import { NextRequest, NextResponse } from "next/server";

import { requireStaff } from "@/lib/auth/session";
import { cityStemMatch, parseDispatcherQuery } from "@/lib/dispatcher/query";
import { estimateFuelL } from "@/lib/fleet/fuel";
import { requireOrganization, scopedWhere } from "@/lib/org";
import type { EconomicsExpenseLike } from "@/lib/routes/economics";
import { prisma } from "@/lib/prisma";
import { fuelPriceRubPerL } from "@/lib/routes/economics";

export const dynamic = "force-dynamic";

/** Статусы кэша, которых в подборе быть не должно (включая уже взятые). */
const UNAVAILABLE_CACHE_STATUSES = ["expired", "archived", "taken", "converted"];
/** Расход «по больнице», если ни одна машина организации не указала свой. */
const DEFAULT_CONSUMPTION_PER_100 = 30;
/** Грузоподъёмность по умолчанию для оценки загрузки, кг. */
const DEFAULT_CAPACITY_KG = 20000;
const MAX_CANDIDATES = 30;
const MAX_QUERY_LENGTH = 500;

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request);
  if (!auth.ok) return auth.response;
  const org = requireOrganization(auth.value);
  if (!org.ok) return org.response;

  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").trim();
    if (!q) {
      return NextResponse.json(
        { success: false, error: "Пустой запрос: опишите груз своими словами" },
        { status: 400 },
      );
    }
    if (q.length > MAX_QUERY_LENGTH) {
      return NextResponse.json(
        { success: false, error: `Запрос длиннее ${MAX_QUERY_LENGTH} символов` },
        { status: 400 },
      );
    }
    const vehicleId = searchParams.get("vehicleId")?.trim() || null;

    const parsed = parseDispatcherQuery(q);

    const [caches, fuelExpenses, organizationVehicles, selectedVehicle] =
      await Promise.all([
        prisma.atiCache.findMany({
          where: scopedWhere(org.organizationId, {
            status: { notIn: UNAVAILABLE_CACHE_STATUSES },
          }),
          orderBy: [{ scannedAt: "desc" }],
          take: 500,
        }) as Promise<Record<string, any>[]>,
        prisma.routeExpense.findMany({
          where: scopedWhere(org.organizationId, { type: "fuel" }),
          orderBy: [{ spentAt: "desc" }],
          take: 100,
          select: { type: true, liters: true, amount: true },
        }) as Promise<EconomicsExpenseLike[]>,
        prisma.vehicle.findMany({
          where: scopedWhere(org.organizationId, {}),
          select: { id: true, plate: true, capacity: true, fuelConsumptionPer100: true },
          take: 100,
        }) as Promise<Record<string, any>[]>,
        vehicleId
          ? (prisma.vehicle.findFirst({
              where: scopedWhere(org.organizationId, { id: vehicleId }),
              select: { id: true, plate: true, capacity: true, fuelConsumptionPer100: true },
            }) as Promise<Record<string, any> | null>)
          : Promise.resolve(null),
      ]);

    // Цена литра — из последних топливных чеков организации; нет чеков —
    // прибыль не выдумываем (null), показываем только цену и ₽/км.
    const fuelPrice = fuelPriceRubPerL(fuelExpenses);

    // Расход: выбранная машина → первая машина парка с данными → средняя
    const consumptionVehicle =
      selectedVehicle ??
      organizationVehicles.find(
        (vehicle: Record<string, any>) => Number(vehicle.fuelConsumptionPer100) > 0,
      ) ??
      null;
    const consumption =
      consumptionVehicle && Number(consumptionVehicle.fuelConsumptionPer100) > 0
        ? Number(consumptionVehicle.fuelConsumptionPer100)
        : DEFAULT_CONSUMPTION_PER_100;
    // Грузоподъёмность для оценки загрузки влияет только на коэффициент
    // расхода; лимит по весу проверяется лишь когда машина выбрана явно.
    const capacityKg =
      selectedVehicle && Number(selectedVehicle.capacity) > 0
        ? Number(selectedVehicle.capacity)
        : DEFAULT_CAPACITY_KG;

    const candidates: Record<string, any>[] = [];
    for (const cache of caches) {
      const price =
        typeof cache.price === "number" && cache.price > 0 ? cache.price : null;
      const distanceKm =
        typeof cache.distance === "number" && cache.distance > 0 ? cache.distance : null;
      const weightKg =
        typeof cache.weight === "number" && cache.weight > 0 ? cache.weight : null;
      const loadingDate = cache.loadingDate ? new Date(cache.loadingDate as any) : null;
      const loadingValid =
        loadingDate !== null && !Number.isNaN(loadingDate.getTime()) ? loadingDate : null;

      // Фильтры из запроса
      if (!cityStemMatch(parsed.cityFrom, cache.routeFrom as string)) continue;
      if (!cityStemMatch(parsed.cityTo, cache.routeTo as string)) continue;
      if (parsed.dateFrom && parsed.dateTo) {
        if (!loadingValid) continue;
        if (loadingValid < parsed.dateFrom || loadingValid >= parsed.dateTo) continue;
      }
      if (parsed.truckTypes.length > 0) {
        const truckType = String(cache.truckType ?? "").toLowerCase();
        if (
          !truckType ||
          !parsed.truckTypes.some((key) => truckType.includes(key.slice(0, 4)))
        ) {
          continue;
        }
      }
      if (parsed.weightMinT !== null) {
        if (weightKg === null || weightKg / 1000 < parsed.weightMinT) continue;
      }
      if (parsed.weightMaxT !== null) {
        if (weightKg === null || weightKg / 1000 > parsed.weightMaxT) continue;
      }
      if (parsed.priceMinRub !== null && (price === null || price < parsed.priceMinRub)) {
        continue;
      }
      const rubPerKm =
        price !== null && distanceKm !== null ? Math.round(price / distanceKm) : null;
      if (parsed.rubPerKmMin !== null && (rubPerKm === null || rubPerKm < parsed.rubPerKmMin)) {
        continue;
      }
      // Выбрана конкретная машина — груз не по весу отсекаем сразу
      if (selectedVehicle && weightKg !== null && weightKg > capacityKg) continue;

      const fuelL =
        distanceKm !== null
          ? estimateFuelL(
              { fuelConsumptionPer100: consumption, capacity: capacityKg },
              distanceKm,
              weightKg ?? 0,
            )
          : null;
      const estimatedFuelRub =
        fuelL !== null && fuelPrice !== null ? Math.round(fuelL * fuelPrice) : null;
      const expectedProfitRub =
        price !== null && estimatedFuelRub !== null ? price - estimatedFuelRub : null;
      const marginPercent =
        expectedProfitRub !== null && price !== null
          ? Math.round((expectedProfitRub / price) * 100)
          : null;

      candidates.push({
        cacheId: cache.id,
        routeFrom: cache.routeFrom,
        routeTo: cache.routeTo,
        loadingDate: loadingValid ? loadingValid.toISOString() : null,
        weightKg,
        distanceKm,
        price,
        truckType: cache.truckType ?? null,
        firmName: cache.firmName ?? null,
        rubPerKm,
        estimatedFuelRub,
        expectedProfitRub,
        marginPercent,
      });
    }

    // Ранжирование: сначала прибыль (кто посчитан), потом цена
    candidates.sort((a, b) => {
      const profitA = a.expectedProfitRub ?? Number.NEGATIVE_INFINITY;
      const profitB = b.expectedProfitRub ?? Number.NEGATIVE_INFINITY;
      if (profitB !== profitA) return profitB - profitA;
      return (b.price ?? 0) - (a.price ?? 0);
    });

    return NextResponse.json({
      success: true,
      parsed: {
        cityFrom: parsed.cityFrom,
        cityTo: parsed.cityTo,
        dateFrom: parsed.dateFrom ? parsed.dateFrom.toISOString() : null,
        dateTo: parsed.dateTo ? parsed.dateTo.toISOString() : null,
        dateLabel: parsed.dateLabel,
        truckTypes: parsed.truckTypes,
        weightMinT: parsed.weightMinT,
        weightMaxT: parsed.weightMaxT,
        priceMinRub: parsed.priceMinRub,
        rubPerKmMin: parsed.rubPerKmMin,
      },
      fuelPriceRubPerL: fuelPrice,
      consumptionPer100: consumption,
      vehicle: selectedVehicle
        ? { id: selectedVehicle.id, plate: selectedVehicle.plate }
        : null,
      scanned: caches.length,
      candidates: candidates.slice(0, MAX_CANDIDATES),
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : "Не удалось выполнить подбор груза";
    console.error("[dispatcher] search error:", message);
    return NextResponse.json(
      { success: false, error: "Не удалось выполнить подбор груза" },
      { status: 500 },
    );
  }
}



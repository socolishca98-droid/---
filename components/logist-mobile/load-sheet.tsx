// components/logist-mobile/load-sheet.tsx
//
// Карточка груза: что это за груз и что с ним можно сделать.
//
// Зачем: на экране сборки маршрута грузы были списком текста — «Ярославль →
// Санкт-Петербург, 10 т, 59 266 ₽». Логист видел цифру, но не мог понять, что
// внутри: объём, кузов, дата загрузки, сколько круга получится и что реально
// останется после топлива и работы машины. И не мог ничего нажать — только
// попросить помощника собрать всё сразу.
//
// Здесь два действия, по делу:
//   «Собрать от этого груза» — помощник ставит его первым и достраивает цепочку;
//   «Только этот рейс» — без цепочки: одно плечо, туда и порожняком обратно.
// Второе — ответ на «нет обратки, но ехать надо»: рейс в одну сторону
// считается честно, с пустым ходом домой в деньгах.
//
// Контакты фрахтователя здесь не показываем вовсе: ATI.SU запрещает
// автоматический сбор контактных данных, а фирму логист найдёт по названию.

"use client"

import { ArrowRight, MapPin, Package, Route as RouteIcon, Truck, X } from "lucide-react"

import type { BuilderLoad, BuilderVehicle } from "@/lib/logist-mobile/route-builder"
import { haversineKm, loadedDistanceKm, loadPrice } from "@/lib/logist-mobile/route-builder"
import { formatCount, formatDateShort, formatMoney, shortCity } from "@/lib/logist-mobile/format"
import { estimateFuelL } from "@/lib/fleet/fuel"

export interface LoadSheetProps {
  load: BuilderLoad
  vehicle: BuilderVehicle | null
  /** Цена дизеля, ₽/л */
  fuelPrice: number
  /** Работа машины, ₽/км */
  operatingCostPerKm: number
  /** Точка базы — от неё считаем круг домой */
  basePoint: { lat: number; lng: number } | null
  /** Сколько километров от базы до погрузки (если уже посчитано) */
  kmFromBase: number | null
  onBuildFrom: (load: BuilderLoad) => void
  onBuildOnly: (load: BuilderLoad) => void
  onClose: () => void
}

const ROAD_FACTOR = 1.2

function bodyOf(load: BuilderLoad): string {
  const raw = String(load.truckType ?? "").trim()
  if (!raw) return "кузов не указан"
  // «Тент, Фургон, Контейнеровоз, Кузов #16» — логисту нужно первое слово
  return raw.split(",")[0].trim()
}

function weightOf(load: BuilderLoad): string {
  if (!load.weightKg) return "вес не указан"
  const tons = load.weightKg / 1000
  return `${tons.toFixed(tons < 10 ? 1 : 0).replace(".", ",")} т`
}

export function LoadSheet({
  load,
  vehicle,
  fuelPrice,
  operatingCostPerKm,
  basePoint,
  kmFromBase,
  onBuildFrom,
  onBuildOnly,
  onClose,
}: LoadSheetProps) {
  const price = loadPrice(load)
  const loadedKm = Math.round(loadedDistanceKm(load))
  // Возврат домой — от точки выгрузки. Нет координат — не меньше гружёного
  // плеча: обратная дорога почти никогда не короче прямой.
  const backKm =
    basePoint && load.toPoint
      ? Math.round(haversineKm(basePoint, load.toPoint) * ROAD_FACTOR)
      : loadedKm
  const totalKm = loadedKm + backKm

  // Расход берём из карточки машины: если он не заполнен, деньги честно не
  // считаем (в сборщике то же правило — «прибыль нечем оценить»).
  const fuelLiters =
    vehicle && vehicle.fuelConsumptionPer100
      ? estimateFuelL(
          { ...vehicle, fuelConsumptionPer100: vehicle.fuelConsumptionPer100 },
          loadedKm + backKm,
          load.weightKg ?? 0,
        )
      : null
  const fuelRub = fuelLiters !== null && fuelPrice > 0 ? Math.round(fuelLiters * fuelPrice) : null
  const workRub = vehicle ? Math.round(operatingCostPerKm * totalKm) : null
  const net = price > 0 && fuelRub !== null && workRub !== null ? price - fuelRub - workRub : null
  const perKm = net !== null && totalKm > 0 ? Math.round(net / totalKm) : null
  const emptyShare = Math.round((backKm / Math.max(1, totalKm)) * 100)

  const rows: Array<{ label: string; value: string }> = [
    { label: "Вес", value: weightOf(load) },
    { label: "Кузов", value: bodyOf(load) },
    ...(load.volumeM3 ? [{ label: "Объём", value: `${load.volumeM3} м³` }] : []),
    { label: "Плечо", value: `${loadedKm} ${formatCount(loadedKm, ["километр", "километра", "километров"])}` },
    ...(kmFromBase !== null
      ? [{ label: "От базы", value: `${Math.round(kmFromBase)} км` }]
      : []),
    {
      label: "Загрузка",
      value: load.loadingDate ? `с ${formatDateShort(load.loadingDate)}` : "дата не указана",
    },
    ...(load.firmName ? [{ label: "Фирма", value: load.firmName }] : []),
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center">
      <button
        type="button"
        aria-label="Закрыть карточку груза"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md rounded-t-2xl border border-border bg-card p-4 pb-[calc(16px+env(safe-area-inset-bottom))] shadow-2xl lg:max-w-lg lg:rounded-2xl lg:pb-4"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border lg:hidden" />

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[15.5px] font-semibold leading-snug text-foreground">
              <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {shortCity(load.fromCity)} → {shortCity(load.toCity)}
              </span>
            </p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {price > 0 ? `${formatMoney(price)} за плечо` : "ставка не озвучена"}
              {price > 0 && loadedKm > 0 ? ` · ${Math.round(price / loadedKm)} ₽/км по грузу` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground active:opacity-70"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl border border-border bg-background/40 p-3">
          {rows.map((row) => (
            <div key={row.label} className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{row.label}</p>
              <p className="truncate text-[13px] font-medium text-foreground">{row.value}</p>
            </div>
          ))}
        </div>

        {/* Деньги: сразу видно, что останется и сколько круга пустым */}
        {net !== null ? (
          <div className="mt-3 rounded-xl border border-border p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12.5px] text-muted-foreground">
                Останется после топлива и работы машины
              </span>
              <span
                className={`text-[16px] font-bold ${net > 0 ? "text-success" : "text-destructive"}`}
              >
                {formatMoney(net)}
              </span>
            </div>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
              Круг {totalKm} км, из них {backKm} км порожним ({emptyShare}%).{" "}
              {net <= 0
                ? "В минус: такой рейс не окупается, даже если обратка найдётся."
                : perKm !== null
                  ? `Плотность ${perKm} ₽/км круга.`
                  : ""}
            </p>
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-border p-3 text-[12px] leading-snug text-muted-foreground">
            Деньги не посчитать: нет ставки или не выбрана машина.
          </p>
        )}

        <div className="mt-3 space-y-2">
          <button
            type="button"
            onClick={() => onBuildFrom(load)}
            disabled={price <= 0}
            className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-[14px] font-semibold text-primary-foreground active:opacity-80 disabled:opacity-40"
          >
            <RouteIcon className="h-4 w-4" />
            Собрать маршрут от этого груза
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onBuildOnly(load)}
            disabled={price <= 0}
            className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl border border-border text-[14px] font-medium text-foreground active:opacity-70 disabled:opacity-40"
          >
            <Truck className="h-4 w-4" />
            Только этот рейс, без обратки
          </button>
        </div>

        <p className="mt-2.5 flex items-start gap-1.5 text-[11.5px] leading-snug text-muted-foreground">
          <Package className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          «Только этот рейс» — на случай, когда обратного груза на бирже ещё нет, а ехать надо:
          помощник посчитает пустую дорогу домой в деньгах и не станет выдавать рейс за круглый.
        </p>
      </div>
    </div>
  )
}

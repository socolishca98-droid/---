// app/lm/duty/page.tsx — «Дежурный»: что нового на бирже прямо сейчас.
//
// Не ночная сводка. Грузы выкладывают в течение дня, у каждой компании свой
// график, поэтому дежурный смотрит биржу по интервалу в рабочих часах
// организации и каждый раз отвечает на один вопрос: «что появилось такого,
// из-за чего стоит действовать».
//
// Экран устроен сверху вниз:
//   1. состояние дежурного: смотрел в 09:40, следующий просмотр в 09:55
//      (или честное «сейчас вне рабочих часов — новых грузов в это время
//      почти нет»);
//   2. кнопка «Посмотреть сейчас» — не ждать графика;
//   3. лента «стоит внимания»: обратки под конкретные машины, новые грузы,
//      подорожавшие, уходящие;
//   4. где машины и чего им не хватает (из Казани 31 груз, ни один не влезает).
//
// На компьютере это рабочее место, а не лента телефона: слева лента с
// фильтрами по виду, справа — состояние, машины и путь в настройки. Колонка
// телефона (448 px), растянутая по монитору, — тот же мобильный скриншот,
// только с пустыми полями.

"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowRight,
  BellRing,
  Clock,
  Loader2,
  MapPin,
  RefreshCw,
  Route as RouteIcon,
  Settings2,
  Truck,
} from "lucide-react"
import { toast } from "sonner"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { Card, EmptyState, ErrorState, ListSkeleton, SectionTitle } from "@/components/logist-mobile/ui"
import { apiSend, useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import { formatMoney } from "@/lib/logist-mobile/format"

interface DutyItemDto {
  kind: "backhaul" | "new" | "rate-up" | "expiring"
  atiLoadId: string
  title: string
  note: string
  netRub: number
  netPerKm: number
  load: {
    fromCity: string
    toCity: string
    priceRub: number | null
    weightKg: number | null
    loadingDate: string | null
  }
}

interface DutyHintDto {
  plate: string
  city: string
  kind: "стоит" | "доедет"
  loadsThere: number
  fitting: number
  note: string
}

interface DutyStateDto {
  success: boolean
  due: boolean
  reason: string
  nextAt: string | null
  lastRunAt: string | null
  poolSize: number
  items: DutyItemDto[]
  hints: DutyHintDto[]
  headline: string
  settings: { enabled: boolean; intervalMin: number; fromHour: number; toHour: number }
  error?: string
}

type DutyKind = "backhaul" | "new" | "rate-up" | "expiring"

const KIND_META: Record<DutyKind, { label: string; className: string }> = {
  backhaul: { label: "Обратка", className: "bg-primary/15 text-primary" },
  new: { label: "Новый", className: "bg-secondary text-foreground" },
  "rate-up": { label: "Подорожал", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  expiring: { label: "Скоро уйдёт", className: "bg-destructive/10 text-destructive" },
}

/** Порядок фильтров: сначала то, за чем логист приходит чаще всего. */
const FILTERS: Array<{ key: DutyKind | "all"; label: string }> = [
  { key: "all", label: "Всё" },
  { key: "backhaul", label: "Обратки" },
  { key: "new", label: "Новые" },
  { key: "rate-up", label: "Подорожали" },
  { key: "expiring", label: "Скоро уйдут" },
]

function timeOf(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function plural(count: number, forms: [string, string, string]): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

export default function DutyPage() {
  const { user, isLoading: sessionLoading } = useStaffSession()
  const duty = useJsonApi<DutyStateDto>(user ? "/api/logist/duty" : null)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState<DutyKind | "all">("all")

  const data = duty.data
  const items = useMemo(() => data?.items ?? [], [data])
  const hints = data?.hints ?? []

  const counts = useMemo(() => {
    const byKind: Record<DutyKind, number> = { backhaul: 0, new: 0, "rate-up": 0, expiring: 0 }
    for (const item of items) byKind[item.kind] = (byKind[item.kind] ?? 0) + 1
    return byKind
  }, [items])

  const shownItems = useMemo(
    () => (filter === "all" ? items : items.filter((item) => item.kind === filter)),
    [items, filter],
  )

  /**
   * Состояние одной фразой. Логист должен понимать, работает дежурный или
   * спит, а не догадываться по пустому списку.
   */
  const status = useMemo(() => {
    if (!data) return ""
    if (!data.settings.enabled) return "Дежурный выключен"
    if (data.due) return "Пора посмотреть биржу"
    if (data.nextAt) return `Следующий просмотр ≈ ${timeOf(data.nextAt)}`
    return data.reason
  }, [data])

  const lookNow = async () => {
    setBusy(true)
    // apiSend сам добавляет CSRF-заголовок: без него сервер отвечает 403, и
    // кнопка «Посмотреть» молча не работала бы.
    const result = await apiSend<DutyStateDto & { result?: { itemsCount: number; note: string } }>(
      "/api/logist/duty",
      "POST",
      { force: true },
    )
    setBusy(false)

    if (!result.ok || !result.data?.success) {
      toast.error(result.error || result.data?.error || "Не удалось посмотреть биржу")
      return
    }

    duty.reload()
    const count = result.data.result?.itemsCount ?? 0
    if (count > 0) {
      toast.success(`${count} ${plural(count, ["груз", "груза", "грузов"])} стоит внимания`, {
        description: result.data.result?.note ?? result.data.headline,
      })
    } else {
      toast.message("Нового ничего", {
        description: result.data.headline || "Всё, что есть, дежурный уже показывал",
      })
    }
  }

  const loading = sessionLoading || duty.loading

  /** Состояние и настройки — на компьютере отдельная колонка справа. */
  const statusBlock = data ? (
    <Card className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BellRing className="h-4 w-4 text-primary" />
          <span className="text-[14.5px] font-semibold text-foreground">{status}</span>
        </div>
        <span className="shrink-0 text-[12.5px] text-muted-foreground">
          {data.lastRunAt ? `был ${timeOf(data.lastRunAt)}` : "ещё не смотрел"}
        </span>
      </div>
      <p className="text-[13px] leading-snug text-muted-foreground">{data.reason}</p>

      {/* Короткая сводка: сколько чего в ленте. На компьютере видно сразу,
          на телефоне — до первого экрана ленты. */}
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
          <span className="font-medium text-foreground">
            {items.length} {plural(items.length, ["груз", "груза", "грузов"])} в ленте
          </span>
          {counts.backhaul > 0 ? <span>обраток: {counts.backhaul}</span> : null}
          {counts["rate-up"] > 0 ? <span>подорожали: {counts["rate-up"]}</span> : null}
          {counts.expiring > 0 ? <span>уходят: {counts.expiring}</span> : null}
        </div>
      ) : null}

      <p className="text-[12px] leading-snug text-muted-foreground">
        Смотрит каждые {data.settings.intervalMin > 0 ? `${data.settings.intervalMin} мин` : "—"} в рабочие
        часы {String(data.settings.fromHour).padStart(2, "0")}:00–
        {String(data.settings.toHour).padStart(2, "0")}:00. Ночью дежурный не бегает: грузы выкладывают
        днём. {data.poolSize > 0 ? `В базе ${data.poolSize} грузов.` : ""}
      </p>

      <Link
        href="/lm/settings#duty"
        className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-border text-[13px] font-medium text-foreground active:opacity-70 lg:min-h-[36px]"
      >
        <Settings2 className="h-3.5 w-3.5" /> Настроить дежурного
      </Link>
    </Card>
  ) : null

  const vehiclesBlock =
    hints.length > 0 ? (
      <div className="space-y-2">
        <SectionTitle title="Где машины" />
        {hints.map((hint) => (
          <div
            key={`${hint.plate}-${hint.city}`}
            className="flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 shadow-sm"
          >
            <Truck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-foreground">
                {hint.plate} → {hint.city}
              </p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{hint.note}</p>
            </div>
          </div>
        ))}
      </div>
    ) : null

  return (
    <div className="min-h-screen bg-background pb-24">
      <LogistHeader
        title="Дежурный"
        subtitle={data ? `В базе ${data.poolSize} грузов` : "Смотрит биржу по графику"}
        back
        userName={user?.name ?? null}
        action={
          <button
            type="button"
            onClick={() => void lookNow()}
            disabled={busy}
            className="flex h-9 items-center gap-1.5 rounded-full bg-primary/15 px-3 text-[12.5px] font-medium text-primary active:opacity-70 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Посмотреть
          </button>
        }
      />

      <main className="mx-auto max-w-md px-4 pt-4 lg:max-w-none lg:px-0">
        {loading ? <ListSkeleton rows={4} /> : null}

        {!loading && duty.error ? (
          <ErrorState message={duty.error} onRetry={() => duty.reload()} />
        ) : null}

        {!loading && data ? (
          <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6">
            {/* Лента — главное. На телефоне идёт второй, после состояния. */}
            <div className="order-2 space-y-3 lg:order-1">
              <SectionTitle
                title="Стоит внимания"
                action={
                  items.length > 0 ? (
                    <Link href="/lm/routes/assistant" className="text-[13px] font-medium text-primary">
                      Собрать маршрут
                    </Link>
                  ) : null
                }
              />

              {/* Фильтры по виду: на компьютере это экономит прокрутку.
                  Показываем только те виды, которые сегодня есть. */}
              {items.length > 1 ? (
                <div className="flex flex-wrap gap-1.5">
                  {FILTERS.filter(
                    (item) =>
                      item.key === "all" ||
                      counts[item.key as DutyKind] > 0,
                  ).map((item) => {
                    const active = filter === item.key
                    const count =
                      item.key === "all" ? items.length : counts[item.key as DutyKind]
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setFilter(item.key)}
                        className={`rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                          active
                            ? "bg-primary text-primary-foreground"
                            : "border border-border bg-card text-muted-foreground active:opacity-70"
                        }`}
                      >
                        {item.label} · {count}
                      </button>
                    )
                  })}
                </div>
              ) : null}

              {items.length === 0 ? (
                <EmptyState
                  icon={<Clock className="h-6 w-6" />}
                  title="Пока пусто"
                  description={
                    data.settings.enabled
                      ? "Дежурный покажет груз, как только он появится на бирже — и только если он влезает в машину и оставляет деньги после топлива и работы машины."
                      : "Включите дежурного в настройках организации — и он начнёт следить за биржей сам."
                  }
                />
              ) : shownItems.length === 0 ? (
                <EmptyState
                  icon={<Clock className="h-6 w-6" />}
                  title="В этом виде сейчас пусто"
                  description="Переключите фильтр — остальные грузы никуда не делись."
                />
              ) : (
                <div className="space-y-2.5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
                  {shownItems.map((item) => {
                    const meta = KIND_META[item.kind] ?? KIND_META.new
                    return (
                      <div
                        key={item.atiLoadId}
                        className="rounded-xl border border-border bg-card p-3.5 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.className}`}
                            >
                              {meta.label}
                            </span>
                            <p className="mt-1.5 text-[14.5px] font-semibold leading-snug text-foreground">
                              {item.title}
                            </p>
                            <p className="mt-1 flex items-center gap-1 text-[12.5px] text-muted-foreground">
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span className="truncate">
                                {item.load.fromCity} → {item.load.toCity}
                              </span>
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-[15px] font-bold text-foreground">
                              {formatMoney(item.netRub)}
                            </p>
                            <p className="text-[11.5px] text-muted-foreground">останется</p>
                          </div>
                        </div>
                        <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground">{item.note}</p>
                        <Link
                          href={`/lm/routes/assistant?keep=${encodeURIComponent(item.atiLoadId)}`}
                          className="mt-2.5 flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-lg border border-border text-[13px] font-medium text-foreground active:opacity-70"
                        >
                          <RouteIcon className="h-3.5 w-3.5" /> Собрать вокруг этого груза
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Правая колонка: состояние, машины, настройки. */}
            <div className="order-1 space-y-3 lg:order-2 lg:sticky lg:top-4">
              {statusBlock}
              {vehiclesBlock}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  )
}

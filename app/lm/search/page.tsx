// app/lm/search/page.tsx — поиск грузов с телефона.
//
// Два источника, как и в полной версии: своя накопленная база (бесплатно,
// наполняется плановыми сканами) и живой запрос на ATI.su (тратит лимиты
// токена — поэтому отдельной вкладкой).
//
// «Взять в работу» создаёт заказ организации на этапе «Поиск» и сразу открывает
// его карточку — на телефоне не хочется искать созданный заказ руками.

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Database, Loader2, MapPin, Package, Phone, PhoneCall, Search, Sparkles, X, Zap } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { ActionButton, Card, EmptyState, ErrorState, ListSkeleton, SectionTitle } from "@/components/logist-mobile/ui"
import { apiSend } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import type { MobileAtiLoad, MobileAtiStats } from "@/lib/logist-mobile/types"
import { formatKm, formatMoney, formatWeightKg, shortCity } from "@/lib/logist-mobile/format"

interface GeoCity {
  id: number | string
  name: string
  region: string | null
  fullName: string
}

const HARVEST_MODES = [
  { id: "fast", label: "⚡ Быстрый" },
  { id: "normal", label: "🚂 Обычный" },
  { id: "deep", label: "🔥 Глубокий" },
]

export default function LogistSearchPage() {
  const router = useRouter()
  const { user } = useStaffSession()
  const [tab, setTab] = useState<"base" | "live">("base")

  // --- своя база ---
  const [stats, setStats] = useState<MobileAtiStats | null>(null)
  const [loads, setLoads] = useState<MobileAtiLoad[]>([])
  const [total, setTotal] = useState(0)
  /** Когда последний раз обновлялась биржа (автообновление на сервере) */
  const [lastScanAt, setLastScanAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [taking, setTaking] = useState<string | null>(null)
  const [harvesting, setHarvesting] = useState(false)
  const [harvestMode, setHarvestMode] = useState("normal")

  const loadBase = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ status: "new", limit: "50" })
      if (query.trim().length >= 2) params.set("search", query.trim())
      const [listRes, statsRes] = await Promise.all([
        // /api/ati/loads — тот же кэш, но с автообновлением: если данные
        // устарели, сервер сам сходит в ATI и вернёт свежий список
        fetch(`/api/ati/loads?${params.toString()}`),
        fetch("/api/ati/cache?stats=true"),
      ])
      const listData = await listRes.json()
      const statsData = await statsRes.json()
      if (!listRes.ok) throw new Error(listData?.error || "Не удалось загрузить базу")
      setLoads((listData?.items ?? []) as MobileAtiLoad[])
      setTotal(Number(listData?.total ?? 0))
      setLastScanAt((listData?.lastScanAt as string | null) ?? null)
      setStats(statsData as MobileAtiStats)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки")
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    if (!user) return
    const timer = setTimeout(() => void loadBase(), query ? 350 : 0)
    return () => clearTimeout(timer)
  }, [user, query, loadBase])

  // --- живой поиск ---
  const [from, setFrom] = useState<GeoCity | null>(null)
  const [to, setTo] = useState<GeoCity | null>(null)
  const [fromRadius, setFromRadius] = useState("100")
  const [weightMin, setWeightMin] = useState("")
  const [weightMax, setWeightMax] = useState("")
  const [scanning, setScanning] = useState(false)
  const [results, setResults] = useState<MobileAtiLoad[]>([])
  /**
   * Где искать один груз: площадки организации, общая биржа или оба сразу.
   * Без этого экран показывал только площадки — по региону базы это 45
   * грузов вместо 297, и взять груз с общей биржи было невозможно.
   */
  const [source, setSource] = useState<"boards" | "exchange" | "both">("both")
  /** Сколько нашли с каждого источника и что биржа обещает по фильтру */
  const [bySource, setBySource] = useState<{ boards: number; exchange: number } | null>(null)
  /**
   * Масштаб выдачи со стороны ATI: сколько грузов биржа обещает по фильтру
   * и до какой страницы мы дошли. Без этого экран показывал «Найдено: 106»
   * и молчал, что по фильтру их 187, — то есть врал о полноте выдачи.
   */
  const [searchMeta, setSearchMeta] = useState<{
    totalItems: number | null
    nextPageStart: number | null
  } | null>(null)
  /** Биржа отдала всё, что показывает по фильтру — дальше кнопка не поможет */
  const [deepEnd, setDeepEnd] = useState<string | null>(null)
  const [searchWarning, setSearchWarning] = useState<string | null>(null)

  async function takeLoad(load: MobileAtiLoad) {
    setTaking(load.id)
    const result = await apiSend<{ order?: { id: string }; message?: string; contacts?: { phone?: string | null } }>(
      "/api/orders/from-cache",
      "POST",
      {
        cacheId: load.id,
        // fetchContacts НЕ передаём намеренно: ATI.SU делает замечания за
        // автоматический сбор контактных данных. Телефон фрахтователя
        // добирается отдельной кнопкой «Узнать телефон», когда логист сам
        // решает звонить.
      },
    )
    setTaking(null)

    if (!result.ok) {
      toast.error(result.error || "Не удалось взять груз")
      return
    }
    const orderId = result.data?.order?.id
    // Телефона здесь может не быть: он не тянется автоматически. Если он
    // уже был добыт кнопкой «Узнать телефон» раньше — он в грузе.
    const phone = load.contactPhone ?? null
    toast.success(phone ? `Груз взят · тел. ${phone}` : "Груз взят в работу")
    if (orderId) router.push(`/lm/orders/${orderId}`)
  }

  async function runLiveSearch(pageStart?: number) {
    if (!from) {
      toast.error("Выберите город отправления")
      return
    }
    setScanning(true)
    // «Показать ещё» дописывает к экрану: биржа отдаёт страницами примерно
    // по 12 грузов, один заход показывает только первую двадцатку.
    if (!pageStart) {
      setResults([])
      setDeepEnd(null)
    }
    try {
      const res = await fetch("/api/ati/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manualMode: true,
          source,
          fromGeo: { id: from.id, name: from.name, fullName: from.fullName, region: from.region },
          toGeo: to ? { id: to.id, name: to.name, fullName: to.fullName, region: to.region } : null,
          fromRadius: Number(fromRadius) || 100,
          toRadius: Number(fromRadius) || 100,
          // С какой страницы биржи продолжать — только для «Показать ещё»
          pageStart: pageStart ?? undefined,
          filters: {
            minWeight: Number(weightMin) * 1000 || undefined,
            maxWeight: Number(weightMax) * 1000 || undefined,
          },
        }),
      })
      const data = await res.json()
      if (data?.success) {
        const incoming = ((data.loads ?? []) as MobileAtiLoad[])
        setResults((prev) => {
          if (!pageStart) return incoming
          const seen = new Set(prev.map((item) => item.id))
          return [...prev, ...incoming.filter((item) => !seen.has(item.id))]
        })
        setBySource(data.bySource ?? null)
        // Попросили продолжение — биржа не отдала ничего: значит страницы
        // кончились. Говорим это словами, а не показываем кнопку, которая
        // вернёт пустоту. Счётчики продолжение не приносит, поэтому
        // «обещанное» число берём из прошлого ответа.
        const ended = Boolean(pageStart && incoming.length === 0)
        const promised = data.totalItems ?? searchMeta?.totalItems ?? null
        if (ended) {
          setDeepEnd(
            `Биржа отдала всё, что показывает по этому фильтру. Обещанные ${promised ?? "?"} — её оценка, дальше страницы не отдаёт.`,
          )
        }
        setSearchMeta((prev) => ({
          totalItems: promised ?? prev?.totalItems ?? null,
          nextPageStart: ended ? null : data.nextPageStart ?? null,
        }))
        // Источники независимы: если общая биржа не ответила, молчать нельзя
        const errs = (data.errors ?? []).filter(Boolean)
        setSearchWarning(errs.length > 0 ? errs.join(" ") : null)
        toast.success(`Найдено: ${data.found ?? 0}`)
        void loadBase()
      } else if (data?.code === "ati_not_connected") {
        toast.error("Аккаунт ATI.SU не подключён — подключите в полной версии (Организация)")
      } else {
        toast.warning(data?.error || "Ничего не найдено")
      }
    } catch {
      toast.error("Ошибка поиска")
    } finally {
      setScanning(false)
    }
  }

  async function runHarvester() {
    setHarvesting(true)
    try {
      const res = await fetch("/api/ati/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manualMode: false,
          mode: harvestMode,
          source: "both",
          filters: { minDistance: 50 },
        }),
      })
      const data = await res.json()
      if (data?.success) {
        // Честный итог сбора: найдено / легло новых / обновлено. Раньше экран
        // писал «сохранено: 195», считая все найденные строки, — и при нуле
        // новых грузов выглядело как удачная сборка.
        const found = data.found ?? 0
        const added = data.count ?? 0
        const refreshed = data.updated ?? 0
        toast.success(
          added > 0
            ? `Собрано: найдено ${found}, новых ${added}, обновлено ${refreshed}`
            : `Новых грузов нет: проверено ${found}, всё уже в базе`,
        )
        void loadBase()
      } else if (data?.code === "ati_not_connected") {
        toast.error("Аккаунт ATI.SU не подключён")
      } else {
        toast.error(data?.error || "Сбой сборщика")
      }
    } catch {
      toast.error("Сбой сборщика")
    } finally {
      setHarvesting(false)
    }
  }

  return (
    <>
      <LogistHeader
        title="Поиск грузов"
        subtitle={stats ? `В базе ${stats.new} новых из ${stats.total}` : undefined}
        userName={user?.name}
      />

      <div className="sticky top-[calc(57px+env(safe-area-inset-top))] z-20 border-b border-border surface-glass px-4 py-3 backdrop-blur">
        <div className="flex gap-2">
          <TabButton active={tab === "base"} onClick={() => setTab("base")} icon={<Database className="h-4 w-4" />}>
            Своя база{stats ? ` (${stats.new})` : ""}
          </TabButton>
          <TabButton active={tab === "live"} onClick={() => setTab("live")} icon={<Zap className="h-4 w-4" />}>
            Живой поиск ATI
          </TabButton>
        </div>
      </div>

      {tab === "base" ? (
        <div className="px-4 pt-3.5">
          {lastScanAt ? (
            <p className="mb-2 text-center text-[11px] text-muted-foreground">
              Биржа обновлена{" "}
              {new Date(lastScanAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} — открытие экрана само подтягивает свежие грузы
            </p>
          ) : null}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              inputMode="search"
              placeholder="Поиск по бирже"
              className="h-11 w-full rounded-xl border border-border bg-secondary pl-9 pr-9 text-[15px] text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Очистить"
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground active:opacity-70"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            <select
              value={harvestMode}
              onChange={(event) => setHarvestMode(event.target.value)}
              className="h-10 flex-1 rounded-xl border border-border bg-secondary px-3 text-[13.5px] text-foreground"
            >
              {HARVEST_MODES.map((mode) => (
                <option key={mode.id} value={mode.id} className="bg-background">
                  {mode.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void runHarvester()}
              disabled={harvesting}
              className="flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-[13.5px] font-semibold text-primary-foreground active:opacity-70 disabled:opacity-50"
            >
              {harvesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Собрать
            </button>
          </div>

          <div className="mt-3 space-y-2.5">
            {error ? (
              <ErrorState message={error} onRetry={() => void loadBase()} />
            ) : loading && loads.length === 0 ? (
              <ListSkeleton rows={3} />
            ) : loads.length === 0 ? (
              <EmptyState
                icon={<Package className="h-6 w-6" />}
                title="В своей базе пусто"
                description="Нажмите «Собрать» — или поищите по живому ATI на соседней вкладке"
              />
            ) : (
              <>
                <p className="px-1 text-[12.5px] text-muted-foreground">
                  Показаны {loads.length} из {total}
                </p>
                {loads.map((load) => (
                  <LoadCard key={load.id} load={load} busy={taking === load.id} onTake={() => void takeLoad(load)} />
                ))}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="px-4 pt-3.5">
          <Card className="space-y-3">
            <CityField label="Откуда" value={from} onChange={setFrom} placeholder="Город отправления" />
            <CityField label="Куда" value={to} onChange={setTo} placeholder="Любой город (можно не заполнять)" />

            <div>
              <p className="mb-1.5 text-[11.5px] text-muted-foreground">Где искать</p>
              <div className="flex gap-1.5">
                {(
                  [
                    ["both", "Всё"],
                    ["boards", "Площадки"],
                    ["exchange", "Общая биржа"],
                  ] as Array<["boards" | "exchange" | "both", string]>
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSource(value)}
                    className={`min-h-[36px] flex-1 rounded-lg border text-[12.5px] active:opacity-70 ${
                      source === value
                        ? "border-primary/40 bg-primary/15 text-primary"
                        : "border-border text-foreground/90"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
                «Площадки» — организации, где мы участник. «Общая биржа» — все грузы ATI, как на
                сайте. «Всё» — оба источника, дубли убираются.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <SmallField label="Радиус, км" value={fromRadius} onChange={setFromRadius} inputMode="numeric" />
              <SmallField label="Вес от, т" value={weightMin} onChange={setWeightMin} inputMode="decimal" />
              <SmallField label="Вес до, т" value={weightMax} onChange={setWeightMax} inputMode="decimal" />
            </div>
            <p className="text-[12px] text-muted-foreground">
              Живой запрос тратит лимиты подключённого аккаунта ATI.SU — пользуйтесь, когда в своей базе пусто.
            </p>
            <ActionButton tone="primary" full onClick={() => void runLiveSearch()} disabled={scanning}>
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Искать в ATI
            </ActionButton>
          </Card>

          {searchWarning ? (
            <p className="mb-2 rounded-xl border border-border bg-card px-3 py-2 text-[12px] leading-snug text-muted-foreground">
              {searchWarning}
            </p>
          ) : null}

          {results.length > 0 ? (
            <>
              <SectionTitle
                title={
                  bySource && bySource.boards + bySource.exchange !== results.length
                    ? `Найдено: ${results.length} — с площадок ${bySource.boards}, с биржи ${bySource.exchange}`
                    : `Найдено: ${results.length}`
                }
              />
              {searchMeta?.totalItems ? (
                <p className="-mt-1 px-1 text-[12.5px] text-muted-foreground">
                  ATI обещает по такому фильтру {searchMeta.totalItems} — показано {results.length}
                </p>
              ) : null}
              <div className="space-y-2.5">
                {results.map((load) => (
                  <LoadCard key={load.id} load={load} busy={taking === load.id} onTake={() => void takeLoad(load)} />
                ))}
              </div>
              {deepEnd ? (
                <p className="px-1 text-[12px] leading-snug text-muted-foreground">{deepEnd}</p>
              ) : null}
              {searchMeta?.nextPageStart && searchMeta.totalItems && results.length < searchMeta.totalItems ? (
                <ActionButton
                  tone="default"
                  full
                  onClick={() => void runLiveSearch(searchMeta.nextPageStart ?? undefined)}
                  disabled={scanning}
                >
                  {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  Показать ещё
                </ActionButton>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border text-[13.5px] font-medium ${
        active ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-card shadow-sm text-muted-foreground"
      }`}
    >
      {icon}
      {children}
    </button>
  )
}

/** Одна карточка груза — общая для своей базы и живого поиска. */
function LoadCard({
  load,
  busy,
  onTake,
}: {
  load: MobileAtiLoad
  busy: boolean
  onTake: () => void
}) {
  // Контакты фрахтователя — ТОЛЬКО по нажатию. ATI.SU запрещает
  // автоматизированный сбор контактной информации (пользовательское
  // соглашение, п. 3.2.1.7), поэтому телефон не тянем сами: диспетчер
  // нажимает кнопку — уходит один запрос, ровно как на сайте ATI.
  const [contactBusy, setContactBusy] = useState(false)
  const [contact, setContact] = useState<{ phone: string | null; name: string | null; email: string | null } | null>(
    load.contactPhone ? { phone: load.contactPhone, name: load.contactName, email: null } : null,
  )

  async function askContacts() {
    setContactBusy(true)
    try {
      const result = await apiSend<{ phone: string | null; name: string | null; email: string | null }>(
        "/api/ati/loads/contacts",
        "POST",
        { cacheId: load.id },
      )
      if (result.ok && result.data?.phone) {
        setContact({ phone: result.data.phone, name: result.data.name, email: result.data.email })
        toast.success("Контакт фрахтователя получен")
      } else {
        toast.error(result.error ?? "ATI не отдала контакт")
      }
    } catch {
      toast.error("Не удалось получить контакт")
    } finally {
      setContactBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-[15px] font-semibold text-foreground">
          {shortCity(load.routeFrom)} → {shortCity(load.routeTo)}
        </p>
        <p className="shrink-0 text-[15px] font-semibold text-success">{formatMoney(load.price)}</p>
      </div>

      <p className="mt-1.5 text-[12.5px] text-muted-foreground">
        {[
          load.distance ? formatKm(load.distance) : null,
          load.weight ? formatWeightKg(load.weight) : null,
          load.cargoType,
          load.truckType,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      {load.source ? (
        <p className="mt-1 text-[11.5px] text-muted-foreground/80">
          {load.source === "exchange" ? "Общая биржа ATI" : "Площадка организации"}
        </p>
      ) : null}

      {load.firmName || load.contactName ? (
        <p className="mt-1 flex items-center gap-1.5 truncate text-[12.5px] text-muted-foreground">
          <Phone className="h-3.5 w-3.5 shrink-0" />
          {[load.firmName, load.contactName, load.contactPhone].filter(Boolean).join(" · ")}
        </p>
      ) : null}

      {load.routeFrom || load.routeTo ? (
        <p className="mt-1 flex items-start gap-1.5 text-[12px] text-muted-foreground/80">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="line-clamp-2">
            {load.routeFrom} → {load.routeTo}
          </span>
        </p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onTake}
          disabled={busy}
          className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-[14px] font-semibold text-primary-foreground active:opacity-70 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
          Взять в работу
        </button>
        <button
          type="button"
          onClick={() => void askContacts()}
          disabled={contactBusy || Boolean(contact)}
          title="Показать контакт фрахтователя — один запрос в ATI по вашему нажатию"
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-border px-3 text-[13px] text-foreground active:opacity-70 disabled:opacity-50"
        >
          {contactBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
          {contact ? "Контакты есть" : "Контакты"}
        </button>
      </div>
      {contact?.phone ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <a
            href={`tel:${contact.phone}`}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-success/40 bg-success/10 px-3 text-[13.5px] font-medium text-success active:opacity-70"
          >
            <Phone className="h-4 w-4" />
            {contact.phone}
          </a>
          {contact.email ? (
            <a
              href={`mailto:${contact.email}`}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-border px-3 text-[13px] text-foreground active:opacity-70"
            >
              {contact.email}
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** Поле выбора города с подсказками из справочника ATI. */
function CityField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: GeoCity | null
  onChange: (value: GeoCity | null) => void
  placeholder: string
}) {
  const [text, setText] = useState("")
  const [suggestions, setSuggestions] = useState<GeoCity[]>([])
  const [loadingSuggest, setLoadingSuggest] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (value || text.trim().length < 2) {
      setSuggestions([])
      return
    }
    timerRef.current = setTimeout(async () => {
      setLoadingSuggest(true)
      try {
        const res = await fetch(`/api/ati/geo?q=${encodeURIComponent(text.trim())}`)
        const data = await res.json()
        setSuggestions(Array.isArray(data) ? (data as GeoCity[]).slice(0, 6) : [])
      } catch {
        setSuggestions([])
      } finally {
        setLoadingSuggest(false)
      }
    }, 350)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [text, value])

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3.5 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="block text-[11.5px] text-primary/80">{label}</span>
          <span className="block truncate text-[14px] text-foreground">{value.fullName}</span>
        </span>
        <button
          type="button"
          onClick={() => {
            onChange(null)
            setText("")
          }}
          className="flex h-8 w-8 items-center justify-center rounded-full text-primary active:opacity-70"
          aria-label="Убрать город"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div>
      <label className="mb-1 block text-[11.5px] text-muted-foreground">{label}</label>
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-border bg-secondary px-3.5 text-[15px] text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
      />
      {suggestions.length > 0 ? (
        <div className="mt-1.5 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {suggestions.map((city) => (
            <button
              key={city.id}
              type="button"
              onClick={() => {
                onChange(city)
                setSuggestions([])
              }}
              className="block w-full px-3.5 py-2.5 text-left text-[13.5px] text-foreground active:opacity-70"
            >
              {city.fullName}
            </button>
          ))}
        </div>
      ) : null}

      {/* Города нет в справочнике живого поиска. ATI принимает в фильтре
          только числовой id своего словаря населённых пунктов, и по названию
          город не резолвится никак — поэтому врать «ничего не найдено» нельзя,
          надо сказать прямо и показать, где груз всё равно можно взять. */}
      {!value && text.trim().length >= 3 && suggestions.length === 0 && !loadingSuggest ? (
        <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
          «{text.trim()}» нет в справочнике ATI для живого поиска — биржа принимает только
          id своего словаря населённых пунктов и по названию город не ищет. Найдите груз во
          вкладке «Своя база»: там поиск по любому названию, и брать груз можно так же.
        </p>
      ) : null}
    </div>
  )
}

function SmallField({
  label,
  value,
  onChange,
  inputMode,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  inputMode: "numeric" | "decimal"
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={inputMode}
        className="h-11 w-full rounded-xl border border-border bg-secondary px-3 text-[15px] text-foreground focus:border-primary/50 focus:outline-none"
      />
    </label>
  )
}

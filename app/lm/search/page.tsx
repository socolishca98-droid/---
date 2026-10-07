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
import { Database, Loader2, MapPin, Package, Phone, Search, Sparkles, X, Zap } from "lucide-react"

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
      const params = new URLSearchParams({ status: "new", limit: "50", sortBy: "scannedAt", sortOrder: "desc" })
      if (query.trim().length >= 2) params.set("search", query.trim())
      const [listRes, statsRes] = await Promise.all([
        fetch(`/api/ati/cache?${params.toString()}`),
        fetch("/api/ati/cache?stats=true"),
      ])
      const listData = await listRes.json()
      const statsData = await statsRes.json()
      if (!listRes.ok) throw new Error(listData?.error || "Не удалось загрузить базу")
      setLoads((listData?.items ?? []) as MobileAtiLoad[])
      setTotal(Number(listData?.total ?? 0))
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

  async function takeLoad(load: MobileAtiLoad) {
    setTaking(load.id)
    const result = await apiSend<{ order?: { id: string }; message?: string; contacts?: { phone?: string | null } }>(
      "/api/orders/from-cache",
      "POST",
      { cacheId: load.id, fetchContacts: true },
    )
    setTaking(null)

    if (!result.ok) {
      toast.error(result.error || "Не удалось взять груз")
      return
    }
    const orderId = result.data?.order?.id
    const phone = result.data?.contacts?.phone ?? load.contactPhone
    toast.success(phone ? `Груз взят · тел. ${phone}` : "Груз взят в работу")
    if (orderId) router.push(`/lm/orders/${orderId}`)
  }

  async function runLiveSearch() {
    if (!from) {
      toast.error("Выберите город отправления")
      return
    }
    setScanning(true)
    setResults([])
    try {
      const res = await fetch("/api/ati/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manualMode: true,
          fromGeo: { id: from.id, name: from.name, fullName: from.fullName, region: from.region },
          toGeo: to ? { id: to.id, name: to.name, fullName: to.fullName, region: to.region } : null,
          fromRadius: Number(fromRadius) || 100,
          toRadius: Number(fromRadius) || 100,
          filters: {
            minWeight: Number(weightMin) * 1000 || undefined,
            maxWeight: Number(weightMax) * 1000 || undefined,
          },
        }),
      })
      const data = await res.json()
      if (data?.success) {
        setResults((data.loads ?? []) as MobileAtiLoad[])
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
        body: JSON.stringify({ manualMode: false, mode: harvestMode, filters: { minDistance: 50 } }),
      })
      const data = await res.json()
      if (data?.success) {
        toast.success(`Собрано: ${data.found ?? 0}, сохранено: ${data.count ?? 0}`)
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

      <div className="sticky top-[57px] z-20 border-b border-white/8 bg-[#0b0b0e]/95 px-4 py-3 backdrop-blur">
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
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              inputMode="search"
              placeholder="Город, груз, фирма"
              className="h-11 w-full rounded-xl border border-white/8 bg-white/[0.04] pl-9 pr-9 text-[15px] text-white placeholder:text-zinc-500 focus:border-orange-500/50 focus:outline-none"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Очистить"
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-zinc-400 active:bg-white/8"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            <select
              value={harvestMode}
              onChange={(event) => setHarvestMode(event.target.value)}
              className="h-10 flex-1 rounded-xl border border-white/8 bg-white/[0.04] px-3 text-[13.5px] text-white"
            >
              {HARVEST_MODES.map((mode) => (
                <option key={mode.id} value={mode.id} className="bg-[#0b0b0e]">
                  {mode.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void runHarvester()}
              disabled={harvesting}
              className="flex h-10 items-center gap-2 rounded-xl bg-orange-500 px-4 text-[13.5px] font-semibold text-white active:bg-orange-600 disabled:opacity-50"
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
                <p className="px-1 text-[12.5px] text-zinc-500">
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
            <div className="grid grid-cols-3 gap-2.5">
              <SmallField label="Радиус, км" value={fromRadius} onChange={setFromRadius} inputMode="numeric" />
              <SmallField label="Вес от, т" value={weightMin} onChange={setWeightMin} inputMode="decimal" />
              <SmallField label="Вес до, т" value={weightMax} onChange={setWeightMax} inputMode="decimal" />
            </div>
            <p className="text-[12px] text-zinc-500">
              Живой запрос тратит лимиты подключённого аккаунта ATI.SU — пользуйтесь, когда в своей базе пусто.
            </p>
            <ActionButton tone="primary" full onClick={() => void runLiveSearch()} disabled={scanning}>
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Искать в ATI
            </ActionButton>
          </Card>

          {results.length > 0 ? (
            <>
              <SectionTitle title={`Найдено: ${results.length}`} />
              <div className="space-y-2.5">
                {results.map((load) => (
                  <LoadCard key={load.id} load={load} busy={taking === load.id} onTake={() => void takeLoad(load)} />
                ))}
              </div>
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
        active ? "border-orange-500/40 bg-orange-500/15 text-orange-300" : "border-white/8 bg-white/[0.03] text-zinc-400"
      }`}
    >
      {icon}
      {children}
    </button>
  )
}

/** Одна карточка груза — общая для своей базы и живого поиска. */
function LoadCard({ load, busy, onTake }: { load: MobileAtiLoad; busy: boolean; onTake: () => void }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-[15px] font-semibold text-white">
          {shortCity(load.routeFrom)} → {shortCity(load.routeTo)}
        </p>
        <p className="shrink-0 text-[15px] font-semibold text-emerald-300">{formatMoney(load.price)}</p>
      </div>

      <p className="mt-1.5 text-[12.5px] text-zinc-400">
        {[
          load.distance ? formatKm(load.distance) : null,
          load.weight ? formatWeightKg(load.weight) : null,
          load.cargoType,
          load.truckType,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      {load.firmName || load.contactName ? (
        <p className="mt-1 flex items-center gap-1.5 truncate text-[12.5px] text-zinc-500">
          <Phone className="h-3.5 w-3.5 shrink-0" />
          {[load.firmName, load.contactName, load.contactPhone].filter(Boolean).join(" · ")}
        </p>
      ) : null}

      {load.routeFrom || load.routeTo ? (
        <p className="mt-1 flex items-start gap-1.5 text-[12px] text-zinc-600">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="line-clamp-2">
            {load.routeFrom} → {load.routeTo}
          </span>
        </p>
      ) : null}

      <button
        type="button"
        onClick={onTake}
        disabled={busy}
        className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-orange-500 text-[14px] font-semibold text-white active:bg-orange-600 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
        Взять в работу
      </button>
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (value || text.trim().length < 2) {
      setSuggestions([])
      return
    }
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/ati/geo?q=${encodeURIComponent(text.trim())}`)
        const data = await res.json()
        setSuggestions(Array.isArray(data) ? (data as GeoCity[]).slice(0, 6) : [])
      } catch {
        setSuggestions([])
      }
    }, 350)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [text, value])

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-orange-500/30 bg-orange-500/10 px-3.5 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="block text-[11.5px] text-orange-300/80">{label}</span>
          <span className="block truncate text-[14px] text-white">{value.fullName}</span>
        </span>
        <button
          type="button"
          onClick={() => {
            onChange(null)
            setText("")
          }}
          className="flex h-8 w-8 items-center justify-center rounded-full text-orange-200 active:bg-white/10"
          aria-label="Убрать город"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div>
      <label className="mb-1 block text-[11.5px] text-zinc-500">{label}</label>
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-white/8 bg-white/[0.04] px-3.5 text-[15px] text-white placeholder:text-zinc-500 focus:border-orange-500/50 focus:outline-none"
      />
      {suggestions.length > 0 ? (
        <div className="mt-1.5 overflow-hidden rounded-xl border border-white/8 bg-[#111114]">
          {suggestions.map((city) => (
            <button
              key={city.id}
              type="button"
              onClick={() => {
                onChange(city)
                setSuggestions([])
              }}
              className="block w-full px-3.5 py-2.5 text-left text-[13.5px] text-zinc-200 active:bg-white/8"
            >
              {city.fullName}
            </button>
          ))}
        </div>
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
      <span className="mb-1 block text-[11.5px] text-zinc-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={inputMode}
        className="h-11 w-full rounded-xl border border-white/8 bg-white/[0.04] px-3 text-[15px] text-white focus:border-orange-500/50 focus:outline-none"
      />
    </label>
  )
}

"use client"

import { useState, useEffect, useCallback } from "react"
import { formatLocalDate } from "@/lib/dates"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Loader2,
  Search,
  Database,
  RefreshCw,
  ArrowRight,
  MapPin,
  Package,
  Building2,
  Phone,
  PhoneCall,
  X,
  ChevronLeft,
  ChevronRight,
  Truck,
  Calendar,
  Weight,
  Zap,
  Filter,
  Rocket,
  Gauge,
  CheckCircle,
  AlertTriangle,
  ExternalLink,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { TruckLoader } from "@/components/ui/truck-loader"

// ==================== ТИПЫ ====================
interface GeoOption {
  id: number
  name: string
  fullName: string
  region?: string
}

interface LoadItem {
  id: string
  atiLoadId: string
  routeFrom: string
  routeTo: string
  distance: number
  weight: number
  volume: number | null
  cargoType: string | null
  truckType: string | null
  price: number
  firmId: string | null
  firmName: string | null
  contactPhone: string | null
  contactName: string | null
  loadingDate: string | null
  status: string
  note: string | null
}

interface CacheResponse {
  items: LoadItem[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

interface Stats {
  total: number
  new: number
  imported: number
  expiringSoon: number
}

interface ContactInfo {
  phone: string | null
  name: string | null
  firmName: string | null
  firmId: string | null
}

// ==================== КОМПОНЕНТ ВЫБОРА ГОРОДА ====================
function GeoSelect({
  placeholder,
  onSelect,
}: {
  placeholder: string
  onSelect: (geo: GeoOption | null) => void
}) {
  const [query, setQuery] = useState("")
  const [options, setOptions] = useState<GeoOption[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<GeoOption | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (query.length < 2) {
      setOptions([])
      return
    }

    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/ati/geo?q=${encodeURIComponent(query)}`)
        const data = (await res.json()) as unknown
        if (Array.isArray(data)) {
          setOptions(data as GeoOption[])
        } else {
          setOptions([])
        }
        setIsOpen(true)
      } catch {
        setOptions([])
      } finally {
        setLoading(false)
      }
    }, 400)

    return () => clearTimeout(timer)
  }, [query])

  const handleSelect = (geo: GeoOption) => {
    setSelected(geo)
    setQuery(geo.fullName || geo.name)
    setOptions([])
    setIsOpen(false)
    onSelect(geo)
  }

  const clearSelection = () => {
    setSelected(null)
    setQuery("")
    onSelect(null)
  }

  return (
    <div className="relative flex-1">
      <div className="relative">
        <Input
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            if (selected) clearSelection()
          }}
          className={selected ? "pr-8 border-green-500 bg-green-500/5" : "pr-8"}
        />
        {loading && (
          <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
        )}
        {selected && !loading && (
          <X
            className="absolute right-2 top-2.5 h-4 w-4 cursor-pointer text-muted-foreground hover:text-destructive transition-colors"
            onClick={clearSelection}
          />
        )}
      </div>

      {isOpen && options.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {options.map((geo: any) => (
            <div
              key={geo.id}
              className="px-3 py-2.5 hover:bg-accent cursor-pointer text-sm transition-colors"
              onClick={() => handleSelect(geo)}
            >
              <div className="font-medium">{geo.name}</div>
              {geo.fullName !== geo.name && (
                <div className="text-xs text-muted-foreground">
                  {geo.fullName}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ==================== ГЛАВНЫЙ КОМПОНЕНТ ====================
export function AtiSearchPanel() {
  const [activeTab, setActiveTab] = useState<"search" | "database">("database")

  // Параметры поиска
  const [fromGeo, setFromGeo] = useState<GeoOption | null>(null)
  const [fromRadius, setFromRadius] = useState("50")
  const [toGeo, setToGeo] = useState<GeoOption | null>(null)
  // Радиус «куда» по умолчанию +100 км, как на телефоне: с «Точно» живой
  // поиск показывал только грузы, выгружающиеся ровно в выбранном городе, и
  // компания из Ярославля не видела груз в Набережных Челнах.
  const [toRadius, setToRadius] = useState("100")
  const [weightMin, setWeightMin] = useState("")
  const [weightMax, setWeightMax] = useState("")
  /**
   * Где искать: площадки организации, общая биржа или оба источника.
   *
   * Десктопный поиск не отправлял source вообще — запрос уходил только на
   * площадки организации, а грузы общей биржи (те самые сотни вариантов,
   * которые видны на ati.su) не попадали в выдачу. На живом замере
   * «Ярославль → Казань»: без source — 0 грузов, с source — 106.
   */
  const [source, setSource] = useState<"boards" | "exchange" | "both">("both")
  /** Масштаб выдачи со стороны ATI: сколько грузов обещает фильтр и дошли ли мы до конца */
  const [searchMeta, setSearchMeta] = useState<{
    totalItems: number | null
    bySource: { boards: number; exchange: number } | null
    nextPageStart: number | null
  } | null>(null)
  /**
   * Контакты фрахтователя — ТОЛЬКО по нажатию на карточку, официальным
   * методом ATI (GET /v1.0/firms/{id}/contacts/summary). Автоматически не
   * собираются: за это ATI.SU делает замечания (соглашение, п. 3.2.1.7).
   */
  const [rowContacts, setRowContacts] = useState<
    Record<string, { phone: string | null; name: string | null; email: string | null }>
  >({})
  const [contactBusyId, setContactBusyId] = useState<string | null>(null)
  /**
   * Биржа отдала всё, что показывает по фильтру. Живой замер «Ярославль →
   * Казань»: ATI обещает 188 грузов, а страницы кончаются на 11-й — 106
   * уникальных. Кнопка «Показать далее» в этот момент возвращает пустоту,
   * поэтому экран говорит это словами, а не молчит.
   */
  const [deepEnd, setDeepEnd] = useState<string | null>(null)

  // Данные
  const [searchResults, setSearchResults] = useState<LoadItem[]>([])
  const [dbData, setDbData] = useState<CacheResponse | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)

  // Пагинация
  const [page, setPage] = useState(0)
  const [searchQuery, setSearchQuery] = useState("")
  const limit = 30

  // Статусы загрузки
  const [scanning, setScanning] = useState(false)
  // Подключён ли у организации свой аккаунт ATI (null — ещё не знаем)
  const [atiConnected, setAtiConnected] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [harvesting, setHarvesting] = useState(false)
  const [harvestMode, setHarvestMode] = useState<"fast" | "normal" | "deep">(
    "normal",
  )

  // Фильтры для базы
  const [dbMinPrice, setDbMinPrice] = useState("")
  const [dbMaxPrice, setDbMaxPrice] = useState("")
  const [dbMinDistance, setDbMinDistance] = useState("")
  const [dbMaxDistance, setDbMaxDistance] = useState("")
  const [dbMinPricePerKm, setDbMinPricePerKm] = useState("")
  const [showFilters, setShowFilters] = useState(false)

  // Модалка результата
  const [selectedLoad, setSelectedLoad] = useState<LoadItem | null>(null)
  const [contactInfo, setContactInfo] = useState<ContactInfo | null>(null)
  const [loadingContact, setLoadingContact] = useState(false)
  const [showResultDialog, setShowResultDialog] = useState(false)
  /** Грузы, которые наша организация уже взяла в работу (заказ создан). */
  const [takenIds, setTakenIds] = useState<Set<string>>(() => new Set())

  // ==================== ЗАГРУЗКА ДАННЫХ БАЗЫ ====================
  const loadDatabase = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        status: "new",
        limit: limit.toString(),
        offset: (page * limit).toString(),
        sortBy: "scannedAt",
        sortOrder: "desc",
      })

      if (searchQuery.length >= 2) params.set("search", searchQuery)
      if (dbMinPrice) params.set("minPrice", dbMinPrice)
      if (dbMaxPrice) params.set("maxPrice", dbMaxPrice)
      if (dbMinDistance) params.set("minDistance", dbMinDistance)
      if (dbMaxDistance) params.set("maxDistance", dbMaxDistance)
      if (dbMinPricePerKm) params.set("minPricePerKm", dbMinPricePerKm)

      const res = await fetch(`/api/ati/cache?${params.toString()}`)
      const data = (await res.json()) as CacheResponse
      setDbData(data)
    } catch {
      toast.error("Ошибка загрузки базы")
    } finally {
      setLoading(false)
    }
  }, [
    page,
    searchQuery,
    dbMinPrice,
    dbMaxPrice,
    dbMinDistance,
    dbMaxDistance,
    dbMinPricePerKm,
  ])

  const loadStats = async (): Promise<void> => {
    try {
      const res = await fetch("/api/ati/cache?stats=true")
      const data = (await res.json()) as Stats
      setStats(data)
    } catch {
      // ignore
    }
  }

  // Без подключённого аккаунта ATI и скан, и живой поиск не работают —
  // узнаём состояние сразу, чтобы показать баннер с инструкцией
  useEffect(() => {
    let active = true
    fetch("/api/ati/connection", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (active && data?.success) setAtiConnected(Boolean(data.connected))
      })
      .catch(() => {
        /* не критично: узнаем из ответа скана */
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (activeTab === "database") {
      void loadDatabase()
      void loadStats()
    }
  }, [activeTab, loadDatabase])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (activeTab === "database") {
        setPage(0)
        void loadDatabase()
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [
    searchQuery,
    dbMinPrice,
    dbMaxPrice,
    dbMinDistance,
    dbMaxDistance,
    dbMinPricePerKm,
    activeTab,
    loadDatabase,
  ])

  // ==================== ПОИСК ПО ATI (ручной) ====================
  const handleSearch = async (pageStart?: number): Promise<void> => {
    if (!fromGeo) {
      toast.error("Выберите город отправления")
      return
    }

    setScanning(true)
    // «Показать ещё» дописывает к тому, что уже на экране: страницы биржи
    // отдают примерно по 12 грузов, и один заход показывает только первую
    // двадцатку. Первый поиск — список с нуля.
    if (!pageStart) {
      setSearchResults([])
      setDeepEnd(null)
    }

    try {
      const res = await fetch("/api/ati/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manualMode: true,
          source,
          fromGeo: {
            id: fromGeo.id,
            name: fromGeo.name,
            fullName: fromGeo.fullName,
            region: fromGeo.region,
          },
          toGeo: toGeo
            ? {
                id: toGeo.id,
                name: toGeo.name,
                fullName: toGeo.fullName,
                region: toGeo.region,
              }
            : null,
          fromRadius: Number(fromRadius),
          toRadius: Number(toRadius),
          // С какой страницы биржи продолжать — только для «Показать ещё»
          pageStart: pageStart ?? undefined,
          filters: {
            minWeight: Number(weightMin) * 1000 || undefined,
            maxWeight: Number(weightMax) * 1000 || undefined,
          },
        }),
      })

      const data = (await res.json()) as {
        success?: boolean
        error?: string
        code?: string
        loads?: LoadItem[]
        found?: number
        count?: number
        totalItems?: number | null
        bySource?: { boards: number; exchange: number } | null
        nextPageStart?: number | null
        exhausted?: boolean
      }

      if (data.success) {
        const incoming = data.loads || []
        setSearchResults((prev) => {
          if (!pageStart) return incoming
          const seen = new Set(prev.map((item) => item.id))
          return [...prev, ...incoming.filter((item) => !seen.has(item.id))]
        })
        const exhausted = Boolean(data.exhausted)
        // Продолжение не возвращает счётчики (страниц не было) — поэтому
        // «обещанное» число берём из прошлого ответа, иначе оно бы пропало
        // с экрана именно в тот момент, когда мы про него и говорим.
        const promised = data.totalItems ?? searchMeta?.totalItems ?? null
        if (exhausted) {
          setDeepEnd(
            `Биржа отдала всё, что показывает по этому фильтру: ${searchResults.length} грузов. ` +
              `Обещанные ${promised ?? "?"} — её собственная оценка, дальше она страницы не отдаёт.`,
          )
        }
        setSearchMeta((prev) => ({
          totalItems: promised ?? prev?.totalItems ?? null,
          bySource: data.bySource ?? prev?.bySource ?? null,
          nextPageStart: exhausted ? null : data.nextPageStart ?? null,
        }))
        toast.success(
          pageStart
            ? `Показано ещё: ${incoming.length}`
            : `Найдено: ${data.found || 0}, сохранено: ${data.count}`,
        )
        void loadStats()
      } else if (data.code === "ati_not_connected") {
        setAtiConnected(false)
        toast.error("Аккаунт ATI.SU не подключён — зайдите в раздел «Организация»")
      } else {
        toast.warning(data.error || "Ничего не найдено")
      }
    } catch {
      toast.error("Ошибка поиска")
    } finally {
      setScanning(false)
    }
  }

  // ==================== СБОРЩИК ====================
  const handleHarvester = async (): Promise<void> => {
    setHarvesting(true)

    const modeNames: Record<"fast" | "normal" | "deep", string> = {
      fast: "⚡ Быстрый",
      normal: "🚂 Обычный",
      deep: "🔥 Глубокий",
    }

    toast.info(`Запущен сборщик: ${modeNames[harvestMode]}`)

    try {
      const res = await fetch("/api/ati/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manualMode: false,
          mode: harvestMode,
          filters: { minDistance: 50 },
        }),
      })

      const data = (await res.json()) as {
        success?: boolean
        error?: string
        code?: string
        found?: number
        count?: number
      }

      if (data.success) {
        toast.success(
          `✅ Готово! Найдено: ${data.found ?? 0}, сохранено: ${
            data.count ?? 0
          }`,
          { duration: 5000 },
        )
        void loadDatabase()
        void loadStats()
      } else if (data.code === "ati_not_connected") {
        setAtiConnected(false)
        toast.error("Аккаунт ATI.SU не подключён — зайдите в раздел «Организация»")
      } else {
        toast.error(data.error || "Ошибка сборщика")
      }
    } catch {
      toast.error("Сбой сборщика")
    } finally {
      setHarvesting(false)
    }
  }

  // ==================== ВЗЯТЬ ГРУЗ В РАБОТУ ====================
  /**
   * «Взять» создаёт заказ организации на этапе «Поиск» (POST /api/orders/from-cache).
   * Груз при этом остаётся в общей базе: его могут взять другие организации,
   * а у нас появляется карточка заказа с согласованием и историей.
   */
  const handleTakeLoad = async (load: LoadItem): Promise<void> => {
    setSelectedLoad(load)
    setContactInfo(null)
    setLoadingContact(true)
    setShowResultDialog(true)

    try {
      const res = await fetch("/api/orders/from-cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cacheId: load.id,
          // fetchContacts НЕ передаём намеренно: контакты фрахтователя
          // берёт только кнопка «Контакты» на карточке, когда человек сам
          // решает звонить. ATI.SU делает замечания за автоматический сбор
          // контактных данных (соглашение, п. 3.2.1.7).
        }),
      })

      const data = (await res.json()) as {
        success?: boolean
        error?: string
        code?: string
        message?: string
        order?: {
          id: string
          status: string
          statusLabel?: string
          stage?: string | null
        }
        contacts?: {
          phone?: string | null
          name?: string | null
          email?: string | null
          firmName?: string | null
          firmId?: string | null
        }
      }

      if (data.success) {
        setContactInfo({
          phone: data.contacts?.phone ?? load.contactPhone,
          name: data.contacts?.name ?? load.contactName,
          firmName: data.contacts?.firmName ?? load.firmName,
          firmId: data.contacts?.firmId ?? load.firmId,
        })
        setTakenIds((prev) => new Set(prev).add(load.id))
        void loadStats()
        toast.success(data.message || "Груз взят в работу")
      } else {
        setShowResultDialog(false)

        if (data.code === "already_taken") {
          setTakenIds((prev) => new Set(prev).add(load.id))
          toast.message("Груз уже взят в работу", {
            description: "Заказ есть во вкладке «Мои заказы» — откройте его карточку",
          })
        } else if (res.status === 410) {
          toast.warning(data.error || "Груз снят или неактуален — взять в работу нельзя")
        } else {
          toast.error(data.error || "Не удалось взять груз в работу")
        }
      }
    } catch {
      toast.error("Ошибка связи с сервером")
      setShowResultDialog(false)
    } finally {
      setLoadingContact(false)
    }
  }

  /**
   * «Контакты» на карточке груза — один запрос в ATI по нажатию человека.
   *
   * Ровно как кнопка «показать» на самом ATI: телефон фрахтователя не
   * собирается сам и не показывается до нажатия. Ответ кэшируется в грузе,
   * повторное нажатие ATI уже не дёргает.
   */
  const askContacts = async (
    cacheId: string,
  ): Promise<{ phone: string | null; name: string | null; email: string | null } | null> => {
    setContactBusyId(cacheId)
    try {
      const res = await fetch("/api/ati/loads/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cacheId }),
      })
      const data = (await res.json()) as {
        phone?: string | null
        name?: string | null
        email?: string | null
        error?: string
      }
      if (res.ok && data.phone) {
        const shown = {
          phone: data.phone ?? null,
          name: data.name ?? null,
          email: data.email ?? null,
        }
        setRowContacts((prev) => ({ ...prev, [cacheId]: shown }))
        return shown
      }
      toast.error(data.error || "ATI не отдала контакт")
    } catch {
      toast.error("Не удалось получить контакт")
    } finally {
      setContactBusyId(null)
    }
    return null
  }

  // Очистка фильтров
  const clearFilters = (): void => {
    setDbMinPrice("")
    setDbMaxPrice("")
    setDbMinDistance("")
    setDbMaxDistance("")
    setDbMinPricePerKm("")
    setSearchQuery("")
  }

  const hasActiveFilters =
    dbMinPrice ||
    dbMaxPrice ||
    dbMinDistance ||
    dbMaxDistance ||
    dbMinPricePerKm ||
    searchQuery

  const totalPages = dbData ? Math.ceil(dbData.total / limit) : 0

  // ==================== РЕНДЕР ====================
  return (
    <div className="space-y-6">
      {atiConnected === false && (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm sm:flex-row">
          <AlertTriangle className="h-5 w-5 mt-0.5 text-red-500 flex-shrink-0" />
          <div className="flex-1 space-y-1">
            <p className="font-semibold text-red-700 dark:text-red-300">
              Аккаунт ATI.SU не подключён
            </p>
            <p className="text-red-600/90 dark:text-red-300/80">
              Сканы и живой поиск идут через аккаунт ATI вашей организации —
              свои площадки, подписки и лимиты. Подключите токен в разделе
              «Организация» (это может сделать администратор).
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="w-full flex-shrink-0 sm:w-auto">
            <Link href="/organization">Подключить</Link>
          </Button>
        </div>
      )}
      <Tabs
        value={activeTab}
        onValueChange={(val) => setActiveTab(val as "search" | "database")}
        className="w-full"
      >
        {/* Источник заказов по умолчанию — своя накопленная база (её наполняют
            сканы по расписанию). Живой запрос на ATI.su — отдельная явная опция. */}
        {/* h-auto + перенос подписи: на телефоне названия вкладок не должны
            обрезаться по правому краю (жалоба «табы обрезаны»). */}
        <TabsList className="grid h-auto min-h-12 w-full grid-cols-2">
          <TabsTrigger value="database" className="gap-2 px-2 py-2.5 text-xs sm:text-base">
            <Database className="h-4 w-4 shrink-0" />
            <span className="min-w-0 whitespace-normal text-left">Своя база ({stats?.new || 0})</span>
          </TabsTrigger>
          <TabsTrigger value="search" className="gap-2 px-2 py-2.5 text-xs sm:text-base">
            <Search className="h-4 w-4 shrink-0" />
            <span className="min-w-0 whitespace-normal text-left">Живой поиск ATI</span>
          </TabsTrigger>
        </TabsList>

        {/* Вкладка живого поиска ATI */}
        <TabsContent value="search" className="space-y-6 mt-6">
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <p className="text-amber-800 dark:text-amber-300">
              Живой запрос уходит на ati.su и тратит лимиты токена. Основной
              источник грузов — своя накопленная база (вкладка «Своя база»): её
              наполняют плановые сканы, и поиск по ней мгновенный.
            </p>
          </div>
          <Card className="border-l-4 border-l-primary">
            <CardContent className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
                <div className="lg:col-span-4 space-y-2">
                  <label className="text-sm font-semibold flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-green-500" />
                    Откуда
                  </label>
                  <div className="flex gap-2">
                    <GeoSelect
                      placeholder="Например: Москва"
                      onSelect={setFromGeo}
                    />
                    <Select
                      value={fromRadius}
                      onValueChange={(v) => setFromRadius(v)}
                    >
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Точно</SelectItem>
                        <SelectItem value="50">+50 км</SelectItem>
                        <SelectItem value="100">+100 км</SelectItem>
                        <SelectItem value="200">+200 км</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="lg:col-span-4 space-y-2">
                  <label className="text-sm font-semibold flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-red-500" />
                    Куда
                  </label>
                  <div className="flex gap-2">
                    <GeoSelect
                      placeholder="Любой город"
                      onSelect={setToGeo}
                    />
                    <Select
                      value={toRadius}
                      onValueChange={(v) => setToRadius(v)}
                    >
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Точно</SelectItem>
                        <SelectItem value="50">+50 км</SelectItem>
                        <SelectItem value="100">+100 км</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="lg:col-span-2 space-y-2">
                  <label className="text-sm font-semibold flex items-center gap-2">
                    <Weight className="h-4 w-4" />
                    Вес (т)
                  </label>
                  <div className="flex gap-1">
                    <Input
                      placeholder="от"
                      value={weightMin}
                      onChange={(e) => setWeightMin(e.target.value)}
                      className="text-center"
                    />
                    <Input
                      placeholder="до"
                      value={weightMax}
                      onChange={(e) => setWeightMax(e.target.value)}
                      className="text-center"
                    />
                  </div>
                </div>

                <div className="lg:col-span-12">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">Где искать:</span>
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
                        className={`min-h-[34px] rounded-md border px-3 text-[13px] transition-colors ${
                          source === value
                            ? "border-primary/40 bg-primary/15 text-primary"
                            : "border-border text-muted-foreground hover:bg-accent"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                    <span className="text-xs text-muted-foreground">
                      «Площадки» — организации, где мы участник. «Общая биржа» —
                      все грузы ATI, как на сайте ati.su.
                    </span>
                  </div>
                </div>

                <div className="lg:col-span-2">
                  <Button
                    size="lg"
                    className="w-full h-10 font-bold"
                    onClick={() => void handleSearch()}
                    disabled={scanning}
                  >
                    {scanning ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Search className="h-4 w-4 mr-2" />
                    )}
                    Найти
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-3">
            {searchResults.length > 0 ? (
              <>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span>
                    Показано: <span className="font-bold text-foreground">{searchResults.length}</span>
                  </span>
                  {searchMeta?.bySource ? (
                    <span>
                      с площадок {searchMeta.bySource.boards}, с общей биржи{" "}
                      {searchMeta.bySource.exchange}
                    </span>
                  ) : null}
                  {searchMeta?.totalItems ? (
                    <span>
                      ATI обещает по такому фильтру:{" "}
                      <span className="font-bold text-foreground">{searchMeta.totalItems}</span>
                    </span>
                  ) : null}
                </div>
                {searchResults.map((load: any) => (
                  <LoadCard
                    key={load.id}
                    load={load}
                    onTake={() => void handleTakeLoad(load)}
                    taken={takenIds.has(load.id)}
                    contact={rowContacts[load.id] ?? null}
                    contactBusy={contactBusyId === load.id}
                    onContacts={() => void askContacts(load.id)}
                  />
                ))}
                {deepEnd ? (
                  <p className="px-1 text-[13px] text-muted-foreground">{deepEnd}</p>
                ) : null}
                {searchMeta?.nextPageStart && searchMeta.totalItems &&
                searchResults.length < searchMeta.totalItems ? (
                  <div className="flex justify-center pt-1">
                    <Button
                      variant="outline"
                      disabled={scanning}
                      onClick={() => void handleSearch(searchMeta.nextPageStart ?? undefined)}
                    >
                      {scanning ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Search className="h-4 w-4 mr-2" />
                      )}
                      Показать ещё — биржа отдаёт страницами примерно по 12 грузов
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              !scanning && (
                <div className="text-center text-muted-foreground py-16 bg-muted/30 rounded-lg">
                  <Search className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p>Введите город и нажмите "Найти"</p>
                </div>
              )
            )}
          </div>
        </TabsContent>

        {/* Вкладка базы */}
        <TabsContent value="database" className="space-y-4 mt-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-center">
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                    <div>
                      <span className="text-muted-foreground">Всего:</span>
                      <span className="font-bold ml-1">
                        {stats?.total || 0}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Новых:</span>
                      <span className="font-bold text-green-600 ml-1">
                        {stats?.new || 0}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Взято:</span>
                      <span className="font-bold text-blue-600 ml-1">
                        {stats?.imported || 0}
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-2 w-full lg:w-auto flex-wrap">
                    <div className="relative flex-1 lg:w-48">
                      <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Поиск..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                      />
                    </div>

                    <Button
                      variant={showFilters ? "secondary" : "outline"}
                      size="icon"
                      onClick={() => setShowFilters(!showFilters)}
                    >
                      <Filter className="h-4 w-4" />
                    </Button>

                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        void loadDatabase()
                        void loadStats()
                      }}
                      disabled={loading}
                    >
                      <RefreshCw
                        className={cn(
                          "h-4 w-4",
                          loading && "animate-spin",
                        )}
                      />
                    </Button>

                    <Select
                      value={harvestMode}
                      onValueChange={(v: string) =>
                        setHarvestMode(v as "fast" | "normal" | "deep")
                      }
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fast">
                          <div className="flex items-center gap-2">
                            <Gauge className="h-4 w-4 text-yellow-500" />
                            Быстрый
                          </div>
                        </SelectItem>
                        <SelectItem value="normal">
                          <div className="flex items-center gap-2">
                            <Rocket className="h-4 w-4 text-blue-500" />
                            Обычный
                          </div>
                        </SelectItem>
                        <SelectItem value="deep">
                          <div className="flex items-center gap-2">
                            <Zap className="h-4 w-4 text-orange-500" />
                            Глубокий
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>

                    <Button
                      onClick={() => void handleHarvester()}
                      disabled={harvesting}
                      className="bg-purple-600 hover:bg-purple-700"
                    >
                      {harvesting ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Zap className="h-4 w-4 mr-2" />
                      )}
                      Собрать
                    </Button>
                  </div>
                </div>

                {showFilters && (
                  <div className="border-t pt-4 mt-2">
                    <div className="flex items-center justify-between mb-3">
                      <Label className="text-sm font-semibold">
                        Фильтры
                      </Label>
                      {hasActiveFilters && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={clearFilters}
                        >
                          <X className="h-3 w-3 mr-1" />
                          Сбросить
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Цена от (₽)
                        </Label>
                        <Input
                          type="number"
                          placeholder="10000"
                          value={dbMinPrice}
                          onChange={(e) => setDbMinPrice(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Цена до (₽)
                        </Label>
                        <Input
                          type="number"
                          placeholder="100000"
                          value={dbMaxPrice}
                          onChange={(e) => setDbMaxPrice(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Расстояние от
                        </Label>
                        <Input
                          type="number"
                          placeholder="100"
                          value={dbMinDistance}
                          onChange={(e) => setDbMinDistance(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Расстояние до
                        </Label>
                        <Input
                          type="number"
                          placeholder="1000"
                          value={dbMaxDistance}
                          onChange={(e) => setDbMaxDistance(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Мин. ₽/км
                        </Label>
                        <Input
                          type="number"
                          placeholder="30"
                          value={dbMinPricePerKm}
                          onChange={(e) => setDbMinPricePerKm(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_: any, i: any) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))}
            </div>
          ) : dbData?.items.length ? (
            <>
              <div className="space-y-3">
                {dbData.items.map((load: any) => (
                  <LoadCard
                    key={load.id}
                    load={load}
                    onTake={() => void handleTakeLoad(load)}
                    taken={takenIds.has(load.id)}
                    contact={rowContacts[load.id] ?? null}
                    contactBusy={contactBusyId === load.id}
                    onContacts={() => void askContacts(load.id)}
                  />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4">
                  <div className="text-sm text-muted-foreground">
                    Показано {page * limit + 1} -{" "}
                    {Math.min((page + 1) * limit, dbData.total)} из{" "}
                    {dbData.total}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setPage((p) => Math.max(0, p - 1))
                      }
                      disabled={page === 0}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Назад
                    </Button>
                    <div className="flex items-center gap-1 px-3">
                      <span className="font-medium">{page + 1}</span>/
                      <span className="text-muted-foreground">
                        {totalPages}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => p + 1)}
                      disabled={!dbData.hasMore}
                    >
                      Вперёд
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center text-muted-foreground py-16 bg-muted/30 rounded-lg">
              <Database className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p className="mb-4">База пуста</p>
              <Button
                onClick={() => void handleHarvester()}
                disabled={harvesting}
              >
                <Zap className="h-4 w-4 mr-2" />
                Запустить сборщик
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Модалка результата */}
      <Dialog
        open={showResultDialog}
        onOpenChange={setShowResultDialog}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {loadingContact ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              ) : (
                <CheckCircle className="h-5 w-5 text-green-500" />
              )}
              {loadingContact ? "Загрузка..." : "Груз взят в работу"}
            </DialogTitle>
            {selectedLoad && (
              <DialogDescription>
                {selectedLoad.routeFrom} → {selectedLoad.routeTo}
              </DialogDescription>
            )}
          </DialogHeader>

          {loadingContact ? (
            <div className="py-8 flex flex-col items-center gap-4">
              <TruckLoader className="text-primary" />
              <p className="text-sm text-muted-foreground">
                Создаём заказ на этапе «Поиск»...
              </p>
            </div>
          ) : (
            contactInfo && (
              <div className="space-y-4 py-4">
                {/* Компания */}
                <div className="flex items-center justify-between p-3 bg-accent/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Building2 className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">
                        Компания
                      </p>
                      <p className="font-medium">
                        {contactInfo.firmName || "Частник"}
                      </p>
                    </div>
                  </div>
                  {contactInfo.firmId && (
                    <a
                      href={`https://ati.su/firms/${contactInfo.firmId}/info`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 hover:bg-accent rounded-lg transition-colors"
                      title="Профиль на ATI.su"
                    >
                      <ExternalLink className="h-4 w-4 text-muted-foreground" />
                    </a>
                  )}
                </div>

                {/* Контакт */}
                {contactInfo.name && (
                  <div className="px-3">
                    <p className="text-sm text-muted-foreground">
                      Контактное лицо
                    </p>
                    <p className="font-medium">{contactInfo.name}</p>
                  </div>
                )}

                {/* Телефон */}
                <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Phone className="h-5 w-5 text-green-500" />
                    <div className="flex-1">
                      <p className="text-sm text-muted-foreground">
                        Телефон
                      </p>
                      {contactInfo.phone ? (
                        <a
                          href={`tel:${contactInfo.phone}`}
                          className="font-mono text-lg font-bold text-green-700 dark:text-green-400 hover:underline"
                        >
                          {contactInfo.phone}
                        </a>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Скрыт до нажатия — как на ATI.su
                        </p>
                      )}
                    </div>
                    {!contactInfo.phone && selectedLoad && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={contactBusyId === selectedLoad.id}
                        onClick={() => {
                          if (!selectedLoad) return
                          // Показанный контакт сразу виден в диалоге: берём
                          // его из ответа, а не из состояния — замыкание на
                          // момент нажатия ещё не знает о новой записи.
                          void askContacts(selectedLoad.id).then((shown) => {
                            if (shown?.phone) {
                              setContactInfo({
                                phone: shown.phone,
                                name: shown.name,
                                firmName: contactInfo?.firmName ?? selectedLoad.firmName,
                                firmId: contactInfo?.firmId ?? selectedLoad.firmId,
                              })
                            }
                          })
                        }}
                      >
                        {contactBusyId === selectedLoad.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <PhoneCall className="h-4 w-4" />
                        )}
                        Показать контакты
                      </Button>
                    )}
                  </div>
                </div>

                {/* Подсказка */}
                <div className="flex items-start gap-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <AlertTriangle className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-blue-700 dark:text-blue-400">
                    Создан заказ на этапе &quot;Поиск&quot; — он виден во
                    вкладке &quot;Мои заказы&quot;. Проведите согласование
                    (переговоры и торг по цене), затем заказ можно взять на
                    холст песочницы и собрать рейс.
                  </p>
                </div>
              </div>
            )
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowResultDialog(false)}
            >
              Закрыть
            </Button>
            <Button
              onClick={() => {
                setShowResultDialog(false)
                window.location.href = "/orders"
              }}
            >
              Открыть песочницу
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ==================== КАРТОЧКА ГРУЗА ====================
function LoadCard({
  load,
  onTake,
  taken = false,
  contact,
  contactBusy = false,
  onContacts,
}: {
  load: LoadItem
  onTake: () => void
  /** Груз уже взят нашей организацией в работу (заказ создан). */
  taken?: boolean
  /** Контакт фрахтователя, показанный по нажатию кнопки «Контакты» */
  contact?: { phone: string | null; name: string | null; email: string | null } | null
  contactBusy?: boolean
  /** Показать контакты: один запрос в ATI по нажатию человека */
  onContacts?: () => void
}) {
  const pricePerKm =
    load.distance > 0 && load.price > 0
      ? Math.round(load.price / load.distance)
      : 0
  const knownPhone = contact?.phone ?? load.contactPhone ?? null

  return (
    <Card className="hover:shadow-md transition-all border-l-4 border-l-transparent hover:border-l-primary">
      <CardContent className="p-4">
        <div className="flex flex-col lg:flex-row gap-4 justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-lg font-bold mb-1">
              <span className="truncate">{load.routeFrom}</span>
              <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="truncate">{load.routeTo}</span>
            </div>
            <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {load.distance} км
              </span>
              {load.loadingDate && (
                <span className="flex items-center gap-1 text-primary">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatLocalDate(load.loadingDate)}
                </span>
              )}
            </div>
          </div>

          <div className="lg:border-l lg:pl-4 min-w-[140px]">
            <div className="flex items-center gap-2 font-medium">
              <Package className="h-4 w-4 text-orange-500" />
              {load.cargoType || "Груз"}
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">
              {load.weight ? `${(load.weight / 1000).toFixed(1)} т` : ""}
              {load.volume ? ` / ${load.volume} м³` : ""}
            </div>
          </div>

          <div className="lg:border-l lg:pl-4 min-w-[120px]">
            <div className="flex items-center gap-2 text-sm">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="truncate font-medium">
                {load.firmName || "Частник"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4 lg:border-l lg:pl-4">
            <div className="text-right">
              <div className="text-xl font-bold text-green-600">
                {load.price > 0
                  ? `${load.price.toLocaleString()} ₽`
                  : "Договорная"}
              </div>
              {pricePerKm > 0 && (
                <div
                  className={cn(
                    "text-xs font-medium",
                    pricePerKm >= 45
                      ? "text-green-600"
                      : pricePerKm >= 35
                        ? "text-yellow-600"
                        : "text-red-500",
                  )}
                >
                  {pricePerKm} ₽/км
                </div>
              )}
            </div>
            {taken ? (
              <Button variant="outline" disabled title="Заказ уже создан — смотрите «Мои заказы»">
                В работе
              </Button>
            ) : (
              <Button onClick={onTake}>Взять в работу</Button>
            )}
            {onContacts ? (
              <Button
                variant="outline"
                onClick={onContacts}
                disabled={contactBusy || Boolean(knownPhone)}
                title="Показать контакт фрахтователя — один запрос в ATI по вашему нажатию, как кнопка «показать» на ati.su"
              >
                {contactBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PhoneCall className="h-4 w-4" />
                )}
                {knownPhone ? "Контакты есть" : "Контакты"}
              </Button>
            ) : null}
            {knownPhone ? (
              <a
                href={`tel:${knownPhone}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-green-500/30 bg-green-500/10 px-2.5 py-1.5 text-sm font-medium text-green-700 dark:text-green-400 hover:underline"
              >
                <Phone className="h-3.5 w-3.5" />
                {knownPhone}
              </a>
            ) : null}
            {contact?.email ? (
              <a
                href={`mailto:${contact.email}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:underline"
              >
                {contact.email}
              </a>
            ) : null}
          </div>
        </div>

        {load.note && (
          <div className="mt-3 pt-3 border-t text-sm text-muted-foreground">
            {load.note}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
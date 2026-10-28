// app/lm/routes/assistant/page.tsx — помощник сборки: МАРШРУТ из грузов биржи.
//
// Экран работает так, как работает реальный логист на бирже ATI:
//
//   1. «Куда едем» — город, где стоит машина (база). Выбираешь машину.
//   2. Жмёшь «Построить маршрут» — помощник идёт по грузам и складывает
//      цепочку: база → город → город → домой. Каждое плечо окупается,
//      убыточные маршруты он не предлагает.
//   3. «Маршрут собран» — видно все плечи, деньги и компании. Звонишь
//      фрахтователям и отмечаешь: согласовано / отказ.
//   4. Отказали — «Заменить груз» или «Убрать из маршрута», маршрут
//      пересобирается, согласованные грузы остаются.
//   5. Всё созвонил — «Отправить машину»: грузы становятся заказами,
//      создаётся рейс с машиной и водителем, водителю уходит уведомление.
//
// Всё сложное — под катом: «что осталось на бирже» и «почему так собрал».

"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AlertTriangle, ArrowRight, Building2, Check, ChevronDown, ChevronUp, Clock, Download, Home, Info, Loader2, MapPin, Package, Phone, RefreshCw, Route as RouteIcon, Search, Truck, X } from "lucide-react"

import dynamic from "next/dynamic"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { Card, EmptyState, ErrorState, ListSkeleton } from "@/components/logist-mobile/ui"
import { apiSend, useJsonApi } from "@/hooks/use-json-api"
import type { ApiMutationResult } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import { findRegionByNameLocal } from "@/lib/ati/regions"
import {
  buildRouteVariants,
  explainFailure,
  haversineKm,
  HOURS_STEPS,
  hoursLabel,
  hoursSpan,
  nextHoursStep,
  prevHoursStep,
  routeMapPoints,
  explainVehicleMismatch,
  AVG_DEADHEAD_KMH,
  AVG_LOADED_KMH,
  handlingHours,
  DRIVE_LIMIT_HOURS,
  REST_HOURS,
  type BuilderLoad,
  type BuilderVehicle,
  type BuiltRoute,
  type Point,
  type RouteVariant,
} from "@/lib/logist-mobile/route-builder"
import { normalizeCityKey } from "@/lib/logist-mobile/city-norm"
import { type MobileDriver } from "@/lib/logist-mobile/types"
import {
  formatCount,
  formatDateShort,
  formatMoney,
  formatWeightKg,
  shortCity,
  cityOfAddress,
  telHref,
} from "@/lib/logist-mobile/format"

/**
 * Сколько адресов просим за один запрос точек.
 *
 * Замер на живой бирже (126 адресов Новосибирской области): пачка из 12
 * адресов считалась 19–59 секунд, а пачка, которая не успела за минуту,
 * обрывалась по maxDuration роута — и все её города оставались без точек
 * (Омск, Абакан, Улан-Удэ). Шесть адресов укладываются в минуту с запасом.
 */
const POINTS_BATCH = 6
/** Сколько пачек считаем одновременно: геокодер просит не чаще запроса в секунду. */
const POINTS_PARALLEL = 2
/**
 * Сколько раз помощник может сам добрать грузы «по пути» за одну сборку.
 * Ограничение от бесконечного цикла: добрали — пересобрали — снова добрали.
 */
/**
 * Сколько ждать расчёта точек городов перед сборкой, мс.
 * Точки считаются пачками по шесть адресов: на биржевом регионе это
 * несколько минут. Дольше двух с половиной минут ждать нельзя — лучше
 * собрать маршрут по точному совпадению городов, чем не собрать вовсе.
 */
const POINTS_WAIT_MS = 150_000
const MAX_AUTO_EXTEND = 2
/**
 * Сколько страниц биржи тянем при додоборе грузов «по пути». Меньше, чем при
 * сборе региона: нужен только груз вокруг точки, а не вся область.
 */
const EXTEND_PAGES = 3

/** Статус договорённости с фрахтователем по конкретному грузу. */
type CallStatus = "pending" | "agreed" | "declined"

/** Шаги анимации построения маршрута. */
const BUILD_STEPS = [
  "Ищем грузы с биржи…",
  "Складываем цепочку плеч…",
  "Считаем деньги по каждому плечу…",
  "Проверяем, что маршрут в плюс…",
]

/** Сколько страниц общей биржи вытягиваем за одно нажатие «Собрать регион». */
const HARVEST_PAGES = 25

const START_CITY_KEY = "assistant-start-city"

export default function RouteAssistantPage() {
  const router = useRouter()
  const { user } = useStaffSession()

  /**
   * База СВОЕЙ организации (FleetSettings.baseAddress) — от неё собирается
   * регион. Регион у каждой компании свой: у одной Ярославль, у другой
   * Коломна, поэтому город берём из настроек организации, а не из памяти
   * браузера и не из зашитого значения.
   */
  const [baseCity, setBaseCity] = useState("")
  /** Координаты стоянки организации — из них считаем, какие города ближе */
  const [basePoint, setBasePoint] = useState<{ lat: number; lng: number } | null>(null)

  /**
   * Корень названия региона базы: «Ярославская», «Нижегородская».
   *
   * Зачем: кэш организации копится со всей страны — свой регион и чужие.
   * Помощник обязан строить из грузов СВОЕГО региона. Живой замер: собрали
   * биржу Нижегородской и Новосибирской областей, а база осталась в
   * Ярославле — в «свежих 300» её грузов не осталось вовсе, и помощник
   * честно ответил «Маршрут не собрался». Теперь грузы просим по региону.
   *
   * Свой словарь считает регион сразу (199 городов); города вне словаря
   * («Тулун», «Кировск», «Надым») досчитывает сервер — его ответ приходит
   * в том же запросе полем baseRegion.
   */
  const regionRootFromBase = useMemo(() => {
    const text = baseCity.trim()
    if (!text) return null
    try {
      const region = findRegionByNameLocal(text)
      return region ? region.name.replace(/\s+(область|край|республика).*$/, "") : null
    } catch {
      return null
    }
  }, [baseCity])
  /** Регион, посчитанный сервером — для адреса, которого нет в словаре. */
  const [serverRegionRoot, setServerRegionRoot] = useState<string | null>(null)
  const regionRoot = serverRegionRoot ?? regionRootFromBase
  const loadsUrl = user
    ? `/api/ati/loads?status=new&limit=300${regionRoot ? `&search=${encodeURIComponent(regionRoot)}` : ""}`
    : null

  const loadsState = useJsonApi<{
    items: Array<{
      id: string
      atiLoadId: string
      routeFrom: string
      routeTo: string
      distance: number | null
      weight: number | null
      volume: number | null
      cargoType: string | null
      price: number | null
      vatIncluded: boolean
      loadingDate: string | null
      firmName: string | null
      /** Ссылка на паспорт фирмы в ATI — там телефон фрахтователя */
      firmUrl?: string | null
      contactPhone: string | null
      status: string
      fromPoint: { lat: number; lng: number } | null
      toPoint: { lat: number; lng: number } | null
      /** Откуда груз: "boards" — площадка организации, "exchange" — общая биржа */
      source?: "boards" | "exchange"
    }>
    refreshError: string | null
    stale: boolean
    /** Сколько грузов всего в кэше организации — список отдаём частями */
    total: number
    /**
     * Регион базы организации — по нему отфильтровываем грузы. Считает
     * сервер: словарь городов, а если города в нём нет — геокодер. В браузере
     * такой возможности не было, и для «Тулуна», «Кировска», «Надыма» фильтр
     * молча выключался, показывая грузы со всей страны.
     */
    baseRegion?: { id: number; name: string } | null
    /**
     * Откуда берём грузы: площадки ATI организации. API ATI.SU отдаёт только
     * их — общий поиск по бирже (как на сайте loads.ati.su) через API закрыт.
     * Показываем это словами, иначе логист решает, что программа сломана.
     */
    source?: {
      boards: Array<{ id: string; name: string }>
      note: string
    }
  }>(loadsUrl)

  const vehiclesState = useJsonApi<{ vehicles: BuilderVehicle[] }>(user ? "/api/vehicles" : null)
  const driversState = useJsonApi<{ drivers: MobileDriver[] }>(user ? "/api/drivers" : null)

  // ── Состояние помощника ──
  const [startCity, setStartCity] = useState("")
  const [vehicleId, setVehicleId] = useState("")
  /** Радиус «по пути», км: груз рядом с маршрутом тоже берём */
  const [detourKm, setDetourKm] = useState(150)
  /** Радиус поиска первого груза от базы, км: порожний выезд за грузом */
  const [startRadiusKm, setStartRadiusKm] = useState(300)
  /** Длина маршрута по времени: сколько часов едем (смены/дни) */
  const [maxHours, setMaxHours] = useState(72)
  const [phase, setPhase] = useState<"setup" | "building" | "route" | "sending">("setup")
  const [buildStep, setBuildStep] = useState(0)
  /** Идёт сборка, но она ждёт расчёта точек городов — экран об этом говорит. */
  const [waitingPoints, setWaitingPoints] = useState(false)
  /**
   * Варианты одного выезда: «как выбрано», «больше денег», «быстрее домой».
   * Логист выбирает сам — помощник не решает за него.
   */
  const [variants, setVariants] = useState<RouteVariant[]>([])
  const [variantIndex, setVariantIndex] = useState(0)
  const route = variants[variantIndex]?.route ?? null
  // Маршрут «до пересборки» — чтобы после отказа сказать, что именно поменялось
  useEffect(() => {
    if (route) routeRef.current = route
  }, [route])
  /** Договорённости по грузам: позвонил → согласовано / отказ */
  const [calls, setCalls] = useState<Record<string, CallStatus>>({})
  /** Согласованные звонком грузы — пересборка их сохраняет */
  const [keepIds, setKeepIds] = useState<string[]>([])
  /** Грузы, которые убираем: отказались или логист исключил */
  const [excludeIds, setExcludeIds] = useState<string[]>([])
  const [refreshing, setRefreshing] = useState(false)
  /** Телефоны фрахтователей, добытые кнопкой «Узнать телефон» */


  // Источник грузов: площадки организации (официальный API ATI), общая биржа
  // (поиск сайта loads.ati.su) или оба сразу. Источники независимы.
  const [searchSource, setSearchSource] = useState<"boards" | "exchange" | "both">("both")

  // ── Живой поиск по бирже: те же поля, что на сайте ATI ──
  // Логист на ATI ищет «откуда / куда / радиус». Раньше в программе это был
  // отдельный экран с обязательным «Откуда», а помощник читал только кэш —
  // и для города без грузов в кэше помощник был пуст.
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchFrom, setSearchFrom] = useState("")
  const [searchTo, setSearchTo] = useState("")
  const [searchRadius, setSearchRadius] = useState(300)
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchResult, setSearchResult] = useState<{
    found: number
    byCity: number
    byRadius: number
    warning: string | null
    bySource?: { boards: number; exchange: number }
    totalItems?: number
  } | null>(null)
  /** Грузы, найденные живым поиском: в кэш они тоже легли, но помощник
   *  строит из них сразу — иначе он увидит только 300 свежих строк базы. */
  const [foundLoads, setFoundLoads] = useState<BuilderLoad[]>([])
  /**
   * Что стало с додобором грузов «по пути» — для экрана.
   *
   * Зачем: додобор мог не сработать (справочник ATI не узнал поселение, биржа
   * не ответила, доступ приостановлен). Без подписи помощник говорил «в
   * радиусе 150 км грузов не нашлось» — а грузы могли быть, просто мы их не
   * увидели. Живой замер: ATI отвечала 401 на поиск по бирже, и маршрут
   * оставался из одного плеча с объяснением «грузов по пути не нашлось».
   * Причина должна быть названа словом.
   */
  const [extendNote, setExtendNote] = useState<{ kind: "geo" | "exchange" | "empty"; text: string } | null>(null)
  /**
   * Те же грузы в ref — накопительно.
   *
   * Зачем: додобор срабатывает до двух раз за сборку. Второй додобор берёт
   * биржу вокруг новой точки, и его пересборка должна видеть грузы ПЕРВОГО
   * додобора. Живой замер: после второго додобора маршрут снова стал из
   * одного плеча — груз «Домодедово → Петрозаводск» пропал из пула, потому
   * что состояние foundLoads ещё не обновилось, а в пересборку уходил только
   * свежий список.
   */
  const foundLoadsRef = useRef<BuilderLoad[]>([])
  /**
   * Запреты на грузы — дублируются в ref.
   *
   * Зачем: `setExcludeIds` асинхронный. Когда логист нажимал «Отказ», обработчик
   * собирал новый список, вызывал `setExcludeIds` и сразу `runBuild`, а внутри
   * `runBuild` → `extendAlongRoute` пересборка шла по СТАРОМУ замыканию — и
   * отказанный груз возвращался в маршрут. На экране это выглядело так: тост
   * «груз убран, пересобираю», а маршрут не меняется.
   */
  /** Идёт ли мгновенная пересборка — тонкая полоса под шапкой результата. */
  const [rebuilding, setRebuilding] = useState(false)
  /** Текущий маршрут для сравнения «было → стало» после пересборки. */
  const routeRef = useRef<BuiltRoute | null>(null)
  const excludeRef = useRef<string[]>([])
  const keepRef = useRef<string[]>([])
  useEffect(() => {
    excludeRef.current = excludeIds
  }, [excludeIds])
  useEffect(() => {
    keepRef.current = keepIds
  }, [keepIds])
  useEffect(() => {
    foundLoadsRef.current = foundLoads
  }, [foundLoads])
  /** С какой страницы общей биржи продолжать сбор региона */
  const [harvestPage, setHarvestPage] = useState(1)
  /**
   * Для какого города и радиуса собраны эти страницы. Сменили город или
   * радиус — сбор начинается заново: иначе «Собрать регион» для другого
   * города продолжал бы со страницы 21 и тихо пропускал первые 20 страниц,
   * а грузы двух регионов смешивались бы в одном маршруте.
   */
  const [harvestScope, setHarvestScope] = useState("")
  // Город старта помним: логист обычно едет из одной базы
  useEffect(() => {
    const saved = window.localStorage.getItem(START_CITY_KEY)
    if (saved) setStartCity(saved)
  }, [])

  // База организации: в настройках автопарка указан адрес стоянки. Это и есть
  // точка отсчёта для сбора региона и построения маршрутов. Если в настройках
  // базы нет, помощник работает от того города, что ввёл логист.
  useEffect(() => {
    let alive = true
    fetch("/api/fleet/settings", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const address = (data?.settings?.baseAddress ?? "").trim()
        if (alive && address) {
          setBaseCity(address)
          // Город старта не задан — подставляем базу: у другой компании база
          // будет своя, и маршрут всё равно начнётся от её стоянки.
          setStartCity((prev) => (prev.trim() ? prev : address))
        }
        // Координаты стоянки. Без них близость городов не посчитать —
        // подсказки останутся просто списком без километража.
        const lat = Number(data?.settings?.baseLat)
        const lng = Number(data?.settings?.baseLng)
        if (alive && Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
          setBasePoint({ lat, lng })
        }
      })
      .catch(() => {
        /* настройки недоступны — работаем от города, что ввёл логист */
      })
    return () => {
      alive = false
    }
  }, [])

  // Биржа обновляется в фоне: скан ATI занимает больше минуты, и экран не
  // должен из-за него висеть. Сервер помечает кэш «stale» — дёргаем POST
  // и перечитываем список, когда он уже показан.
  const [autoRefresh, setAutoRefresh] = useState(false)
  useEffect(() => {
    if (!loadsState.data?.stale || autoRefresh) return
    setAutoRefresh(true)
    void apiSend<{ count?: number }>("/api/ati/loads", "POST").then((result) => {
      loadsState.reload()
      if (result.ok) toast.success("Биржа обновлена")
    })
  }, [loadsState.data, autoRefresh, loadsState])

  const loads = useMemo<BuilderLoad[]>(
    () =>
      (loadsState.data?.items ?? []).map((row) => ({
        id: row.id,
        loadId: row.atiLoadId,
        fromCity: row.routeFrom,
        toCity: row.routeTo,
        weightKg: row.weight,
        volumeM3: row.volume,
        cargoType: row.cargoType,
        truckType: (row as { truckType?: string | null }).truckType ?? null,
        priceRub: row.price,
        priceWithNds: row.vatIncluded ? row.price : null,
        distanceKm: row.distance,
        firmName: row.firmName,
        firmUrl: row.firmUrl ?? null,
        contactPhone: row.contactPhone,
        loadingDate: row.loadingDate,
        status: row.status,
        // Точные координаты точки погрузки/выгрузки из груза ATI —
        // приоритетнее центра города из геокодера
        fromPoint: row.fromPoint ?? null,
        toPoint: row.toPoint ?? null,
        source: row.source ?? "boards",
      })),
    [loadsState.data],
  )
  const vehicles = useMemo<BuilderVehicle[]>(() => {
    // У машин часто не заполнен паспортный расход — прибыль тогда нечем
    // считать. Подставляем оценку по типу кузова и честно помечаем это в
    // «Почему собрал так»: точные литры появятся, когда расход заполнят.
    const rows = vehiclesState.data?.vehicles ?? []
    return rows.map((vehicle) => {
      if (vehicle.fuelConsumptionPer100 && vehicle.fuelConsumptionPer100 > 0) return vehicle
      const type = (vehicle.type ?? "").toLowerCase()
      const estimate = /газел|малый|малотон|микро/.test(type)
        ? 18
        : /фур|полуфур|тент|рефриж|изотерм|борт/.test(type)
          ? 30
          : 24
      return { ...vehicle, fuelConsumptionPer100: estimate, fuelEstimated: true }
    })
  }, [vehiclesState.data])

  const drivers = driversState.data?.drivers ?? []

  const loading = loadsState.loading || vehiclesState.loading
  const error = loadsState.error || vehiclesState.error

  const freeVehicles = useMemo(
    () => vehicles.filter((vehicle) => vehicle.status === "available"),
    [vehicles],
  )

  /** Грузы, которые вообще могут поехать: свежие, со ставкой, известный маршрут. */
  /**
   * Регион базы организации — из него берём грузы.
   *
   * Зачем: в кэше копится биржа со всей страны (в моих замерах — 1290 грузов,
   * из них 105 Московской области и 58 Калужской, а Ярославской — НОЛЬ).
   * Помощник, читая кэш как есть, предлагает груз из Новосибирска компании
   * из Ярославля — «через всю страну проехать надо». Поэтому берём только
   * регион базы: у каждой компании он свой.
   */
  // Сервер считает регион для ЛЮБОГО адреса базы (словарь городов, затем
  // геокодер) — для города вне словаре грузы иначе не отфильтровать.
  useEffect(() => {
    const name = loadsState.data?.baseRegion?.name
    if (!name) return
    const root = name.replace(/\s+(область|край|республика).*$/, "")
    setServerRegionRoot((prev) => (prev === root ? prev : root))
  }, [loadsState.data])

  const baseRegionName = useMemo(() => {
    // Регион с сервера — он считается для любого адреса базы (словарь городов,
    // затем геокодер). Свой словарь в браузере остаётся запасным путём: если
    // сервер ещё не ответил, фильтр уже работает.
    const fromServer = loadsState.data?.baseRegion?.name
    if (fromServer) return fromServer
    if (!baseCity.trim()) return null
    try {
      const region = findRegionByNameLocal(baseCity)
      return region?.name ?? null
    } catch {
      return null
    }
  }, [baseCity, loadsState.data?.baseRegion?.name])

  /**
   * Грузы, пригодные для цепочки, — ТОЛЬКО региона базы.
   *
   * Если регион определить не удалось (адрес базы не заполнен), показываем
   * всё как раньше: лучше больше грузов, чем пустой экран.
   */
  const regionLoads = useMemo(() => {
    if (!baseRegionName) return loads
    const inRegion = loads.filter((load) => {
      const from = String(load.fromCity ?? "")
      return from.includes(baseRegionName.replace(/\s+(область|край|республика).*$/, ""))
    })
    // В своем регионе грузов нет — не показываем чужие как свои. Экран честно
    // скажет, что регион нужно собрать.
    return inRegion
  }, [loads, baseRegionName])

  const usableLoads = useMemo(
    () =>
      regionLoads.filter(
        (load) =>
          load.status === "new" &&
          (load.priceWithNds ?? load.priceRub ?? 0) > 0 &&
          shortCity(load.fromCity) !== "—" &&
          shortCity(load.toCity) !== "—",
      ),
    [regionLoads],
  )

  /** Города погрузки на бирже — быстрый выбор базы, если своей нет в списке. */
  /**
   * Города погрузки, где сейчас есть грузы.
   *
   * Сортировка — ОТ БАЗЫ ОРГАНИЗАЦИИ: сначала ближние. Раньше шли по числу
   * грузов, и вверху оказывался случайный город с биржи, а не тот, куда
   * логисту реально ехать. Теперь первый чипс — ближайший к стоянке.
   */



  // ── Координаты городов биржи: нужны, чтобы брать грузы «по пути» ──
  // Без них цепочка строится только по точному совпадению городов, а на
  // бирже один город пишут по-разному и «стыков» мало — маршрут оборвётся
  // на одном плече. Точки тянем один раз на все города грузов.
  /**
   * Адреса всех грузов помощника — точки нужны каждому, не только первым.
   *
   * Собираем ПОЛНЫЕ строки биржи («Шарапово д. (Новомосковский
   * административный округ), Московская область»), а не короткие названия:
   * геокодер по полному адресу находит нужный населённый пункт, а по
   * короткому либо не находит ничего («Среднесибирский п.» — ноль ответов),
   * либо находит одноимённое село в другом крае («Шарапово д.» без области
   * уводит в Псковскую). Ключ в ответе — короткое название города.
   */

  /**
   * Контакты фрахтователей, показанные по нажатию.
   *
   * ATI.SU запрещает автоматизированный сбор контактной информации
   * (пользовательское соглашение, п. 3.2.1.7). Поэтому телефон не тянется
   * сам: диспетчер нажимает кнопку — уходит один запрос официальным методом
   * API, ровно как он сам нажимает «показать» на сайте ATI.
   */
  const [phones, setPhones] = useState<Record<string, string>>({})
  const [contactBusy, setContactBusy] = useState<string | null>(null)

  async function fetchPhone(loadId: string) {
    setContactBusy(loadId)
    try {
      const result = await apiSend<{ phone: string | null; name: string | null }>(
        "/api/ati/loads/contacts",
        "POST",
        { cacheId: loadId },
      )
      if (result.ok && result.data?.phone) {
        setPhones((prev) => ({ ...prev, [loadId]: result.data?.phone as string }))
        loadsState.reload()
        toast.success("Контакт фрахтователя получен")
      } else {
        toast.error(result.error ?? "ATI не отдала контакт")
      }
    } catch {
      toast.error("Не удалось получить контакт")
    } finally {
      setContactBusy(null)
    }
  }

  /**
   * Точки городов биржи — порциями.
   *
   * Зачем порциями: геокодер отдаёт не больше 12 адресов за запрос (правила
   * сервиса — не чаще одного запроса в секунду), а адресов у биржи больше
   * сотни. Раньше помощник просил точки одним списком и видел только первые
   * 60 городов, из которых геокодер успевал отсчитать 12: живой замер для
   * базы «Нижний Новгород» — у 108 грузов из 119 точек не было, грузы «по
   * пути» не работали вовсе, маршрут собирался в одно плечо. Теперь просим
   * все города пачками по 6, по две пачки за раз; постоянный кэш координат
   * делает второй и следующие заходы мгновенными.
   */
  const [cityPoints, setCityPoints] = useState<Record<string, { lat: number; lng: number } | null> | null>(null)
  const [pointsLoading, setPointsLoading] = useState(false)
  /**
   * Тот же признак в ref: сборка маршрута — обычная функция, ей нужно
   * свежее значение, а не то, что было на момент создания замыкания.
   */
  const pointsLoadingRef = useRef(false)
  useEffect(() => {
    pointsLoadingRef.current = pointsLoading
  }, [pointsLoading])

  /**
   * Точка базы для расчёта близости городов.
   *
   * Сначала координаты из настроек автопарка — там стоит сам адрес стоянки,
   * они точные. Если их нет, берём координаты города базы из геокодера:
   * лучше примерные, чем никаких — иначе подсказки останутся списком без
   * километража и пользователь не поймёт, что ближе.
   */
  const basePointForSort = useMemo<{ lat: number; lng: number } | null>(() => {
    if (basePoint) return basePoint
    const city = cityOfAddress(baseCity) || cityOfAddress(startCity)
    if (!city || !cityPoints) return null
    return cityPoints[normalizeCityKey(city)] ?? null
  }, [basePoint, baseCity, startCity, cityPoints])





  /**
   * Грузы с координатами городов — билдер умеет брать «по пути».
   *
   * Сюда же встраиваются грузы, найденные живым поиском по общей бирже:
   * помощник читает кэш списком не больше 300 строк, а общая биржа отдаёт
   * тысячи. Без слияния логист нашёл бы грузы, а сборщик их не увидел.
   */
  const loadsWithPoints = useMemo<BuilderLoad[]>(() => {
    const withPoints = (list: BuilderLoad[]): BuilderLoad[] => {
      if (!cityPoints) return list
      return list.map((load) => ({
        ...load,
        fromPoint: load.fromPoint ?? cityPoints[normalizeCityKey(shortCity(load.fromCity))] ?? null,
        toPoint: load.toPoint ?? cityPoints[normalizeCityKey(shortCity(load.toCity))] ?? null,
      }))
    }
    // Пул цепочки — ТОЛЬКО регион базы (плюс додобранные «по пути»).
    //
    // Живой замер: здесь стоял `loads` — все 300 грузов кэша со всей страны.
    // Для базы «Ярославль» помощник уводил машину на 275 км порожняком в
    // Домодедово и брал груз оттуда, хотя в своём регионе грузы были. Это не
    // «больше вариантов», а нарушение правила: объём сбора — регион базы из
    // настроек организации, а не вся Россия.
    if (foundLoads.length === 0) return withPoints(usableLoads)
    const seen = new Set(usableLoads.map((load) => load.id))
    const extra = foundLoads.filter((load) => !seen.has(load.id))
    // Один и тот же груз приходит из двух мест — из кэша региона и из живой
    // выдачи биржи — с РАЗНЫМИ id. Живой замер: в блоке «Что осталось на
    // бирже» одна и та же «Ступино → Красногорск» от частника без ставки
    // светилась дважды, и логист звонил бы дважды. Склеиваем по подписи
    // груза: маршрут + ставка + пробег + фирма. Расходится хоть в одном
    // поле — считаем разными, выдумывать нельзя.
    const fingerprint = (load: BuilderLoad): string => {
      if (load.loadId && load.loadId !== "null") return `ati:${load.loadId}`
      return [
        normalizeCityKey(shortCity(load.fromCity)),
        normalizeCityKey(shortCity(load.toCity)),
        load.priceWithNds ?? load.priceRub ?? 0,
        load.distanceKm ?? 0,
        (load.firmName ?? "").trim().toLowerCase(),
      ].join("|")
    }
    const seenPrint = new Set<string>()
    const unique: BuilderLoad[] = []
    for (const load of [...usableLoads, ...extra]) {
      const key = fingerprint(load)
      if (seenPrint.has(key)) continue
      seenPrint.add(key)
      unique.push(load)
    }
    return withPoints(unique)
  }, [usableLoads, foundLoads, cityPoints])

  /**
   * Города погрузки, где сейчас есть грузы.
   *
   * Километраж считаем по грузам С ТОЧКАМИ (loadsWithPoints): у сырых грузов
   * точек нет, и живой замер показывал чипсы «Ярославль · 91 груз(а)» без
   * расстояния — сортировка по близости молча не работала.
   *
   * Сортировка — ОТ БАЗЫ ОРГАНИЗАЦИИ: сначала ближние. Раньше шли по числу
   * грузов, и вверху оказывался случайный город с биржи, а не тот, куда
   * логисту реально ехать. Теперь первый чипс — ближайший к стоянке.
   */
  /**
   * Грузы, отсортированные от базы организации: сначала ближние.
   * Показываем на первом экране — иначе пользователь видит только названия
   * городов и спрашивает «где заказы?». Это и есть заказы.
   *
   * Считаем по грузам С ТОЧКАМИ (loadsWithPoints): у сырых грузов точек нет,
   * и живой замер показывал список без километража — сортировка по близости
   * молча не работала.
   */
  const nearestLoads = useMemo(() => {
    const origin = basePointForSort
    const withKm = loadsWithPoints.map((load) => {
      const point = load.fromPoint ?? null
      const km =
        origin && point && Number.isFinite(point.lat) && Number.isFinite(point.lng)
          ? haversineKm(origin, point)
          : null
      return { load, km }
    })
    withKm.sort((a, b) => {
      if (a.km !== null && b.km !== null) return a.km - b.km
      if (a.km !== null) return -1
      if (b.km !== null) return 1
      return (b.load.priceRub ?? 0) - (a.load.priceRub ?? 0)
    })
    return withKm.slice(0, 6)
  }, [loadsWithPoints, basePointForSort])

  const topFromCities = useMemo(() => {
    const origin = basePointForSort
    // Сколько грузов в каждом городе
    const counts = new Map<string, number>()
    for (const load of loadsWithPoints) {
      const city = shortCity(load.fromCity)
      if (city) counts.set(city, (counts.get(city) ?? 0) + 1)
    }
    // Километраж от базы до города погрузки
    const rows: Array<{ city: string; count: number; km: number | null }> = []
    for (const [city, count] of counts) {
      const load = loadsWithPoints.find((item) => shortCity(item.fromCity) === city)
      const point = load?.fromPoint ?? null
      const km =
        origin && point && Number.isFinite(point.lat) && Number.isFinite(point.lng)
          ? Math.round(haversineKm(origin, point))
          : null
      rows.push({ city, count, km })
    }
    rows.sort((a, b) => {
      if (a.km !== null && b.km !== null) return a.km - b.km
      if (a.km !== null) return -1
      if (b.km !== null) return 1
      return b.count - a.count
    })
    return rows.slice(0, 6)
  }, [loadsWithPoints, basePointForSort])

  /**
   * Список берём из грузов кэша и додобранных — но НЕ из loadsWithPoints.
   * Живой замер: со списком от loadsWithPoints точки не досчитывались никогда:
   * эффект точек ставил cityPoints -> пересобирался loadsWithPoints ->
   * менялся cityList -> эффект точек запускался заново. Круг.
   */
  const cityList = useMemo(() => {
    const places = new Set<string>()
    for (const load of [...usableLoads, ...foundLoads]) {
      if (load.fromCity && load.fromCity !== "—") places.add(load.fromCity)
      if (load.toCity && load.toCity !== "—") places.add(load.toCity)
    }
    return [...places]
  }, [usableLoads, foundLoads])

  useEffect(() => {
    if (!user || cityList.length === 0) {
      setCityPoints(null)
      setPointsLoading(false)
      return
    }
    let alive = true
    const controller = new AbortController()
    setPointsLoading(true)
    const batches: string[][] = []
    for (let index = 0; index < cityList.length; index += POINTS_BATCH) {
      batches.push(cityList.slice(index, index + POINTS_BATCH))
    }
    void (async () => {
      const merged: Record<string, { lat: number; lng: number } | null> = {}
      for (let index = 0; index < batches.length; index += POINTS_PARALLEL) {
        const wave = batches.slice(index, index + POINTS_PARALLEL)
        const answers = await Promise.all(
          wave.map(async (batch) => {
            try {
              const res = await fetch(
                `/api/ati/cities/points?places=${encodeURIComponent(batch.join("|"))}`,
                { credentials: "include", cache: "no-store", signal: controller.signal },
              )
              if (!res.ok) return {}
              const data = await res.json()
              return (data?.points ?? {}) as Record<string, { lat: number; lng: number } | null>
            } catch {
              return {}
            }
          }),
        )
        for (const answer of answers) Object.assign(merged, answer)
        // Доливаем к уже посчитанным, а не заменяем: после додобора список
        // городов растёт, и прежние точки не должны пропадать из состояния.
        if (alive) setCityPoints((prev) => ({ ...(prev ?? {}), ...merged }))
      }
      if (alive) {
        setCityPoints((prev) => ({ ...(prev ?? {}), ...merged }))
        setPointsLoading(false)
      }
    })()
    return () => {
      alive = false
      controller.abort()
    }
  }, [user, cityList])

  const startPoint = useMemo(() => {
    if (!startCity.trim()) return null
    const city = cityOfAddress(startCity)
    if (!city) return null
    // 1. Центр города из геокодера
    const fromGeocoder = cityPoints?.[normalizeCityKey(city)] ?? null
    if (fromGeocoder) return fromGeocoder
    // 2. Геокодер не знает город — берём точку погрузки любого груза из
    //    этого города: она и есть точка в городе, точнее центра не нужно
    const anyLoad = loadsWithPoints.find(
      (load) => load.fromPoint && normalizeCityKey(shortCity(load.fromCity)) === normalizeCityKey(city),
    )
    return anyLoad?.fromPoint ?? null
  }, [cityPoints, startCity, loadsWithPoints])

  // ── Построение маршрута ──
  // Таймер анимации живёт в ref: если логист ушёл с экрана mid-анимации,
  // интервал гасится — иначе он стучится в размонтированный компонент.
  const buildTimer = useRef<number | null>(null)
  /** Сколько раз автододобор грузов «по пути» уже срабатывал в этой сборке. */
  const autoExtendRef = useRef(0)
  useEffect(() => () => {
    if (buildTimer.current !== null) window.clearInterval(buildTimer.current)
  }, [])

  /**
   * Собрать варианты маршрута. `instant` — без анимации: после отказа
   * фрахтователя или при переключении варианта ждать два секунды глупо,
   * логист работает в темпе телефонных звонков.
   */
  function runBuild(
    start: string,
    keep: string[],
    exclude: string[],
    hoursLimit?: number,
    instant = false,
    /**
     * Грузы, додобранные прямо сейчас. Состояние (foundLoads) обновляется
     * асинхронно, и без явной передачи пересборка увидела бы старый список.
     */
    extraLoads: BuilderLoad[] = [],
  ) {
    // Своя сборка — свой счётчик додоборов: иначе одна автоматическая
    // догрузка «съедала» бы попытки всех следующих нажатий. Пересборку после
    // додобора (instant) не считаем новой сборкой — иначе счётчик обнулялся
    // бы и додобор пошёл бы по кругу.
    if (!instant) autoExtendRef.current = 0
    if (!start.trim()) {
      toast.error("Укажите город, откуда едете")
      return
    }

    const build = async () => {
      // Мгновенная пересборка не показывает экран «собираю», и на экране
      // ничего не происходит: логист думает, что кнопка не сработала.
      // Сборка синхронная, поэтому без короткой паузы индикатор не успевает
      // появиться в DOM ни на один кадр.
      setRebuilding(true)
      await new Promise((resolve) => window.setTimeout(resolve, 350))
      // Пока геокодер считает расстояния между городами, строить рано:
      // без точек «по пути» не считается, и маршрут выходит из одного
      // плеча. Живой прогон: нажали через 50 секунд после открытия экрана —
      // одно плечо на 706 км; через две с половиной минуты — три плеча на
      // 1344 км. Логист нажал кнопку и готов подождать, поэтому ждём
      // точки, но не бесконечно.
      const startedAt = Date.now()
      while (pointsLoadingRef.current && Date.now() - startedAt < POINTS_WAIT_MS) {
        await new Promise((resolve) => window.setTimeout(resolve, 500))
      }

      // Сборщику отдаём ГОРОД базы, а не полный адрес. Ключ города он
      // считает через shortCity + normalizeCityKey: «Ярославль. Ул.
      // Докучалова 12» превращается в «ярославль ул докучалова 12» и не
      // совпадает ни с одним грузом «Ярославль, Ярославская область».
      // Живой замер: помощник с базой из настроек organisation отвечал
      // «грузов на бирже сейчас нет», хотя грузов из Ярославля было 92.
      // Точный адрес нужен только для координат — они приходят отдельно
      // (startPoint), а стыковка идёт по названию города.
      const startPlace = cityOfAddress(start) || start.trim()
      // Живой замер: додобор дважды отвечал 200 и по 39 грузов, а маршрут
      // оставался из одного плеча — пересборка шла по прошлому списку.
      const seen = new Set(loadsWithPoints.map((load) => load.id))
      const extra = extraLoads.filter((load) => !seen.has(load.id))
      const pool = extra.length > 0 ? [...loadsWithPoints, ...extra] : loadsWithPoints
      // Запреты: из аргумента ПЛЮС актуальные из ref. Аргумент мог прийти от
      // обработчика, который ещё не дождался setExcludeIds.
      const excludeAll = Array.from(new Set([...exclude, ...excludeRef.current]))
      // Согласованные: тоже объединяем — иначе пересборка «забывала» груз,
      // по которому логист уже договорился.
      const keepAll = Array.from(new Set([...keep, ...keepRef.current]))
      // Собираем ПОД ТУ МАШИНУ, которую выбрал логист.
      //
      // Было: сборщику отдавался весь автопарк, он перебирал все машины и
      // брал самую выгодную. Логист выбирал 5-тонную — а маршрут строился на
      // 20-тонной, и в результат попадал груз на 10.8 т. На экране это
      // выглядело как «в пятитонку положили десять тонн». Проверка веса в
      // сборщике при этом работала — её просто не спрашивали.
      const buildVehicles =
        vehicleId && vehicles.some((item) => item.id === vehicleId)
          ? vehicles.filter((item) => item.id === vehicleId)
          : vehicles
      const built = buildRouteVariants({
        startCity: startPlace,
        loads: pool,
        vehicles: buildVehicles,
        fuelPriceRubPerL: 62,
        keepIds: keepAll,
        excludeIds: excludeAll,
        detourKm,
        startRadiusKm,
        maxHours: hoursLimit ?? maxHours,
        startPoint,
      })
      setVariants(built)
      setVariantIndex(0)
      setPhase("route")
      setRebuilding(false)
      // Что именно поменялось — словами. Без этого после отказа логист видит
      // новый маршрут и не понимает, учли ли его действие.
      if (instant) {
        const before = routeRef.current
        const after = built[0]?.route ?? null
        if (after) {
          const wasIds = before?.legs.map((leg) => leg.load.id).join(",") ?? ""
          const nowIds = after.legs.map((leg) => leg.load.id).join(",")
          if (before && wasIds !== nowIds) {
            toast.success(
              `Маршрут пересобран: ${after.legs.length} плеч, ${formatMoney(after.totalProfitRub ?? after.totalRevenue)} прибыли`,
            )
          }
        }
      }
      if (built.length === 0) {
        setRebuilding(false)
        toast.error("Из этого города не собралось ни одного окупаемого плеча")
        return
      }
      // Цепочка оборвалась, а срок не выбран — хватаем грузы рядом с той
      // точкой, где машина стоит, и пересобираем. Без этого маршрут из
      // любого города собирался в одно плечо: в своём регионе грузов «по
      // пути» почти не бывает, зато биржа рядом с машиной их отдаёт.
      const stalled = built[0]?.route
      if (stalled && canExtend(stalled)) void extendAlongRoute(stalled)
    }

    if (instant) {
      void build()
      return
    }

    setPhase("building")
    setBuildStep(0)
    setWaitingPoints(false)

    // Анимация построения: шаги с задержкой, затем результат
    const startedAt = Date.now()
    let step = 0
    const tick = window.setInterval(() => {
      step += 1
      if (step < BUILD_STEPS.length) {
        setBuildStep(step)
        return
      }
      // Точки городов ещё считаются. Без них «по пути» не считается и
      // маршрут выйдет из одного плеча, поэтому не показываем результат
      // заранее: шаги идут по кругу, а подписью честно говорим, чего ждём.
      // Ждём не бесконечно — сборщик сам прекратит ждать через POINTS_WAIT_MS.
      if (pointsLoadingRef.current && Date.now() - startedAt < POINTS_WAIT_MS) {
        setWaitingPoints(true)
        setBuildStep(step % BUILD_STEPS.length)
        return
      }
      window.clearInterval(tick)
      buildTimer.current = null
      setWaitingPoints(false)
      void build()
    }, 420)
    buildTimer.current = tick
  }

  /**
   * Есть ли смысл добрать грузы: машина не дома и цепочка не уперлась в кап
   * плеч.
   *
   * Условие «осталось время» убрано намеренно. Живой замер: маршрут на трое
   * суток заканчивался в Краснодаре с 1401 км порожнего возврата, при этом
   * цепочка время под возврат зарезервировала (проверка плеча считает дорогу
   * домой). Груза домой в пуле не было — а спросить биржу «откуда стоим →
   * куда база» никто не пробовал, потому что додобор запускался только при
   * свободном времени. Когда замер поправил: обратка из Краснодара влезает в
   * зарезервированное под возврат время, и маршрут едет домой с грузом.
   */
  function canExtend(route: BuiltRoute): boolean {
    if (autoExtendRef.current >= MAX_AUTO_EXTEND) return false
    if (route.legs.length === 0 || route.legs.length >= 8) return false
    if (route.returnsHomeWithLoad) return false
    const city = shortCity(route.legs[route.legs.length - 1]?.load.toCity)
    return Boolean(city) && city !== "—"
  }

  /** Регион из адреса груза: «Тула, Тульская область» -> «Тульская область». */
  function regionOfAddress(address: string): string | null {
    const parts = String(address ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
    return parts.find((part) => /(область|край|республика|АО|автономн)/i.test(part)) ?? null
  }

  /**
   * Город или регион в справочнике ATI. Биржа принимает в фильтре только
   * числовой id своего словаря, по названию город не резолвится.
   */
  async function lookupAtiPlace(
    name: string,
  ): Promise<{ id: number; name: string; fullName?: string } | null> {
    const clean = name.split(",")[0].trim()
    if (!clean) return null
    try {
      const res = await fetch(`/api/ati/geo?q=${encodeURIComponent(clean)}`, { credentials: "include" })
      const rows: Array<{ id: number; name: string; fullName: string }> = await res.json().catch(() => [])
      return rows[0] ?? null
    } catch {
      return null
    }
  }

  /**
   * Добрать грузы вокруг точки, где стоит машина, и пересобрать маршрут.
   *
   * Зачем: помощник строит цепочку из грузов СВОЕГО региона, а выгрузился
   * может быть в любом — там свои грузы, своих «по пути» в кэше нет. Живой
   * замер для базы «Новосибирск»: маршрут на трое суток = одно плечо
   * Новосибирск -> Домодедово, хотя в Домодедове биржа отдаёт грузы и
   * дальше. Поэтому спрашиваем биржу вокруг текущей точки (радиус «по
   * пути») и пересобираем, сохранив уже собранные плечи.
   */
  /** Ответ /api/ati/scan — то, что нужно додобору. */
  type ScanAnswer = {
    success?: boolean
    found?: number
    loads?: Array<Record<string, unknown>>
    error?: string
  }

  async function extendAlongRoute(route: BuiltRoute) {
    const place = route.legs[route.legs.length - 1]?.load.toCity ?? ""
    const city = shortCity(place)
    if (!city || city === "—") return
    autoExtendRef.current += 1

    // Справочник ATI знает не все поселения: «Шелангер п. (Звениговский р-н)»
    // он не находит, зато находит «Республику Марий Эл» — а она написана в
    // том же адресе груза. Живой замер для базы «Нижний Новгород»: маршрут
    // кончался в Шелангере и обрывался, потому что город не резолвился.
    // Поэтому пробуем город, затем регион из того же адреса, и напоследок —
    // регион базы: машина обычно ещё в своих краях («Среднесибирский п.» не
    // знает никто, а Новосибирская область — в справочнике).
    const region = regionOfAddress(place)
    const geo =
      (await lookupAtiPlace(city)) ??
      (region ? await lookupAtiPlace(region) : null) ??
      (serverRegionRoot ? await lookupAtiPlace(serverRegionRoot) : null)
    if (!geo) {
      setExtendNote({
        kind: "geo",
        text: `Справочник ATI не узнал «${city}» — грузы рядом добрать нечем. Маршрут собран из грузов вашей базы.`,
      })
      return
    }

    // Регион базы — цель обратки. Его считает сервер из адреса организации,
    // id — сайтовый (биржа принимает в фильтре только числовой id).
    const baseRegion = loadsState.data?.baseRegion ?? null
    const homeGeo =
      baseRegion && baseRegion.id > 0
        ? { id: baseRegion.id, name: baseRegion.name }
        : serverRegionRoot
          ? await lookupAtiPlace(serverRegionRoot)
          : null

    // Два поиска вокруг точки, где стоит машина.
    //
    // 1) Все грузы nearby — цепочка может продолжаться дальше.
    // 2) Грузы, которые везут В РЕГИОН БАЗИ — обратка. Этого поиска не было
    //    вовсе, и маршрут регулярно заканчивался порожним пробегом домой:
    //    живой замер давал 151–1401 км порожняком. Причина не в бирже — в
    //    нашем вопросе. Пул помощника фильтруется по РЕГИОНУ БАЗЫ и смотрит
    //    на город ПОГРУЗКИ, поэтому груз «Серпухов → Ярославль» в пул не
    //    попадает никогда: он из чужого региона. А биржа по такому условию
    //    отдаёт десятки грузов — «Московская область → Ярославская область»
    //    ответила 39 грузами, из них Серпухов → Ярославль за 60 000 ₽.
    // Радиус «откуда» у поиска обратки — максимум из детура, радиуса первого
    // плеча и дороги домой. Три причины:
    //   * справочник ATI знает не все поселения и отдаёт регион
    //     («Среднесибирский п.» → «Новосибирская область») — при радиусе 150
    //     от областного центр груз «Барнаул → Новосибирск» не находится;
    //   * машина и так поедет домой пустой, поэтому груз по дороге домой
    //     берём даже дальше детура: 559 км порожняка vs 559 км с грузом.
    const homeKm = Math.round(route.returnDeadheadKm ?? 0)
    const fromRadius = Math.max(detourKm, startRadiusKm, homeKm)
    const scanBody = (extra: Record<string, unknown>) => ({
      manualMode: true,
      source: "exchange",
      fromGeo: { id: geo.id, name: geo.name, fullName: geo.fullName },
      fromRadius,
      maxPages: EXTEND_PAGES,
      pageStart: 1,
      filters: {},
      ...extra,
    })

    const homeScan: Promise<ApiMutationResult<ScanAnswer>> = homeGeo
      ? apiSend<ScanAnswer>("/api/ati/scan", "POST", scanBody({
          toGeo: { id: homeGeo.id, name: homeGeo.name },
          toRadius: startRadiusKm,
        }))
      : Promise.resolve({ ok: false, error: "Регион базы не определён" })
    const [nearby, home] = await Promise.all([
      apiSend<ScanAnswer>("/api/ati/scan", "POST", scanBody({})),
      homeScan,
    ])

    const failed = [nearby, home].find((item) => !item.ok || !item.data?.success)
    if (failed) {
      // Текст ошибки ATI часто заканчивается точкой — вторую не добавляем.
      const reason = String(
        (failed as { data?: { error?: string } }).data?.error ??
          (failed as { error?: string }).error ??
          "нет связи",
      ).replace(/[.\s]+$/, "")
      setExtendNote({
        kind: "exchange",
        text: `Биржа ATI не отдала грузы рядом с ${geo.name}: ${reason}. Маршрут собран только из грузов вашей базы.`,
      })
      return
    }

    const nearbyRows = nearby.data?.loads ?? []
    const homeRows = home.data?.loads ?? []
    const rowsFound = [...nearbyRows, ...homeRows]
    if (rowsFound.length === 0) {
      setExtendNote({
        kind: "empty",
        text: `В радиусе ${detourKm} км от ${geo.name} биржа отдала грузы, но все без ставки или не по нашей специализации.`,
      })
      return
    }
    const mapped: BuilderLoad[] = rowsFound.map((row: any) => ({
      id: String(row.id),
      loadId: row.atiLoadId ?? null,
      fromCity: row.routeFrom,
      toCity: row.routeTo,
      weightKg: row.weight,
      volumeM3: row.volume,
      cargoType: row.cargoType,
      priceRub: row.price,
      priceWithNds: row.vatIncluded ? row.price : null,
      distanceKm: row.distance,
      firmName: row.firmName,
      firmUrl: row.firmUrl ?? null,
      contactPhone: row.contactPhone,
      loadingDate: row.loadingDate,
      status: row.status ?? "new",
      fromPoint: row.fromPoint ?? null,
      toPoint: row.toPoint ?? null,
      source: row.source === "exchange" ? "exchange" : "boards",
    }))
    // Точки городов додобранных грузов: без них «по пути» от новой точки
    // не считается, и цепочка снова оборвётся на одном плече.
    const withPoints = mapped.map((load) => ({
      ...load,
      fromPoint: load.fromPoint ?? cityPoints?.[normalizeCityKey(shortCity(load.fromCity))] ?? null,
      toPoint: load.toPoint ?? cityPoints?.[normalizeCityKey(shortCity(load.toCity))] ?? null,
    }))
    const seen = new Set(foundLoadsRef.current.map((load) => load.id))
    const added = withPoints.filter((load) => !seen.has(load.id))
    foundLoadsRef.current = [...foundLoadsRef.current, ...added]
    setFoundLoads(foundLoadsRef.current)
    setExtendNote(null)
    toast(`Рядом с «${geo.name}» нашлись грузы — пересобираю маршрут`, {
      description:
        homeRows.length > 0
          ? `Биржа отдала ${rowsFound.length} грузов вокруг точки, где стоит машина, из них ${homeRows.length} везут в ${homeGeo?.name ?? "регион базы"}`
          : `Биржа отдала ${rowsFound.length} грузов вокруг точки, где стоит машина`,
    })
    // Пересборка сохраняет уже собранные плечи: они согласованы или просто
    // выбраны, и терять их из-за додобора нельзя.
    runBuild(
      startCity,
      route.legs.map((leg) => leg.load.id),
      excludeIds,
      route.maxHours,
      true,
      foundLoadsRef.current,
    )
  }

  /**
   * «Собрать регион»: вытянуть грузы общей биржи вокруг базы к себе в базу.
   *
   * Общая биржа отдаёт страницами по ~12 грузов, поэтому одно нажатие —
   * это пачка страниц. Следующее нажатие идёт глубже (harvestPage), так
   * база постепенно наполняется, а помощник строит из накопленного.
   */
  async function runHarvest() {
    // Откуда собирать регион: поле поиска → база организации → город старта.
    // База организации главнее памяти браузера: у каждой компании свой
    // регион, и собрать надо вокруг её стоянки.
    const from = searchFrom.trim() || baseCity.trim() || startCity.trim()
    if (!from) {
      toast.error("Укажите город базы — от него и собираем регион")
      return
    }

    // Другой город или радиус — начинаем сбор с первой страницы и очищаем
    // набранное: грузы прошлого региона в этом маршруте не нужны (в кэше они
    // остаются, ничего не теряется).
    const scope = `${from}|${searchRadius}`
    const freshStart = scope !== harvestScope
    if (freshStart) {
      setHarvestScope(scope)
      setHarvestPage(1)
      setFoundLoads([])
    }
    const startPage = freshStart ? 1 : harvestPage

    setSearchBusy(true)
    try {
      const res = await fetch(
        `/api/ati/geo?q=${encodeURIComponent(from.split(",")[0].trim())}`,
        { credentials: "include" },
      )
      const rows: Array<{ id: number; name: string; fullName: string }> = await res
        .json()
        .catch(() => [])
      const geo = rows[0]
      if (!geo) {
        // ATI принимает в фильтре только числовой id своего словаря
        // населённых пунктов и по названию город не резолвится. Поэтому
        // «ничего не собрано» было бы неправдой — говорим, в чём дело.
        toast.error(
          `Город «${from}» не найден в справочнике ATI — биржа ищет только по id своего словаря. Укажите крупный город рядом: из него регион соберётся так же.`,
        )
        return
      }

      const result = await apiSend<{
        success?: boolean
        found?: number
        loads?: Array<Record<string, unknown>>
        totalItems?: number
        nextPageStart?: number
        error?: string
      }>("/api/ati/scan", "POST", {
        manualMode: true,
        source: "exchange",
        fromGeo: { id: geo.id, name: geo.name, fullName: geo.fullName },
        fromRadius: searchRadius,
        maxPages: HARVEST_PAGES,
        pageStart: startPage,
        filters: {},
      })

      if (!result.ok || !result.data?.success) {
        toast.error(result.data?.error || result.error || "Не удалось собрать регион")
        return
      }

      const collected = result.data.found ?? 0
      if (result.data.nextPageStart) setHarvestPage(result.data.nextPageStart)
      else setHarvestPage(startPage + 1)

      // Собранное сразу отдаём сборщику — он строит из накопленного
      const rowsFound = result.data.loads ?? []
      if (rowsFound.length > 0) {
        const mapped: BuilderLoad[] = rowsFound.map((row: any) => ({
          id: String(row.id),
          loadId: row.atiLoadId ?? null,
          fromCity: row.routeFrom,
          toCity: row.routeTo,
          weightKg: row.weight,
          volumeM3: row.volume,
          cargoType: row.cargoType,
          truckType: row.truckType ?? null,
          priceRub: row.price,
          priceWithNds: row.vatIncluded ? row.price : null,
          distanceKm: row.distance,
          firmName: row.firmName,
          firmUrl: row.firmUrl ?? null,
          contactPhone: row.contactPhone,
          loadingDate: row.loadingDate,
          status: row.status ?? "new",
          fromPoint: row.fromPoint ?? null,
          toPoint: row.toPoint ?? null,
          source: row.source === "exchange" ? "exchange" : "boards",
        }))
        setFoundLoads((prev) => {
          const seen = new Set(prev.map((load) => load.id))
          return [...prev, ...mapped.filter((load) => !seen.has(load.id))]
        })
      }

      const total = result.data.totalItems ?? 0
      setSearchResult({
        found: collected,
        byCity: 0,
        byRadius: 0,
        warning: null,
        totalItems: total,
      })
      const inBuilder = freshStart ? collected : foundLoads.length + collected
      toast.success(
        collected > 0
          ? `Собрано грузов: ${collected}. Помощнику доступно ${inBuilder}.`
          : freshStart
            ? "По этому городу биржа грузов не отдала — попробуйте увеличить радиус"
            : "На этой странице биржи новых грузов нет — нажмите ещё раз",
      )
      loadsState.reload()
    } finally {
      setSearchBusy(false)
    }
  }

  /**
   * Живой поиск по бирже — те же поля, что на сайте ATI: Откуда, Куда, радиус.
   *
   * Найденные грузы скан кладёт в кэш организации, поэтому после поиска
   * перечитываем биржу: помощник строит из того же списка, что и на экране
   * «биржа». Оба поля необязательны — можно искать только «Куда».
   */
  async function runLiveSearch() {
    const from = searchFrom.trim()
    const to = searchTo.trim()
    if (!from && !to) {
      toast.error("Укажите «Откуда» или «Куда» — как на сайте ATI")
      return
    }

    setSearchBusy(true)
    // Город → id ATI: общей бирже нужен идентификатор, а не название.
    // Подсказка берёт id из того же справочника, что использует сайт.
    const resolveCity = async (name: string) => {
      try {
        const res = await fetch(
          `/api/ati/geo?q=${encodeURIComponent(name.split(",")[0].trim())}`,
          { credentials: "include" },
        )
        const rows: Array<{ id: number; name: string; fullName: string; region: string }> =
          await res.json().catch(() => [])
        const hit = rows[0]
        return hit ? { id: hit.id, name: hit.name, fullName: hit.fullName, region: hit.region } : null
      } catch {
        return null
      }
    }
    const [fromGeo, toGeo] = await Promise.all([
      from ? resolveCity(from) : Promise.resolve(null),
      to ? resolveCity(to) : Promise.resolve(null),
    ])

    const result = await apiSend<{
      success?: boolean
      found?: number
      loads?: Array<Record<string, unknown>>
      matched?: { byCity?: number; byRadius?: number }
      bySource?: { boards: number; exchange: number }
      totalItems?: number
      geoWarning?: string | null
      /** Ошибки отдельных источников: в режиме «Всё» один может не ответить */
      errors?: string[]
      error?: string
    }>("/api/ati/scan", "POST", {
      manualMode: true,
      source: searchSource,
      fromGeo: from ? (fromGeo ?? { name: from, fullName: from }) : null,
      toGeo: to ? (toGeo ?? { name: to, fullName: to }) : null,
      fromRadius: searchRadius,
      toRadius: searchRadius,
      filters: {},
    })
    setSearchBusy(false)

    if (!result.ok || !result.data?.success) {
      toast.error(result.data?.error || result.error || "Поиск не удался")
      return
    }

    const foundCount = result.data.found ?? 0
    // В режиме «Всё» источники независимы: если общая биржа не ответила,
    // молча показать только число с площадок — обмануть диспетчера. Он
    // должен знать, что второй источник не сработал.
    const sourceErrors = (result.data.errors ?? []).filter(Boolean)
    setSearchResult({
      found: foundCount,
      byCity: result.data.matched?.byCity ?? 0,
      byRadius: result.data.matched?.byRadius ?? 0,
      warning: [result.data.geoWarning, ...sourceErrors].filter(Boolean).join(" ") || null,
      bySource: result.data.bySource,
      totalItems: result.data.totalItems,
    })

    // Найденные грузы отдаём сборщику сразу: кэш помощник показывает
    // списком до 300 строк, а общая биржа отдаёт тысячи.
    const foundRows = result.data.loads ?? []
    if (foundRows.length > 0) {
      const mapped: BuilderLoad[] = foundRows.map((row: any) => ({
        id: String(row.id),
        loadId: row.atiLoadId ?? null,
        fromCity: row.routeFrom,
        toCity: row.routeTo,
        weightKg: row.weight,
        volumeM3: row.volume,
        cargoType: row.cargoType,
        truckType: row.truckType ?? null,
        priceRub: row.price,
        priceWithNds: row.vatIncluded ? row.price : null,
        distanceKm: row.distance,
        firmName: row.firmName,
        firmUrl: row.firmUrl ?? null,
        contactPhone: row.contactPhone,
        loadingDate: row.loadingDate,
        status: row.status ?? "new",
        fromPoint: row.fromPoint ?? null,
        toPoint: row.toPoint ?? null,
        source: row.source === "exchange" ? "exchange" : "boards",
      }))
      setFoundLoads((prev) => {
        const seen = new Set(prev.map((load) => load.id))
        return [...prev, ...mapped.filter((load) => !seen.has(load.id))]
      })
    }

    toast.success(
      foundCount > 0
        ? `Найдено грузов: ${foundCount}. Они уже в бирже помощника.`
        : "По этому фильтру грузов нет",
    )
    // Найденные грузы легли в кэш — перечитываем биржу, чтобы помощник
    // строил маршрут из них, а не из устаревшего списка.
    loadsState.reload()
  }

  /** Переключение варианта: тот же выезд, другой лимит часов — пересборка. */
  function selectVariant(index: number) {
    const variant = variants[index]
    if (!variant) return
    setVariantIndex(index)
    runBuild(startCity, keepIds, excludeIds, variant.hours, true)
  }

  function refreshAll() {
    setRefreshing(true)
    loadsState.reload()
    vehiclesState.reload()
    driversState.reload()
    window.setTimeout(() => {
      setRefreshing(false)
      toast.success("Данные обновлены")
      // Маршрут уже построен — пересобираем на свежих грузах, иначе он
      // показывает вчерашнюю биржу
      if (route) runBuild(startCity, keepIds, excludeIds, route ? variants[variantIndex]?.hours : undefined)
    }, 800)
  }

  /** Отказ фрахтователя: убираем груз и пересобираем, согласованные остаются. */
  function declineLoad(loadId: string) {
    setCalls((prev) => ({ ...prev, [loadId]: "declined" }))
    // ref пишем ДО сборки: иначе auto-додобор внутри runBuild пересоберёт
    // маршрут по старому списку запретов, и отказанный груз вернётся.
    const keep = keepRef.current.filter((id) => id !== loadId)
    const exclude = Array.from(new Set([...excludeRef.current, loadId]))
    keepRef.current = keep
    excludeRef.current = exclude
    setKeepIds(keep)
    setExcludeIds(exclude)
    toast("Груз убран — пересобираю маршрут")
    runBuild(startCity, keep, exclude, variants[variantIndex]?.hours, true)
  }

  /** Убрать груз из маршрута без статуса отказа. */
  function removeLoad(loadId: string) {
    const keep = keepRef.current.filter((id) => id !== loadId)
    const exclude = Array.from(new Set([...excludeRef.current, loadId]))
    keepRef.current = keep
    excludeRef.current = exclude
    setKeepIds(keep)
    setExcludeIds(exclude)
    setCalls((prev) => {
      const next = { ...prev }
      delete next[loadId]
      return next
    })
    runBuild(startCity, keep, exclude, variants[variantIndex]?.hours, true)
  }

  function markCall(loadId: string, status: CallStatus) {
    setCalls((prev) => ({ ...prev, [loadId]: status }))
    if (status === "agreed" && !keepIds.includes(loadId)) {
      const keep = [...keepIds, loadId]
      setKeepIds(keep)
      // В объяснении сразу видно, что согласованный груз закреплён: он
      // останется в маршруте при любой пересборке
      setVariants((current) =>
        current.map((variant, index) =>
          index === variantIndex
            ? {
                ...variant,
                route: {
                  ...variant.route,
                  reasons: [
                    ...variant.route.reasons.filter((reason) => !reason.startsWith("Согласованные грузы")),
                    `Согласованные грузы сохранены: ${
                      variant.route.legs.filter((leg) => keep.includes(leg.load.id)).length
                    }`,
                  ],
                },
              }
            : variant,
        ),
      )
    }
    if (status === "declined") {
      declineLoad(loadId)
    }
  }

  /** Отправить машину: грузы → заказы → рейс с экипажем. */
  async function sendRoute() {
    if (!route) return
    setPhase("sending")
    try {
      const vehicle =
        vehicles.find((item) => item.id === vehicleId) ?? route.vehicle ?? null
      const driver = vehicle
        ? drivers.find((item) => item.vehicleId === vehicle.id) ??
          drivers.find((item) => item.status === "available") ??
          null
        : null

      // 1. Каждый груз биржи становится нашим заказом (этап «Поиск»)
      const orderIds: string[] = []
      for (const leg of route.legs) {
        const result = await apiSend<{
          order: { id: string }
          code?: string
        }>("/api/orders/from-cache", "POST", {
          cacheId: leg.load.id,
          // fetchContacts НЕ передаём намеренно: ATI.SU делает замечания за
          // автоматический сбор контактных данных. Телефон фрахтователя
          // диспетчер добирает кнопкой «Узнать телефон», когда сам решит
          // позвонить, — это отдельное осознанное действие, а не побочный
          // эффект отправки маршрута.
        })
        if (result.ok && result.data?.order) {
          orderIds.push(result.data.order.id)
        } else if (result.data?.code === "already_taken" && result.data?.order?.id) {
          // Груз уже взят в работу раньше (например, с экрана биржи) —
          // используем тот заказ, дубликат не нужен
          orderIds.push(result.data.order.id)
        } else {
          toast.error(result.error ?? `Не удалось взять груз ${shortCity(leg.load.fromCity)} → ${shortCity(leg.load.toCity)}`)
          setPhase("route")
          return
        }
      }

      // 2. Рейс: заказы + машина + водитель
      const created = await apiSend<{ route: { id: string } }>("/api/routes", "POST", {
        orderIds,
        vehicleId: vehicle?.id ?? null,
        driverId: driver?.id ?? null,
        name: `Маршрут: ${route.path.join(" → ")}`,
      })
      if (created.ok && created.data?.route) {
        toast.success(driver ? "Машина в пути — водителю ушло уведомление" : "Рейс создан — назначьте водителя")
        router.push(`/lm/routes/${created.data.route.id}`)
      } else {
        toast.error(created.error ?? "Не удалось создать рейс")
        setPhase("route")
      }
    } catch {
      toast.error("Не удалось отправить машину")
      setPhase("route")
    }
  }

  // ═══════════════ Экран ═══════════════
  return (
    <>
      <LogistHeader
        title="Сборка маршрута"
        subtitle="Грузы биржи → цепочка → машина в пути"
        back
        userName={user?.name}
        action={
          <button
            type="button"
            onClick={refreshAll}
            disabled={refreshing}
            aria-label="Обновить"
            className="flex h-10 w-10 items-center justify-center rounded-full text-foreground/80 active:bg-secondary/60 disabled:opacity-50"
          >
            <RefreshCw className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        }
      />

      <div className="px-4 pt-4 pb-8 lg:px-6 lg:pt-5">
        {error ? (
          <ErrorState
            message={error}
            onRetry={() => {
              loadsState.reload()
              vehiclesState.reload()
            }}
          />
        ) : loading ? (
          <ListSkeleton rows={3} />
        ) : phase === "setup" ? (
          <SetupPhase
            startCity={startCity}
            setStartCity={(value) => {
              setStartCity(value)
              window.localStorage.setItem(START_CITY_KEY, value)
            }}
            topFromCities={topFromCities}
            nearestLoads={nearestLoads}
            baseCity={baseCity}
            baseRegionName={baseRegionName}
            regionEmpty={baseRegionName !== null && regionLoads.length === 0}
            onHarvestRegion={() => void runHarvest()}
            harvestBusy={searchBusy}
            vehicles={freeVehicles}
            allVehiclesBusy={freeVehicles.length === 0 && vehicles.length > 0}
            vehicleId={vehicleId}
            setVehicleId={setVehicleId}
            drivers={drivers}
            usableLoadsCount={usableLoads.length}
            fitLoads={loadsWithPoints.length > 0 ? loadsWithPoints : loads}
            detourKm={detourKm}
            setDetourKm={setDetourKm}
            startRadiusKm={startRadiusKm}
            setStartRadiusKm={setStartRadiusKm}
            maxHours={maxHours}
            setMaxHours={setMaxHours}
            pointsLoading={pointsLoading}
            noStartPoint={cityPoints !== null && startCity.trim().length > 0 && !startPoint}
            onBuild={() => runBuild(startCity, keepIds, excludeIds, maxHours)}
            sourceNote={loadsState.data?.source?.note ?? null}
            searchProps={{
              from: searchFrom,
              setFrom: setSearchFrom,
              to: searchTo,
              setTo: setSearchTo,
              radius: searchRadius,
              setRadius: setSearchRadius,
              busy: searchBusy,
              result: searchResult,
              onSearch: () => void runLiveSearch(),
              source: searchSource,
              setSource: setSearchSource,
              onHarvest: () => void runHarvest(),
              baseCity,
            }}
          />
        ) : phase === "building" ? (
          <BuildingPhase step={buildStep} waitingPoints={waitingPoints} />
        ) : variants.length > 0 && route ? (
          <>
            {rebuilding ? (
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-2 text-[12.5px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Пересобираю маршрут с учётом отказа…
              </div>
            ) : null}
          <RoutePhase
            route={route}
            calls={calls}
            phones={phones}
            contactBusy={contactBusy}
            onFetchPhone={(loadId) => void fetchPhone(loadId)}
            keepIds={keepIds}
            onCall={markCall}
            onRemove={removeLoad}
            onRebuild={() => {
              setCalls({})
              setKeepIds([])
              setExcludeIds([])
              runBuild(startCity, [], [], variants[variantIndex]?.hours, true)
            }}
            onBack={() => setPhase("setup")}
            onSend={() => void sendRoute()}
            sending={phase === "sending"}
            variants={variants}
            activeVariant={variantIndex}
            onSelectVariant={selectVariant}
            loadsScanned={loads.length}
            loadsTotal={loadsState.data?.total ?? loads.length}
            extendNote={extendNote}
            onMoreHours={(hours) => {
              setMaxHours(hours)
              runBuild(startCity, keepIds, excludeIds, hours, true)
            }}
          />
          </>
        ) : (
          <FailedPhase
            startCity={cityOfAddress(startCity) || startCity}
            loads={loadsWithPoints}
            vehicles={vehicles}
            startRadiusKm={startRadiusKm}
            startPoint={startPoint}
            maxHours={maxHours}
            sourceNote={loadsState.data?.source?.note ?? null}
            onMoreHours={() => {
              const longer = nextHoursStep(maxHours)
              setMaxHours(longer)
              runBuild(startCity, keepIds, excludeIds, longer, true)
            }}
            onWiderRadius={() => {
              // Провал часто = «груз есть, но дальше радиуса» — пробуем шире
              const wider = startRadiusKm >= 1200 ? 1200 : startRadiusKm + 200
              setStartRadiusKm(wider)
              runBuild(startCity, keepIds, excludeIds, maxHours, true)
            }}
            onPickCity={(city) => {
              setStartCity(city)
              window.localStorage.setItem(START_CITY_KEY, city)
              runBuild(city, keepIds, excludeIds, maxHours, true)
            }}
            onOtherCity={() => setPhase("setup")}
            onRefresh={refreshAll}
          />
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Шаг 1. Куда едем
// ---------------------------------------------------------------------------

/**
 * Откуда берём грузы — честная подпись.
 *
 * Логист сравнивает программу с сайтом ATI, где видны все грузы биржи.
 * API ATI.SU отдаёт только грузы площадок организации, и это не наша
 * прихоть — молчать об этом нельзя, иначе «программа не работает».
 */
function SourceNoteCard({ note, loadsCount }: { note: string | null; loadsCount: number }) {
  if (!note) return null
  return (
    <Card>
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-foreground">Откуда берём грузы</p>
          <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{note}</p>
          <p className="mt-1.5 text-[12px] text-muted-foreground">
            Сейчас в бирже помощника грузов: {loadsCount}.
          </p>
        </div>
      </div>
    </Card>
  )
}

/**
 * Живой поиск по бирже — те же поля, что на сайте ATI.
 *
 * Помощник строит маршрут из накопленной биржи, но если грузов из твоего
 * города в ней нет, тупик недопустим: здесь можно спросить биржу прямо
 * сейчас — «Откуда», «Куда», радиус. Найденные грузы ложатся в кэш, и
 * помощник сразу строит из них.
 */
function LiveSearchCard({
  from,
  setFrom,
  to,
  setTo,
  radius,
  setRadius,
  busy,
  result,
  onSearch,
  defaultFrom,
  source,
  setSource,
  onHarvest,
  baseCity,
}: {
  from: string
  setFrom: (value: string) => void
  to: string
  setTo: (value: string) => void
  radius: number
  setRadius: (value: number) => void
  busy: boolean
  result: {
    found: number
    byCity: number
    byRadius: number
    warning: string | null
    bySource?: { boards: number; exchange: number }
    totalItems?: number
  } | null
  onSearch: () => void
  defaultFrom: string
  /** Где искать: площадки организации, общая биржа или оба источника */
  source: "boards" | "exchange" | "both"
  setSource: (value: "boards" | "exchange" | "both") => void
  /** Вытянуть биржу региона к себе в базу (общая биржа, несколько страниц) */
  onHarvest: () => void
  /** База своей организации: от неё собирается регион */
  baseCity: string
}) {
  // Свёрнуто по умолчанию: помощник — про сборку маршрута, а поиск нужен,
  // когда грузов из своего города в бирже не нашлось.
  const [open, setOpen] = useState(false)

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-[40px] w-full items-center justify-between gap-2 text-left active:opacity-70"
      >
        <span className="flex min-w-0 flex-1 items-start gap-2">
          <Search className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-foreground">Поиск на бирже ATI</span>
            <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">
              Как на сайте: город и радиус. Оба поля необязательны — можно искать только «Куда».
            </span>
          </span>
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {open ? (
      <div className="mt-3 space-y-2.5 border-t border-border pt-3">
        <label className="block">
          <span className="text-[12px] text-muted-foreground">Откуда (по умолчанию — ваша база)</span>
          <div className="mt-1 flex items-center gap-2 rounded-xl border border-border bg-background px-3">
            <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              placeholder="Город или адрес базы"
              className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground/70"
            />
          </div>
        </label>

        <label className="block">
          <span className="text-[12px] text-muted-foreground">Куда</span>
          <div className="mt-1 flex items-center gap-2 rounded-xl border border-border bg-background px-3">
            <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="Город, откуда едем"
              className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground/70"
            />
          </div>
        </label>

        <div>
          <span className="text-[12px] text-muted-foreground">Радиус, км</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {[50, 100, 200, 300, 500].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setRadius(value)}
                className={`min-h-[34px] rounded-md border px-3 text-[12.5px] active:opacity-70 ${
                  radius === value
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-border text-foreground/90"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="text-[12px] text-muted-foreground">Где искать</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
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
                className={`min-h-[34px] rounded-md border px-3 text-[12.5px] active:opacity-70 ${
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
            «Площадки» — официальный API ATI: грузы организаций, где мы участник. «Общая биржа» —
            поиск сайта loads.ati.su: все грузы биржи. «Всё» — оба источника сразу.
          </p>
        </div>

        <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">
          {baseCity.trim()
            ? `Регион сбора — вокруг вашей базы: ${baseCity.trim()}. База берётся из настроек автопарка, у каждой компании своя.`
            : "Регион сбора — вокруг города из поля «Откуда»."}
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSearch}
            disabled={busy}
            className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-[14px] font-medium text-primary-foreground active:opacity-80 disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Ищу…
              </>
            ) : (
              <>
                <Search className="h-4 w-4" />
                Искать
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onHarvest}
            disabled={busy}
            title="Вытянуть грузы общей биржи вокруг вашей базы к себе в базу"
            className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-border px-3 text-[13px] text-foreground active:opacity-70 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Собрать регион
          </button>
        </div>

        {result ? (
          <div className="rounded-xl border border-border bg-secondary/30 px-3 py-2.5">
            {result.found > 0 ? (
              <>
                <p className="text-[12.5px] leading-snug text-foreground">
                  Найдено грузов: <b>{result.found}</b>. Они уже в бирже помощника — стройте маршрут.
                </p>
                {result.bySource ? (
                  <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                    С площадок: {result.bySource.boards} · с общей биржи: {result.bySource.exchange}
                    {result.totalItems
                      ? ` · всего по фильтру биржа обещает ${result.totalItems}`
                      : ""}
                  </p>
                ) : (
                  <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                    По городу: {result.byCity} · по радиусу: {result.byRadius}
                    {result.totalItems ? ` · всего по фильтру ${result.totalItems}` : ""}
                  </p>
                )}
              </>
            ) : (
              <p className="text-[12.5px] leading-snug text-foreground">
                На площадках организации таких грузов нет. Попробуйте увеличить радиус или убрать
                один из городов.
              </p>
            )}
            {result.warning ? (
              <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{result.warning}</p>
            ) : null}
            </div>
        ) : null}
      </div>
      ) : null}
    </Card>
  )
}

function SetupPhase({
  startCity,
  setStartCity,
  topFromCities,
  nearestLoads,
  baseCity,
  baseRegionName,
  regionEmpty,
  onHarvestRegion,
  harvestBusy,
  vehicles,
  allVehiclesBusy,
  vehicleId,
  setVehicleId,
  drivers,
  usableLoadsCount,
  fitLoads,
  detourKm,
  setDetourKm,
  startRadiusKm,
  setStartRadiusKm,
  maxHours,
  setMaxHours,
  pointsLoading,
  noStartPoint,
  onBuild,
  sourceNote,
  searchProps,
}: {
  startCity: string
  setStartCity: (value: string) => void
  topFromCities: Array<{ city: string; count: number; km: number | null }>
  /** Ближайшие к базе грузы — «заказы», которые видит пользователь */
  nearestLoads: Array<{ load: BuilderLoad; km: number | null }>
  /** База своей организации из настроек автопарка */
  baseCity: string
  /** Регион базы — из него берём грузы */
  baseRegionName: string | null
  /** В своём регионе грузов нет — надо собрать */
  regionEmpty: boolean
  /** Собрать биржу региона к себе в базу */
  onHarvestRegion: () => void
  harvestBusy: boolean
  vehicles: BuilderVehicle[]
  allVehiclesBusy: boolean
  vehicleId: string
  setVehicleId: (value: string) => void
  drivers: MobileDriver[]
  usableLoadsCount: number
  /** Пул грузов «как есть» — по нему считаем, что влезет в выбранную машину */
  fitLoads: BuilderLoad[]
  detourKm: number
  setDetourKm: (value: number) => void
  /** Радиус поиска первого груза от базы, км */
  startRadiusKm: number
  setStartRadiusKm: (value: number) => void
  /** Длина маршрута по времени: лимит часов в пути */
  maxHours: number
  setMaxHours: (value: number) => void
  /** Точки городов ещё считаются — «по пути» пока не работает */
  pointsLoading: boolean
  /** Для выбранного города нет координат — только точное совпадение городов */
  noStartPoint: boolean
  onBuild: () => void
  /** Честная подпись об источнике грузов (площадки ATI организации) */
  sourceNote: string | null
  /** Живой поиск по бирже — те же поля, что на сайте ATI */
  searchProps: {
    from: string
    setFrom: (value: string) => void
    to: string
    setTo: (value: string) => void
    radius: number
    setRadius: (value: number) => void
    busy: boolean
    result: {
      found: number
      byCity: number
      byRadius: number
      warning: string | null
      bySource?: { boards: number; exchange: number }
      totalItems?: number
    } | null
    onSearch: () => void
    /** Где искать: площадки организации, общая биржа или оба источника */
    source: "boards" | "exchange" | "both"
    setSource: (value: "boards" | "exchange" | "both") => void
    /** Вытянуть биржу региона к себе в базу */
    onHarvest: () => void
    /** База своей организации: от неё собирается регион */
    baseCity: string
  }
}) {
  const selected = vehicles.find((vehicle) => vehicle.id === vehicleId) ?? vehicles[0] ?? null
  const driver = selected ? drivers.find((item) => item.vehicleId === selected.id) ?? null : null
  // Радиусы — редкость: свёрнуты, чтобы первый экран был «город → машина → ехать»
  const [advancedOpen, setAdvancedOpen] = useState(false)

  return (
    <div className="space-y-5 lg:mx-auto lg:max-w-3xl">
      {/* Откуда едем */}
      <Card>
        <label className="block text-[13px] font-medium text-foreground">
          Откуда едете (база или город машины)
        </label>
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-border bg-background px-3">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={startCity}
            onChange={(event) => setStartCity(event.target.value)}
            placeholder="Город, откуда едем"
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground/70"
          />
        </div>

        {/* База СВОЕЙ организации. У каждой компании адрес свой, и маршрут
            обязан начинаться от её стоянки, а не от города по умолчанию. */}
        {baseCity.trim() ? (
          <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-snug text-muted-foreground">
            <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Ваша база из настроек: <span className="text-foreground">{baseCity.trim()}</span>. Сбор
              и маршрут идут от неё.
            </span>
          </p>
        ) : (
          <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
            Адрес базы не указан в настройках автопарка — помощник строит от введённого города.
          </p>
        )}

        {pointsLoading ? (
          <p className="mt-2 text-[12px] text-muted-foreground">Считаю расстояния между городами биржи…</p>
        ) : noStartPoint ? (
          <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
            Для этого города нет точных координат — маршрут соберём только по точному совпадению
            городов. Укажите ближайший крупный город, чтобы работали грузы «по пути».
          </p>
        ) : null}

        {topFromCities.length > 0 ? (
          <div className="mt-2.5">
            <p className="text-[12px] text-muted-foreground">
              Грузы есть вот в этих городах — ближе к вашей базе:
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {topFromCities.map((row) => (
                <button
                  key={row.city}
                  type="button"
                  onClick={() => setStartCity(row.city)}
                  className={`min-h-[34px] rounded-md border px-3 text-[12.5px] active:opacity-70 ${
                    startCity === row.city
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border text-foreground/90"
                  }`}
                >
                  {row.city}
                  {row.km !== null ? ` · ${row.km} км` : ` · ${row.count} груз(а)`}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      {/* Грузы на бирже — те самые «заказы». Без этого списка пользователь
          видит только названия городов и спрашивает «где заказы?». */}
      {nearestLoads.length > 0 ? (
        <Card>
          <p className="text-[13px] font-medium text-foreground">
            Грузы на бирже — ближе к вашей базе
          </p>
          <div className="mt-2 divide-y divide-border">
            {nearestLoads.map(({ load, km }) => (
              <div key={load.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground">
                    {shortCity(load.fromCity)} → {shortCity(load.toCity)}
                  </p>
                  <p className="truncate text-[11.5px] text-muted-foreground">
                    {[
                      km !== null ? `${Math.round(km)} км от базы` : null,
                      load.weightKg ? `${Math.round(load.weightKg / 1000)} т` : null,
                      load.loadingDate ? `с ${formatDateShort(load.loadingDate)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <p className="shrink-0 text-[13px] font-semibold text-success">
                  {formatMoney(load.priceRub)}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
            Это грузы, где сейчас можно строить. Нажмите «Собрать маршрут» — помощник сложит их в
            цепочку от вашей базы.
          </p>
        </Card>
      ) : null}

      {/* В своём регионе грузов нет — не тупик, а кнопка «собрать регион» */}
      {regionEmpty ? (
        <Card className="border-primary/25 bg-primary/[0.06]">
          <p className="text-[13px] font-medium text-foreground">
            В {baseRegionName ?? "вашем регионе"} грузов в базе пока нет
          </p>
          <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
            Помощник берёт грузы только из вашего региона — компании из Ярославля не нужен груз из
            Новосибирска. Соберите биржу региона: помощник запросит её у ATI и сложит к себе.
          </p>
          <button
            type="button"
            onClick={onHarvestRegion}
            disabled={harvestBusy}
            className="mt-2.5 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-[14px] font-semibold text-primary-foreground active:opacity-70 disabled:opacity-50"
          >
            {harvestBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Package className="h-4 w-4" />
            )}
            {harvestBusy ? "Собираю биржу региона…" : `Собрать биржу ${baseRegionName ?? "региона"}`}
          </button>
        </Card>
      ) : null}

      {/* Откуда берём грузы — честно, без преувеличений */}
      <SourceNoteCard note={sourceNote} loadsCount={usableLoadsCount} />

      {/* Живой поиск по бирже: когда из своего города грузов нет */}
      <LiveSearchCard
        from={searchProps.from}
        setFrom={searchProps.setFrom}
        to={searchProps.to}
        setTo={searchProps.setTo}
        radius={searchProps.radius}
        setRadius={searchProps.setRadius}
        busy={searchProps.busy}
        result={searchProps.result}
        onSearch={searchProps.onSearch}
        defaultFrom={startCity}
        source={searchProps.source}
        setSource={searchProps.setSource}
        onHarvest={searchProps.onHarvest}
        baseCity={searchProps.baseCity}
      />

      {/* Машина */}
      <Card>
        <p className="text-[13px] font-medium text-foreground">Машина</p>
        {vehicles.length === 0 ? (
          <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground">
            {allVehiclesBusy
              ? "Все машины заняты или на ТО. Маршрут всё равно можно построить — машину назначите позже."
              : "Свободных машин нет. Маршрут всё равно можно построить — машину назначите позже."}
          </p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {vehicles.map((vehicle) => {
              const active = (vehicleId || vehicles[0]?.id) === vehicle.id
              const vehicleDriver = drivers.find((item) => item.vehicleId === vehicle.id) ?? null
              return (
                <button
                  key={vehicle.id}
                  type="button"
                  onClick={() => setVehicleId(vehicle.id)}
                  className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left active:opacity-70 ${
                    active ? "border-primary/40 bg-primary/10" : "border-border"
                  }`}
                >
                  <Truck className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium text-foreground">{vehicle.plate}</span>
                    <span className="mt-0.5 block text-[12px] text-muted-foreground">
                      {vehicle.type ?? "машина"}
                      {vehicle.capacity ? ` · ${formatWeightKg(vehicle.capacity)}` : ""}
                      {vehicleDriver ? ` · ${vehicleDriver.name}` : " · водитель не закреплён"}
                    </span>
                  </span>
                  {active ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                </button>
              )
            })}
          </div>
        )}
        {selected && !driver ? (
          <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
            За {selected.plate} не закреплён водитель — при отправке назначим свободного.
          </p>
        ) : null}
        {selected ? <VehicleFitNote vehicle={selected} loads={fitLoads} /> : null}
      </Card>

      {/* Насколько едем — главный рычаг, он на виду */}
      <Card>
        <p className="text-[13px] font-medium text-foreground">Сколько едем</p>
        <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
          Помощник набирает грузы, пока маршрут укладывается в это время: около 55 км/ч с грузом,
          от 2 до 5 часов на погрузку-выгрузку по весу груза, отдых водителя после 9 часов за
          рулём и ожидание дат загрузки. Чем дольше едем — тем
          больше денег, но и больше смен в пути.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {HOURS_STEPS.map((hours) => (
            <button
              key={hours}
              type="button"
              onClick={() => setMaxHours(hours)}
              className={`min-h-[38px] rounded-md border px-3 text-[13px] active:opacity-70 ${
                maxHours === hours
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border text-foreground/90"
              }`}
            >
              {hoursLabel(hours)}
            </button>
          ))}
        </div>
      </Card>

      {/* Тонкая настройка: логист заходит сюда редко, поэтому свёрнуто */}
      <Card>
        <button
          type="button"
          onClick={() => setAdvancedOpen((value) => !value)}
          className="flex min-h-[40px] w-full items-center justify-between gap-2 text-left active:opacity-70"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-foreground">Тонкая настройка</span>
            <span className="mt-0.5 block text-[12px] text-muted-foreground">
              радиус первого груза {startRadiusKm} км · грузы «по пути» {detourKm} км
            </span>
          </span>
          {advancedOpen ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </button>

        {advancedOpen ? (
          <div className="mt-3 space-y-4 border-t border-border pt-3">
            <div>
              <p className="text-[13px] font-medium text-foreground">Радиус поиска от базы</p>
              <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                Насколько километров от начала маршрута ищем первый груз. Грузов из вашего города
                нет — помощник возьмёт ближайший в этом радиусе. Порожний выезд уже учтён в прибыли.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[100, 200, 300, 500, 800, 1200].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStartRadiusKm(value)}
                    className={`min-h-[34px] rounded-md border px-3 text-[12.5px] active:opacity-70 ${
                      startRadiusKm === value
                        ? "border-primary/40 bg-primary/15 text-primary"
                        : "border-border text-foreground/90"
                    }`}
                  >
                    {value} км
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[13px] font-medium text-foreground">Грузы «по пути»</p>
              <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                Насколько в стороне от маршрута берём следующие грузы — так цепочка не обрывается на
                одном плече.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[50, 100, 150, 300].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDetourKm(value)}
                    className={`min-h-[34px] rounded-md border px-3 text-[12.5px] active:opacity-70 ${
                      detourKm === value
                        ? "border-primary/40 bg-primary/15 text-primary"
                        : "border-border text-foreground/90"
                    }`}
                  >
                    {value} км
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </Card>


      {/* Что будет */}
      <Card className="border-primary/25 bg-primary/[0.06]">
        <p className="text-[13px] leading-snug text-muted-foreground">
          Помощник пройдёт по {usableLoadsCount} грузам биржи и сложит цепочку по датам загрузки: из
          вашего города — в соседний, оттуда — дальше, и обратно домой с грузом. Убыточные плеча не
          берёт, а сколько едем — покажет картой и датами. В конце предложит варианты: короче или
          подольше.
        </p>
        <button
          type="button"
          onClick={onBuild}
          disabled={usableLoadsCount === 0}
          className="mt-3 flex min-h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-[16px] font-semibold text-primary-foreground active:opacity-70 disabled:opacity-40"
        >
          <RouteIcon className="h-5 w-5" />
          Построить маршрут
        </button>
        {usableLoadsCount === 0 ? (
          <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground">
            Свежих грузов на бирже нет. Нажмите «Обновить» в шапке — подтянем новые с ATI.
          </p>
        ) : null}
        <Link
          href="/lm/search"
          className="mt-3 flex min-h-[40px] items-center justify-center gap-1.5 text-[13px] font-medium text-primary active:opacity-70"
        >
          <Package className="h-4 w-4" />
          Открыть биржу грузов
        </Link>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Шаг 2. Анимация построения
// ---------------------------------------------------------------------------

function BuildingPhase({ step, waitingPoints }: { step: number; waitingPoints?: boolean }) {
  return (
    <div className="pt-10">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/15">
        <RouteIcon className="h-8 w-8 animate-pulse text-primary" />
      </div>
      <p className="mt-4 text-center text-[16px] font-semibold text-foreground">Строим маршрут</p>
      {waitingPoints ? (
        <p className="mx-auto mt-2 max-w-[280px] text-center text-[12.5px] leading-snug text-muted-foreground">
          Считаю расстояния между городами биржи — без них не видно грузы «по
          пути», а маршрут вышел бы из одного плеча.
        </p>
      ) : null}
      <ul className="mx-auto mt-5 max-w-[280px] space-y-2.5">
        {BUILD_STEPS.map((text, index) => {
          const done = index < step
          const active = index === step
          return (
            <li
              key={text}
              className={`flex items-center gap-2.5 text-[13.5px] ${
                done ? "text-foreground/70" : active ? "text-foreground" : "text-muted-foreground/50"
              }`}
            >
              {done ? (
                <Check className="h-4 w-4 shrink-0 text-primary" />
              ) : active ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
              ) : (
                <span className="h-4 w-4 shrink-0 rounded-full border border-border" />
              )}
              {text}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Провал: объясняем причину и показываем, откуда можно строить
// ---------------------------------------------------------------------------

function FailedPhase({
  startCity,
  loads,
  vehicles,
  startRadiusKm,
  startPoint,
  onWiderRadius,
  onPickCity,
  onOtherCity,
  onRefresh,
  maxHours,
  onMoreHours,
  sourceNote,
}: {
  startCity: string
  loads: BuilderLoad[]
  vehicles: BuilderVehicle[]
  startRadiusKm: number
  /** Точка базы — без неё «рядом» считается только по городу */
  startPoint: Point | null
  maxHours: number
  onWiderRadius: () => void
  onPickCity: (city: string) => void
  onOtherCity: () => void
  onRefresh: () => void
  onMoreHours: () => void
  /** Честная подпись об источнике грузов — чтобы провал не выглядел поломкой */
  sourceNote: string | null
}) {
  // Причина провала — из тех же данных, что и сборка
  const reason = useMemo(
    () =>
      explainFailure({
        startCity,
        loads,
        vehicles,
        fuelPriceRubPerL: 62,
        maxHours,
        startRadiusKm,
        startPoint,
      }),
    [startCity, loads, vehicles, maxHours, startRadiusKm, startPoint],
  )

  /**
   * Ближайший к базе груз со ставкой — из него строим, когда из самого
   * города пусто. База «Москва», а грузы стоят в Ступино и Раменском:
   * объяснять «грузов нет» — тупик, логист едет за ближайшим.
   */
  const nearestLoad = useMemo(() => {
    if (!startPoint) return null
    let best: { city: string; km: number } | null = null
    for (const load of loads) {
      if (load.status !== "new") continue
      if ((load.priceWithNds ?? load.priceRub ?? 0) <= 0) continue
      if (!load.fromPoint) continue
      const km = haversineKm(startPoint, load.fromPoint)
      if (!best || km < best.km) best = { city: shortCity(load.fromCity), km }
    }
    return best
  }, [loads, startPoint])

  // Города, из которых маршрут СТРОИТСЯ прямо сейчас — первыми кандидатами
  const workingCities = useMemo(() => {
    const counts = new Map<string, number>()
    for (const load of loads) {
      if (load.status !== "new") continue
      if ((load.priceWithNds ?? load.priceRub ?? 0) <= 0) continue
      const city = shortCity(load.fromCity)
      counts.set(city, (counts.get(city) ?? 0) + 1)
    }
    return [...counts.entries()]
      .filter(([city]) => city !== cityOfAddress(startCity))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
  }, [loads, startCity])

  return (
    <div className="space-y-4 lg:mx-auto lg:max-w-3xl">
      {/* Сначала честно — откуда грузы: провал не должен выглядеть поломкой */}
      <SourceNoteCard note={sourceNote} loadsCount={loads.length} />

      <Card className="border-warning/30 bg-warning/[0.06]">
        <p className="text-[16px] font-semibold text-foreground">Маршрут не собрался</p>
        <p className="mt-1 text-[13.5px] leading-snug text-foreground/90">{reason?.headline}</p>
        {reason && reason.loadsFromCity > 0 ? (
          <ul className="mt-2.5 space-y-1">
            {reason.tooHeavy > 0 ? (
              <li className="text-[12.5px] text-muted-foreground">
                · {reason.tooHeavy} груз(ов) тяжелее ваших машин
              </li>
            ) : null}
            {reason.noPrice > 0 ? (
              <li className="text-[12.5px] text-muted-foreground">
                · {reason.noPrice} без озвученной ставки
              </li>
            ) : null}
            {reason.overdue > 0 ? (
              <li className="text-[12.5px] text-muted-foreground">
                · {reason.overdue} с прошедшей датой загрузки
              </li>
            ) : null}
            {reason.unprofitable > 0 ? (
              <li className="text-[12.5px] text-muted-foreground">
                · {reason.unprofitable} не окупаются после топлива
              </li>
            ) : null}
            {reason.tooLong > 0 ? (
              <li className="text-[12.5px] text-muted-foreground">
                · {reason.tooLong} едут дольше выбранного срока
              </li>
            ) : null}
          </ul>
        ) : null}
      </Card>

      {/* Из своего города пусто, но рядом грузы — ведём строить от ближайшего */}
      {reason && reason.loadsFromCity === 0 && reason.loadsNearbyPriced > 0 ? (
        <Card className="border-primary/25 bg-primary/[0.06]">
          <p className="text-[13px] font-medium text-foreground">Рядом с базой есть грузы</p>
          <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
            В радиусе {startRadiusKm} км — {reason.loadsNearbyPriced} со озвученной ставкой.
            {nearestLoad
              ? ` Ближайший — ${nearestLoad.city}, ≈ ${Math.round(nearestLoad.km)} км от базы.`
              : ""}
          </p>
          {nearestLoad ? (
            <button
              type="button"
              onClick={() => onPickCity(nearestLoad.city)}
              className="mt-2.5 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-4 text-[14px] font-semibold text-primary-foreground active:opacity-70"
            >
              <MapPin className="h-4 w-4" />
              Строить от {nearestLoad.city}
            </button>
          ) : null}
        </Card>
      ) : null}

      {/* Откуда можно строить — один тап и маршрут строится оттуда */}
      {workingCities.length > 0 ? (
        <Card>
          <p className="text-[13px] font-medium text-foreground">Откуда сейчас можно строить</p>
          <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
            Города погрузки на биржи. Нажмите — помощник построит маршрут оттуда.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {workingCities.map(([city, count]) => (
              <button
                key={city}
                type="button"
                onClick={() => onPickCity(city)}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 text-[13px] font-medium text-primary active:opacity-70"
              >
                <MapPin className="h-3.5 w-3.5" />
                {city} · {count}
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onOtherCity}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-4 text-[14px] font-semibold text-primary-foreground active:opacity-70"
        >
          <MapPin className="h-4 w-4" />
          Другой город
        </button>
        {maxHours < 168 ? (
          <button
            type="button"
            onClick={onMoreHours}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-secondary px-4 text-[14px] font-medium text-foreground active:opacity-70"
          >
            <Clock className="h-4 w-4" />
            Ехать дольше ({hoursLabel(nextHoursStep(maxHours))})
          </button>
        ) : null}
        {startRadiusKm < 1200 ? (
          <button
            type="button"
            onClick={onWiderRadius}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-secondary px-4 text-[14px] font-medium text-foreground active:opacity-70"
          >
            <RouteIcon className="h-4 w-4" />
            Искать шире ({Math.min(startRadiusKm + 200, 1200)} км)
          </button>
        ) : null}
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-secondary px-4 text-[14px] font-medium text-foreground active:opacity-70"
        >
          <RefreshCw className="h-4 w-4" />
          Обновить биржу
        </button>
        <Link
          href="/lm/search"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-secondary px-4 text-[14px] font-medium text-foreground active:opacity-70"
        >
          <Package className="h-4 w-4" />
          Биржа
        </Link>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Шаг 3. Маршрут собран
// ---------------------------------------------------------------------------

function RoutePhase({
  route,
  calls,
  phones,
  contactBusy,
  onFetchPhone,
  keepIds,
  onCall,
  onRemove,
  onRebuild,
  onBack,
  onSend,
  sending,
  variants,
  activeVariant,
  onSelectVariant,
  loadsScanned,
  loadsTotal,
  extendNote,
  onMoreHours,
}: {
  route: BuiltRoute
  calls: Record<string, CallStatus>
  keepIds: string[]
  onCall: (loadId: string, status: CallStatus) => void
  onRemove: (loadId: string) => void
  onRebuild: () => void
  onBack: () => void
  onSend: () => void
  sending: boolean
  variants: RouteVariant[]
  activeVariant: number
  onSelectVariant: (index: number) => void
  /** Сколько грузов биржи осмотрел помощник и сколько их всего в кэше */
  loadsScanned: number
  loadsTotal: number
  /** Пересобрать маршрут с бóльшим лимитом времени */
  onMoreHours: (hours: number) => void
  /** Что стало с додобором грузов «по пути» — показываем, если он не сработал */
  extendNote: { kind: "geo" | "exchange" | "empty"; text: string } | null
  /** Контакты фрахтователей, показанные по нажатию диспетчера */
  phones: Record<string, string>
  contactBusy: string | null
  onFetchPhone: (loadId: string) => void
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [whyOpen, setWhyOpen] = useState(false)

  const agreedCount = route.legs.filter((leg) => calls[leg.load.id] === "agreed").length
  const declinedCount = route.legs.filter((leg) => calls[leg.load.id] === "declined").length
  const mapPoints = routeMapPoints(route)

  return (
    // На компьютере результат раскладывается в две колонки: слева итог, карта,
    // звонки и плечи — то, по чему принимают решение; справа остаток биржи и
    // объяснение — то, куда смотрят, если решение не нравится. В одну колонку
    // это девять блоков подряд, и на мониторе они уходят за экран.
    <div className="space-y-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] lg:items-start lg:gap-6 lg:space-y-0">
      <div className="space-y-5 lg:min-w-0">
      {/* Итог: деньги — главное */}
      <Card className="border-primary/25 bg-primary/[0.06]">
        <p className="text-[13px] text-muted-foreground">
          Маршрут собран · {route.path[0]} → {route.path[route.path.length - 1]}
          {route.vehicle?.plate ? ` · ${route.vehicle.plate}` : ""}
        </p>
        {/* Что за машина: логист должен видеть, под что собрано — иначе
            «пятитонка с грузом на десять тонн» выглядит как ошибка сборщика. */}
        {route.vehicle ? (
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {[
              route.vehicle.type,
              route.vehicle.capacity ? formatWeightKg(route.vehicle.capacity) : null,
              route.vehicle.volume ? `${route.vehicle.volume} м³` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
        <p className="mt-1 text-[30px] font-bold leading-none text-foreground lg:text-[40px]">
          {route.totalProfitRub !== null ? (
            <>
              {route.totalProfitRub < 0 ? "−" : "+"}
              {formatMoney(Math.abs(route.totalProfitRub))}
            </>
          ) : (
            "Прибыль не посчитана"
          )}
        </p>
        {route.totalProfitRub === null ? (
          <p className="mt-1 text-[12px] text-muted-foreground">
            У машины не заполнен расход топлива — прибыль нечем оценить
          </p>
        ) : null}

        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-primary/15 pt-3 sm:grid-cols-3 lg:grid-cols-4">
          <SummaryCell label="Выручка" value={formatMoney(route.totalRevenue)} />
          <SummaryCell
            label="Топливо"
            value={route.totalFuelCostRub !== null ? `≈ ${formatMoney(route.totalFuelCostRub)}` : "—"}
          />
          <SummaryCell label="Плеч" value={String(route.legs.length)} />
          <SummaryCell
            label="Расстояние"
            value={route.totalDistanceKm > 0 ? `≈ ${route.totalDistanceKm} км` : "—"}
          />
          {/* «В пути» — единственная ячейка с длинной строкой: «2.8 дня (68 ч)
              из 72 ч» в узкой колонке рвалась по «ч». Даём ей двойную ширину. */}
          <div className="col-span-2">
            <SummaryCell
              label="В пути"
              value={`${routeTimeText(route)} из ${route.maxHours} ч`}
            />
          </div>
          <SummaryCell
            label="На км"
            value={route.profitPerKm !== null ? formatMoney(route.profitPerKm) : "—"}
          />
          {/* По чему выбирается машина: маршрут ограничен сроком, значит главный
              показатель — прибыль за ЧАС времени машины. Показываем рядом с
              «на км», чтобы выбор был виден, а не только посчитан. */}
          <SummaryCell
            label="В час"
            value={route.profitPerHour !== null ? formatMoney(route.profitPerHour) : "—"}
          />
        </div>

        {/* Когда выезжаем и когда дома — план поездки, а не только деньги */}
        <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
          <span>Выезд {formatDateShort(route.departAt.toISOString())}</span>
          <ArrowRight className="h-3 w-3 shrink-0" />
          <span>дома ≈ {formatDateShort(route.homeAt.toISOString())}</span>
          {route.lateRiskLegs > 0 ? (
            <span className="inline-flex items-center gap-1 font-medium text-amber-600">
              <AlertTriangle className="h-3 w-3" />
              {formatCount(route.lateRiskLegs, ["плечо", "плеча", "плеч"])} с риском по дате
            </span>
          ) : null}
        </p>

        {/* Варианты: логист выбирает, а не программа за него */}
        {variants.length > 1 ? (
          <div className="mt-3 border-t border-primary/15 pt-3">
            <p className="text-[12.5px] font-medium text-foreground">Другие варианты этого выезда</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {variants.map((variant, index) => (
                <button
                  key={variant.kind}
                  type="button"
                  onClick={() => onSelectVariant(index)}
                  className={`min-h-[38px] rounded-lg border px-3 text-left active:opacity-70 ${
                    index === activeVariant
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border text-foreground/90"
                  }`}
                >
                  <span className="block text-[13px] font-medium">{variant.label}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {variant.hint} · {formatMoney(variant.route.totalProfitRub ?? 0)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {route.returnDeadheadKm > 0 ? (
          <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
            В конце — возврат в {route.path[0]}: ≈ {route.returnDeadheadKm} км порожнем, топливо на него
            уже учтено в прибыли.
          </p>
        ) : null}

        {/* Длина рейса днями: логист планирует не километры, а смены */}
        <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground">
          В пути {routeTimeText(route)} из лимита {route.maxHours} ч — с учётом дороги,
          погрузок, выгрузок, ожидания дат и возврата на базу
          {routeRestHours(route) > 0
            ? `, осталось ${hoursSpan(routeRestHours(route))}`
            : ", лимит выбран полностью"}
        </p>

        {/* Честная подпись о додоборе: почему цепочка не выросла */}
        {extendNote ? (
          <p className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-3 py-2 text-[12.5px] leading-snug text-foreground/90">
            {extendNote.text}
          </p>
        ) : null}

        {/* Что сделать, чтобы маршрут стал длиннее — по факту причины */}
        {/* Если додобор упал (справочник или биржа), совет «увеличьте радиус»
            врёт: радиус ни при чём, мы просто не увидели грузы. */}
        {route.growthHint && extendNote?.kind !== "exchange" && extendNote?.kind !== "geo" ? (
          <div className="mt-3 rounded-xl border border-primary/25 bg-primary/[0.06] px-3 py-2.5">
            <p className="text-[12.5px] leading-snug text-foreground/90">{route.growthHint}</p>
            {route.growthHours ? (
              <button
                type="button"
                onClick={() => onMoreHours(route.growthHours as number)}
                className="mt-2 inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground active:opacity-70"
              >
                <Clock className="h-4 w-4" />
                Пересобрать на {hoursLabel(route.growthHours)}
              </button>
            ) : null}
          </div>
        ) : null}

        {route.unprofitable ? (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-2 text-[12.5px] leading-snug text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Маршрут в убыток — отправлять невыгодно. Уберите груз или пересоберите.
          </p>
        ) : null}
        {route.needsFuelSetup ? (
          <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
            Заполните расход топлива у машины — помощник будет считать прибыль точно.
          </p>
        ) : null}
      </Card>

      {/* Форма поездки: логист принимает решение глазами.
          Если координат нет ни у одного груза (биржа отдала их без точек), блок
          не показываем вовсе: строка «точек пока нет» на компьютере занимала
          полосу под заголовком и выглядела как сломанная карта. О том, что
          километры считаны по прямой, честно сказано в «Почему собрал так». */}
      {mapPoints.length > 1 ? (
        <section>
          <h2 className="mb-2 px-1 text-[14px] font-semibold text-foreground">Как едем</h2>
          <Card>
            <RouteChainMapLazy points={mapPoints} />
          </Card>
        </section>
      ) : null}

      {/* Кому позвонить: рабочий список в порядке плеч */}
      <CallSheet
        route={route}
        calls={calls}
        phones={phones}
        contactBusy={contactBusy}
        onFetchPhone={onFetchPhone}
        onCall={onCall}
      />

      {/* Плечи: цепочка городов */}
      <section>
        <h2 className="mb-2 px-1 text-[14px] font-semibold text-foreground">Маршрут по плечам</h2>
        <div className="space-y-3">
          {route.legs.map((leg, index) => {
            const status = calls[leg.load.id] ?? "pending"
            const phone = telHref(phones[leg.load.id] ?? leg.load.contactPhone)
            return (
              <Card key={leg.load.id}>
                <div className="flex items-start gap-3">
                  {/* Точка маршрута */}
                  <div className="flex flex-col items-center pt-1">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-[12px] font-semibold text-primary">
                      {index + 1}
                    </span>
                    {index < route.legs.length - 1 ? (
                      <span className="mt-1 w-px flex-1 bg-border" aria-hidden />
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1">
                    {/* Направление */}
                    <p className="flex items-center gap-1.5 text-[15px] font-semibold leading-snug text-foreground">
                      <span className="truncate">{shortCity(leg.load.fromCity)}</span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{shortCity(leg.load.toCity)}</span>
                    </p>

                    {/* Обратка: груз везёт машину домой — порожнего возврата нет */}
                    {leg.returnsHome ? (
                      <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-primary/12 px-1.5 py-0.5 text-[11.5px] font-medium text-primary">
                        <Home className="h-3 w-3" />
                        Обратка домой
                      </p>
                    ) : null}

                    {/* Компания и груз — отдельными строками, без склеек */}
                    <p className="mt-1 truncate text-[13px] text-foreground/90">
                      {leg.load.firmName?.trim() || "Фрахтователь не указан"}
                      {leg.load.cargoType ? ` · ${leg.load.cargoType}` : ""}
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                      {leg.loadedKm > 0 ? `≈ ${leg.loadedKm} км` : "расстояние неизвестно"}
                      {/* Часы в leg.hours — это дорога, погрузка с выгрузкой и,
                          если вождение упирается в суточную норму, отдых.
                          Писать «80 км · 6 ч в пути» нельзя: логист читает это
                          как «машина ползёт 6 часов». Поэтому составляющие —
                          раздельно, и отдых назван отдыхом. */}
                      {leg.hours > 0
                        ? ` · ${Math.max(
                            1,
                            Math.round(
                              leg.deadheadKm / AVG_DEADHEAD_KMH + leg.loadedKm / AVG_LOADED_KMH,
                            ),
                          )} ч в пути + ${handlingHours(leg.load.weightKg)} ч на погрузку/выгрузку${
                            Math.round(
                              leg.deadheadKm / AVG_DEADHEAD_KMH + leg.loadedKm / AVG_LOADED_KMH,
                            ) > DRIVE_LIMIT_HOURS
                              ? ` + отдых ${REST_HOURS} ч (норма вождения ${DRIVE_LIMIT_HOURS} ч в сутки)`
                              : ""
                          }`
                        : ""}
                      {leg.load.weightKg ? ` · ${formatWeightKg(leg.load.weightKg)}` : ""}
                    </p>

                    {/* Дата загрузки: по ней логист понимает, успевает ли цепочка */}
                    <p
                      className={`mt-0.5 flex items-center gap-1 text-[12.5px] ${
                        leg.lateRisk ? "font-medium text-amber-600" : "text-muted-foreground"
                      }`}
                    >
                      {leg.lateRisk ? <AlertTriangle className="h-3 w-3 shrink-0" /> : null}
                      {leg.loadsAt
                        ? `Загрузка ${formatDateShort(leg.loadsAt.toISOString())}`
                        : "Дата загрузки не названа"}
                      {leg.loadsAt ? ` · приедем ≈ ${formatDateShort(leg.etaAt.toISOString())}` : ""}
                    </p>
                    {leg.waitHours >= 1 ? (
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        Ждём загрузки ≈ {Math.round(leg.waitHours)} ч — это время тоже в маршруте
                      </p>
                    ) : null}

                    {/* Деньги плеча */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-[14px] font-semibold tabular-nums text-foreground">
                        {formatMoney(leg.revenue)}
                      </span>
                      {leg.profitRub !== null ? (
                        <span
                          className={`text-[12.5px] font-medium tabular-nums ${
                            leg.profitRub >= 0 ? "text-primary" : "text-destructive"
                          }`}
                        >
                          прибыль {leg.profitRub >= 0 ? "+" : "−"}
                          {formatMoney(Math.abs(leg.profitRub))}
                        </span>
                      ) : null}
                      {leg.byTheWay ? (
                        <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-foreground/80">
                          {leg.homeLeg ? "по дороге домой" : "по пути"}
                        </span>
                      ) : null}
                    </div>

                    {leg.deadheadKm > 0 ? (
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        {leg.homeLeg
                          ? `+≈ ${leg.deadheadKm} км до погрузки по дороге домой — машина всё равно ехала в эту сторону`
                          : `+≈ ${leg.deadheadKm} км подъезда к погрузке — учтено в прибыли плеча`}
                      </p>
                    ) : null}

                    {/* Звонок и статус */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {phone ? (
                        <a
                          href={phone}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#1f6f3f] px-3 text-[13px] font-medium text-white active:opacity-70"
                        >
                          <Phone className="h-3.5 w-3.5" />
                          Позвонить
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onFetchPhone(leg.load.id)}
                          disabled={contactBusy === leg.load.id}
                          title="Показать контакт фрахтователя — один запрос в ATI по вашему нажатию"
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#1f6f3f] px-3 text-[13px] font-medium text-white active:opacity-70 disabled:opacity-50"
                        >
                          {contactBusy === leg.load.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Phone className="h-3.5 w-3.5" />
                          )}
                          Контакты
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onCall(leg.load.id, "agreed")}
                        className={`inline-flex min-h-[38px] items-center gap-1 rounded-lg border px-2.5 text-[12.5px] active:opacity-70 ${
                          status === "agreed"
                            ? "border-primary/40 bg-primary/15 text-primary"
                            : "border-border text-foreground/90"
                        }`}
                      >
                        <Check className="h-3.5 w-3.5" />
                        Договорились
                      </button>
                      <button
                        type="button"
                        onClick={() => onCall(leg.load.id, "declined")}
                        className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-border px-2.5 text-[12.5px] text-foreground/90 active:opacity-70"
                      >
                        <X className="h-3.5 w-3.5" />
                        Отказ
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(leg.load.id)}
                        className="inline-flex min-h-[38px] items-center rounded-lg px-2 text-[12.5px] text-muted-foreground active:opacity-70"
                      >
                        Убрать
                      </button>
                    </div>

                    {status === "agreed" ? (
                      <p className="mt-1.5 text-[12px] font-medium text-primary">
                        Согласовано — груз останется в маршруте при пересборке
                      </p>
                    ) : null}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      </section>

      {/* Договорённости: сколько созвонили */}
      {agreedCount + declinedCount > 0 ? (
        <p className="px-1 text-[12.5px] text-muted-foreground">
          Созвонились: {agreedCount} из {route.legs.length} договорились, {declinedCount} отказали
        </p>
      ) : null}

      {/* Отправка машины */}
      <Card className="border-primary/25 bg-primary/[0.06]">
        <p className="text-[12.5px] leading-snug text-muted-foreground">
          {agreedCount === route.legs.length && route.legs.length > 0
            ? "Все фрахтователи согласованы — можно отправлять."
            : "Отправлять можно и без полного согласования: что-то договоритесь уже в пути."}
        </p>
        <button
          type="button"
          onClick={onSend}
          disabled={sending || route.unprofitable}
          className="mt-3 flex min-h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-[16px] font-semibold text-primary-foreground active:opacity-70 disabled:opacity-40"
        >
          {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Truck className="h-5 w-5" />}
          {sending ? "Отправляю машину…" : "Отправить машину"}
        </button>
        <div className="mt-2.5 flex items-center gap-4">
          <button
            type="button"
            onClick={onRebuild}
            className="inline-flex min-h-[40px] items-center gap-1.5 text-[13px] font-medium text-foreground/80 active:opacity-70"
          >
            <RefreshCw className="h-4 w-4" />
            Пересобрать маршрут
          </button>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-[40px] items-center gap-1.5 text-[13px] font-medium text-foreground/80 active:opacity-70"
          >
            <MapPin className="h-4 w-4" />
            Другой город
          </button>
        </div>
      </Card>

      </div>

      <aside className="space-y-5">
      {/* Подробности: что осталось на бирже */}
      <section>
        <button
          type="button"
          onClick={() => setDetailsOpen((value) => !value)}
          className="flex min-h-[40px] w-full items-center justify-between rounded-xl px-1 text-[13px] font-medium text-foreground/80 active:opacity-70"
        >
          Что осталось на бирже ({route.leftover.usable})
          {detailsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {detailsOpen ? (
          <div className="mt-2 space-y-1.5">
            {/* Сколько чего: «осталось 99» — полуправда, если почти все без ставки */}
            <p className="px-1 text-[12.5px] leading-snug text-muted-foreground">
              {route.leftover.usable > 0
                ? `${formatCount(route.leftover.usable, ["груз", "груза", "грузов"])} подошли бы под машину, со ставкой и датой, но в цепочку не встали`
                : "Грузов, которые подошли бы под машину и дату, не осталось"}
              {/* Причины из другой выборки: это грузы, отсеянные ещё до цепочки */}
              {[route.leftover.noRate, route.leftover.pastDate, route.leftover.notFit].some(
                (value) => value > 0,
              )
                ? ` · ещё в регионе: ${[
                    route.leftover.noRate > 0
                      ? `${route.leftover.noRate} без озвученной ставки`
                      : null,
                    route.leftover.pastDate > 0
                      ? `${route.leftover.pastDate} с прошедшей датой загрузки`
                      : null,
                    route.leftover.notFit > 0
                      ? `${route.leftover.notFit} не влезает в эту машину`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}`
                : ""}
            </p>
            {/* Счётчик выше — про осмотренные грузы, а не про всю биржу */}
            {loadsScanned < loadsTotal ? (
              <p className="px-1 text-[12.5px] leading-snug text-muted-foreground">
                В расчёте — {loadsScanned} груза из {loadsTotal} вашего региона: помощник
                смотрит свежие записи кэша.
              </p>
            ) : null}
            {route.excluded.length === 0 ? (
              <p className="px-1 text-[12.5px] text-muted-foreground">Все грузы биржи уже в маршруте.</p>
            ) : (
              route.excluded.slice(0, 20).map(({ load, reason }) => (
                <div
                  key={load.id}
                  className="flex items-start gap-2 rounded-xl border border-border px-3 py-2"
                >
                  <Package className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-foreground">
                      {shortCity(load.fromCity)} → {shortCity(load.toCity)}
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {load.firmName?.trim() || "фрахтователь не указан"} · {reason}
                      {/* Дата загрузки: на одном маршруте у перевозчика бывает
                          несколько грузов под разные числа, и без даты в списке
                          это выглядит как один и тот же груз, повторённый дважды.
                          Живой замер: «Ростов-на-Дону → Ярославль» от частника
                          светилась пятью одинаковыми строками — с датами видно,
                          что это пять разных грузов. Если причина уже говорит,
                          что дата прошла, вторым разом её не повторяем. */}
                      {load.loadingDate && !/дата загрузки прошла/.test(reason)
                        ? ` · загрузка ${formatDateShort(String(load.loadingDate))}`
                        : ""}
                    </p>
                  </div>
                  {load.priceRub ? (
                    <span className="shrink-0 text-[12.5px] tabular-nums text-foreground/90">
                      {formatMoney(load.priceRub)}
                    </span>
                  ) : null}
                </div>
              ))
            )}
          </div>
        ) : null}
      </section>

      {/* Подробности: почему так собрал */}
      <section>
        <button
          type="button"
          onClick={() => setWhyOpen((value) => !value)}
          className="flex min-h-[40px] w-full items-center justify-between rounded-xl px-1 text-[13px] font-medium text-foreground/80 active:opacity-70"
        >
          Почему собрал так
          {whyOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {whyOpen ? (
          <ul className="mt-2 space-y-1.5 px-1">
            {route.reasons.map((reason) => (
              <li key={reason} className="text-[12.5px] leading-snug text-muted-foreground">
                · {reason}
              </li>
            ))}
            {keepIds.length > 0 ? (
              <li className="text-[12.5px] leading-snug text-muted-foreground">
                · Согласованные вами грузы: {keepIds.length}
              </li>
            ) : null}
          </ul>
        ) : null}
      </section>
      </aside>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Карта цепочки и список звонков
// ---------------------------------------------------------------------------

/** Leaflet тянет window при загрузке — на сервере упал бы при пререндере. */
const RouteChainMapLazy = dynamic(
  () =>
    import("@/components/logist-mobile/route-chain-map").then((module) => module.RouteChainMap),
  { ssr: false },
)

/**
 * Список звонков — рабочее окно логиста.
 *
 * Плечи ниже показывают деньги и детали, но звонить нужно быстро и по
 * порядку: фрахтователей пять, и лезть за каждым в карточку с расчётами
 * неудобно. Поэтому сверху — плоский список «компания → позвонить →
 * договорились / отказ», а статус один на всё: он же виден в плечах.
 */
function CallSheet({
  route,
  calls,
  phones,
  contactBusy,
  onFetchPhone,
  onCall,
}: {
  route: BuiltRoute
  calls: Record<string, CallStatus>
  onCall: (loadId: string, status: CallStatus) => void
  /** Контакты фрахтователей, показанные по нажатию диспетчера */
  phones: Record<string, string>
  contactBusy: string | null
  onFetchPhone: (loadId: string) => void
}) {
  const agreed = route.legs.filter((leg) => calls[leg.load.id] === "agreed").length
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-medium text-foreground">Кому позвонить</p>
        <p className="text-[12px] text-muted-foreground">
          договорились {agreed} из {route.legs.length}
        </p>
      </div>
      <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
        Порядок звонков — по порядку плеч. «Договорились» закрепляет груз: он останется в
        маршруте при любой пересборке.
      </p>
      <div className="mt-2.5 space-y-1.5">
        {route.legs.map((leg, index) => {
          const status = calls[leg.load.id] ?? "pending"
          const phone = telHref(phones[leg.load.id] ?? leg.load.contactPhone)
          return (
            <div
              key={leg.load.id}
              className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 ${
                status === "agreed"
                  ? "border-primary/30 bg-primary/[0.06]"
                  : status === "declined"
                    ? "border-border opacity-60"
                    : "border-border"
              }`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[12px] font-semibold text-foreground/80">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-foreground">
                  {leg.load.firmName?.trim() || "Фрахтователь не указан"}
                </p>
                <p className="truncate text-[12px] text-muted-foreground">
                  {shortCity(leg.load.fromCity)} → {shortCity(leg.load.toCity)}
                  {leg.loadsAt
                    ? ` · ${formatDateShort(leg.loadsAt.toISOString())}`
                    : " · дата не названа"}
                </p>
              </div>
              {phone ? (
                <a
                  href={phone}
                  className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg bg-[#1f6f3f] px-2.5 text-[12.5px] font-medium text-white active:opacity-70"
                >
                  <Phone className="h-3.5 w-3.5" />
                  {status === "agreed" ? "Ещё раз" : "Звонить"}
                </a>
              ) : leg.load.firmUrl ? (
                <button
                  type="button"
                  onClick={() => onFetchPhone(leg.load.id)}
                  disabled={contactBusy === leg.load.id}
                  title="Показать контакт фрахтователя — один запрос в ATI по вашему нажатию"
                  className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg bg-[#1f6f3f] px-2.5 text-[12.5px] font-medium text-white active:opacity-70 disabled:opacity-50"
                >
                  {contactBusy === leg.load.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Phone className="h-3.5 w-3.5" />
                  )}
                  Контакты
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onCall(leg.load.id, "agreed")}
                aria-label="Договорились"
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border active:opacity-70 ${
                  status === "agreed"
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-border text-foreground/80"
                }`}
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onCall(leg.load.id, "declined")}
                aria-label="Отказ"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-foreground/80 active:opacity-70"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Мелочи
// ---------------------------------------------------------------------------

/**
 * Сколько времени займёт маршрут — по часам, как его и планирует логист:
 * дорога (~55 км/ч с грузом) + погрузка-выгрузка по весу груза + отдых
 * водителя (11 ч после 9 ч за рулём) + возврат.
 * Ориентир для планировщика, а не обещание: точное время — после согласования.
 */
/** Сколько часов лимита осталось незанятыми — для честной строки про срок. */
function routeRestHours(route: BuiltRoute): number {
  return Math.round((route.maxHours - route.totalHours) * 10) / 10
}

function routeTimeText(route: BuiltRoute): string {
  const hours = route.totalHours
  if (!hours || hours <= 0) return "—"
  if (hours < 24) return `${Math.round(hours)} ч`
  const days = Math.round((hours / 24) * 10) / 10
  if (days === 1) return `1 день (${Math.round(hours)} ч)`
  if (days < 5) return `${days} дня (${Math.round(hours)} ч)`
  return `${days} дней (${Math.round(hours)} ч)`
}

/**
 * Сколько грузов подходит под выбранную машину — и почему остальные нет.
 *
 * Зачем на экране выбора: логист выбирает машину до сборки и должен видеть,
 * что она возьмёт. Иначе получается разговор «я выбрал пятитонку, а в неё
 * положили десять тонн» — а причина в том, что вес и кузов никто не сверял.
 */
function VehicleFitNote({ vehicle, loads }: { vehicle: BuilderVehicle; loads: BuilderLoad[] }) {
  const fit = explainVehicleMismatch(loads, vehicle)
  if (fit.total === 0) return null
  const reasons: string[] = []
  if (fit.overweight > 0) reasons.push(`${fit.overweight} тяжелее ${formatWeightKg(vehicle.capacity ?? 0)}`)
  if (fit.oversize > 0) reasons.push(`${fit.oversize} больше ${vehicle.volume ?? 0} м³`)
  if (fit.body > 0) reasons.push(`${fit.body} не встанут в ${vehicle.type ?? "этот кузов"}`)
  const tone =
    fit.fits === 0
      ? "border-warning/30 bg-warning/[0.06] text-foreground/90"
      : "border-border bg-secondary/40 text-muted-foreground"
  return (
    <div className={`mt-2 rounded-xl border px-3 py-2 text-[12px] leading-snug ${tone}`}>
      {fit.fits === 0 ? (
        <p>
          Под эту машину не подходит ни один груз из пула: {reasons.join(", ")}. Выберите
          машину побольше или сузьте груз по весу на бирже.
        </p>
      ) : (
        <p>
          Подходит {fit.fits} из {fit.total} грузов пула
          {reasons.length > 0 ? `: не берём ${reasons.join(", ")}` : ""}.
        </p>
      )}
    </div>
  )
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11.5px] text-muted-foreground">{label}</p>
      <p className="text-[14px] font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  )
}

/**
 * Демо-данные для разработки и показа системы.
 *
 *   npm run seed:demo
 *
 * Что создаёт (всё — в рамках организации из `npm run seed:auth`):
 *   1. Настройки автопарка: база в Домодедово с координатами и реквизитами
 *      (без них карта показывает Москву-по-умолчанию и печатные формы пустые);
 *   2. Справочник координат GeoCache для всех адресов демо-данных — карта
 *      работает сразу и без обращения к Nominatim (офлайн-стенд, самолёт,
 *      закрытый контур заказчика);
 *   3. Автопарк: 6 машин и 5 водителей (трое в рейсе с живыми GPS-точками);
 *   4. Клиенты и заказы на разных этапах процесса (поиск → согласование →
 *      рейс → документы → назначение → контроль → выполнен), чтобы дашборд,
 *      канбан, карта и отчёты показывали настоящую картину, а не пустоту;
 *   5. Рейсы с этапами (погрузка / путь / выгрузка) и уведомления логисту.
 *
 * Скрипт идемпотентен: записи создаются с постоянными идентификаторами
 * `demo-*` и через upsert, поэтому повторный запуск обновляет данные,
 * а не плодит дубли. `npm run seed:demo -- --clean` сначала удаляет демо-записи.
 *
 * После сида запустите `npm run seed:auth` — он создаст учётки водителей
 * для мобильного приложения (роль driver) по их телефонам.
 */

import { prisma } from "../lib/prisma"
import { clientNameKey } from "../lib/clients/normalize"

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** Все записи сид-скрипта помечены этим префиксом — их легко найти и удалить. */
const DEMO = "demo-"

function env(name: string): string {
  return (process.env[name] || "").trim()
}

const hoursFromNow = (hours: number): Date => new Date(Date.now() + hours * HOUR)
const daysFromNow = (days: number): Date => new Date(Date.now() + days * DAY)
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY)

// ---------------------------------------------------------------------------
// География демо-данных
// ---------------------------------------------------------------------------

/** База автопарка: адрес + координаты (карта рисует отсюда все рейсы). */
const BASE = {
  parkName: "Автопарк Логинекс",
  address: "Московская область, Домодедово, улица Логистическая, 12",
  lat: 55.4207,
  lng: 37.7376,
}

/**
 * Координаты адресов, которые используются в демо-заказах.
 * Кладём их в GeoCache напрямую: справочник общий для всей платформы,
 * поэтому карта не зависит от доступности Nominatim.
 */
const GEO_CACHE: Array<{ address: string; lat: number; lng: number }> = [
  { address: BASE.address, lat: BASE.lat, lng: BASE.lng },
  { address: "Москва, улица Складочная, 8", lat: 55.8017, lng: 37.6002 },
  { address: "Тверь, улица Индустриальная, 5", lat: 56.8587, lng: 35.9176 },
  { address: "Санкт-Петербург, Шушары, Московское шоссе, 70", lat: 59.724, lng: 30.413 },
  { address: "Ярославль, улица Полушкина Роща, 16", lat: 57.6261, lng: 39.8845 },
  { address: "Владимир, улица Тракторная, 45", lat: 56.145, lng: 40.4127 },
  { address: "Нижний Новгород, улица Коминтерна, 12", lat: 56.3269, lng: 43.9962 },
  { address: "Казань, улица Восстания, 100", lat: 55.8304, lng: 49.0664 },
  { address: "Тула, улица Рязанская, 38", lat: 54.193, lng: 37.6178 },
  { address: "Калуга, улица Московская, 289", lat: 54.5293, lng: 36.2754 },
  { address: "Рязань, улица Ситниковская, 67", lat: 54.6296, lng: 39.741 },
  { address: "Воронеж, улица Димитрова, 148", lat: 51.6608, lng: 39.2003 },
  { address: "Орёл, Московское шоссе, 137", lat: 52.9454, lng: 36.054 },
  { address: "Смоленск, улица Смольянинова, 12", lat: 54.7903, lng: 32.0481 },
]

// ---------------------------------------------------------------------------
// Автопарк
// ---------------------------------------------------------------------------

const VEHICLES: Array<{
  id: string
  plate: string
  type: string
  brand: string
  model: string
  year: number
  capacity: number
  volume: number
  length: number
  width: number
  height: number
  mileage: number
  status: string
  features: string[]
}> = [
  {
    id: `${DEMO}vehicle-1`,
    plate: "А421ВС750",
    type: "Рефрижератор",
    brand: "Volvo",
    model: "FH 460",
    year: 2021,
    capacity: 20000,
    volume: 86,
    length: 13.6,
    width: 2.45,
    height: 2.7,
    mileage: 312480,
    status: "in_use",
    features: ["гидроборт", "термограф"],
  },
  {
    id: `${DEMO}vehicle-2`,
    plate: "В108МК799",
    type: "Фура",
    brand: "КАМАЗ",
    model: "5490 Neo",
    year: 2022,
    capacity: 20000,
    volume: 92,
    length: 13.6,
    width: 2.48,
    height: 2.75,
    mileage: 198240,
    status: "in_use",
    features: ["тент", "коник"],
  },
  {
    id: `${DEMO}vehicle-3`,
    plate: "Е774ОР750",
    type: "Тент",
    brand: "MAN",
    model: "TGS 18.400",
    year: 2020,
    capacity: 18000,
    volume: 82,
    length: 13.6,
    width: 2.45,
    height: 2.65,
    mileage: 421700,
    status: "in_use",
    features: ["верхняя погрузка"],
  },
  {
    id: `${DEMO}vehicle-4`,
    plate: "К215СТ790",
    type: "Изотерм",
    brand: "ГАЗон",
    model: "Next C41R13",
    year: 2023,
    capacity: 5000,
    volume: 32,
    length: 6.2,
    width: 2.3,
    height: 2.3,
    mileage: 74310,
    status: "available",
    features: ["изотермический фургон"],
  },
  {
    id: `${DEMO}vehicle-5`,
    plate: "Н903УУ777",
    type: "Газель",
    brand: "ГАЗ",
    model: "3302 Бизнес",
    year: 2019,
    capacity: 1500,
    volume: 16,
    length: 4.2,
    width: 2.0,
    height: 2.0,
    mileage: 236900,
    status: "maintenance",
    features: [],
  },
  {
    id: `${DEMO}vehicle-6`,
    plate: "О556АА750",
    type: "Бортовая",
    brand: "МАЗ",
    model: "5340В2",
    year: 2021,
    capacity: 10000,
    volume: 45,
    length: 8.0,
    width: 2.45,
    height: 2.4,
    mileage: 289120,
    status: "available",
    features: ["кран-балка"],
  },
]

const DRIVERS: Array<{
  id: string
  name: string
  phone: string
  vehicleId: string | null
  status: string
  /** Текущая точка на карте (null — машина в парке, позиция не передаётся) */
  position: { lat: number; lng: number; city: string } | null
  ordersCompleted: number
  rating: number
  licenseNumber: string
  hiredDaysAgo: number
}> = [
  {
    id: `${DEMO}driver-1`,
    name: "Иванов Сергей Петрович",
    phone: "+79161234501",
    vehicleId: `${DEMO}vehicle-1`,
    status: "busy",
    // Рейс Москва → Санкт-Петербург: машина на трассе М-10 под Тверью
    position: { lat: 56.5531, lng: 36.2317, city: "Трасса М-10, Тверская область" },
    ordersCompleted: 214,
    rating: 4.9,
    licenseNumber: "99 04 123456",
    hiredDaysAgo: 1180,
  },
  {
    id: `${DEMO}driver-2`,
    name: "Кузнецов Андрей Владимирович",
    phone: "+79161234502",
    vehicleId: `${DEMO}vehicle-2`,
    status: "busy",
    // Рейс Москва → Казань через Владимир и Нижний Новгород
    position: { lat: 56.2103, lng: 40.0921, city: "Владимир, погрузка завершена" },
    ordersCompleted: 96,
    rating: 4.7,
    licenseNumber: "99 05 654321",
    hiredDaysAgo: 640,
  },
  {
    id: `${DEMO}driver-3`,
    name: "Смирнов Алексей Игоревич",
    phone: "+79161234503",
    vehicleId: `${DEMO}vehicle-3`,
    status: "busy",
    // Южное направление: Воронеж — точка выгрузки
    position: { lat: 51.7303, lng: 39.1962, city: "Воронеж, подъезд к выгрузке" },
    ordersCompleted: 158,
    rating: 4.8,
    licenseNumber: "99 03 246810",
    hiredDaysAgo: 910,
  },
  {
    id: `${DEMO}driver-4`,
    name: "Фёдоров Дмитрий Николаевич",
    phone: "+79161234504",
    vehicleId: `${DEMO}vehicle-4`,
    status: "available",
    position: { lat: BASE.lat, lng: BASE.lng, city: BASE.address },
    ordersCompleted: 42,
    rating: 5,
    licenseNumber: "99 06 135790",
    hiredDaysAgo: 210,
  },
  {
    id: `${DEMO}driver-5`,
    name: "Орлов Никита Андреевич",
    phone: "+79161234505",
    vehicleId: null,
    status: "maintenance",
    position: null,
    ordersCompleted: 7,
    rating: 4.5,
    licenseNumber: "99 07 112233",
    hiredDaysAgo: 95,
  },
]

// ---------------------------------------------------------------------------
// Клиенты
// ---------------------------------------------------------------------------

const CLIENTS: Array<{
  id: string
  name: string
  inn: string
  address: string
  contactName: string
  phone: string
  email: string
  paymentType: string
  vatType: string
  deferredDays: number
}> = [
  {
    id: `${DEMO}client-1`,
    name: "ООО «Ромашка»",
    inn: "7701234567",
    address: "Москва, улица Складочная, 8",
    contactName: "Петрова Ольга",
    phone: "+74951234567",
    email: "logistics@romashka.example",
    paymentType: "bank",
    vatType: "with_vat",
    deferredDays: 14,
  },
  {
    id: `${DEMO}client-2`,
    name: "ООО «ТехноСтрой»",
    inn: "7802345678",
    address: "Санкт-Петербург, Шушары, Московское шоссе, 70",
    contactName: "Гаврилов Игорь",
    phone: "+78121234567",
    email: "supply@tehnostroy.example",
    paymentType: "bank",
    vatType: "with_vat",
    deferredDays: 30,
  },
  {
    id: `${DEMO}client-3`,
    name: "АО «Северный Путь»",
    inn: "5003456789",
    address: "Тверь, улица Индустриальная, 5",
    contactName: "Белова Марина",
    phone: "+74822123456",
    email: "transport@severput.example",
    paymentType: "prepay",
    vatType: "no_vat",
    deferredDays: 0,
  },
  {
    id: `${DEMO}client-4`,
    name: "ИП Кузнецов А. В.",
    inn: "500912345678",
    address: "Московская область, Домодедово, улица Логистическая, 12",
    contactName: "Кузнецов Алексей",
    phone: "+79031234567",
    email: "kuznetsov@example.com",
    paymentType: "cash_on_delivery",
    vatType: "no_vat",
    deferredDays: 0,
  },
]

// ---------------------------------------------------------------------------
// Рейсы и заказы
// ---------------------------------------------------------------------------

type DemoRoute = {
  id: string
  name: string
  status: string
  driverId: string | null
  vehicleId: string | null
  startedHoursAgo?: number
  completedDaysAgo?: number
  startOdometer?: number
  endOdometer?: number
  cargoWeight: number
  cargoVolume: number
  notes?: string
}

const ROUTES: DemoRoute[] = [
  {
    id: `${DEMO}route-1`,
    name: "Рейс: Москва — Тверь — Санкт-Петербург",
    status: "in_transit",
    driverId: `${DEMO}driver-1`,
    vehicleId: `${DEMO}vehicle-1`,
    startedHoursAgo: 6,
    startOdometer: 312480,
    cargoWeight: 18400,
    cargoVolume: 74.5,
    notes: "Температурный режим +2…+4 °C, термограф включён",
  },
  {
    id: `${DEMO}route-2`,
    name: "Рейс: Москва — Владимир — Нижний Новгород — Казань",
    status: "in_transit",
    driverId: `${DEMO}driver-2`,
    vehicleId: `${DEMO}vehicle-2`,
    startedHoursAgo: 3,
    startOdometer: 198240,
    cargoWeight: 19200,
    cargoVolume: 88.0,
  },
  {
    id: `${DEMO}route-3`,
    name: "Рейс: Москва — Тула — Воронеж",
    status: "in_transit",
    driverId: `${DEMO}driver-3`,
    vehicleId: `${DEMO}vehicle-3`,
    startedHoursAgo: 9,
    startOdometer: 421700,
    cargoWeight: 16800,
    cargoVolume: 70.2,
    notes: "Догруз в Туле подтверждён водителем",
  },
  {
    id: `${DEMO}route-4`,
    name: "Рейс: Домодедово — Калуга — Смоленск",
    status: "planned",
    driverId: `${DEMO}driver-4`,
    vehicleId: `${DEMO}vehicle-4`,
    cargoWeight: 4200,
    cargoVolume: 26.0,
    notes: "Выезд завтра в 07:00",
  },
  {
    id: `${DEMO}route-5`,
    name: "Рейс: Москва — Рязань",
    status: "completed",
    driverId: `${DEMO}driver-2`,
    vehicleId: `${DEMO}vehicle-2`,
    completedDaysAgo: 4,
    startOdometer: 196980,
    endOdometer: 197510,
    cargoWeight: 12000,
    cargoVolume: 54.0,
  },
  {
    id: `${DEMO}route-6`,
    name: "Рейс: Москва — Орёл — Воронеж",
    status: "completed",
    driverId: `${DEMO}driver-3`,
    vehicleId: `${DEMO}vehicle-3`,
    completedDaysAgo: 11,
    startOdometer: 419900,
    endOdometer: 420860,
    cargoWeight: 15400,
    cargoVolume: 66.0,
  },
]

type DemoOrder = {
  id: string
  status: string
  priority: string
  source: string
  routeFrom: string
  routeTo: string
  distance: number
  weight: number
  volume: number
  cargoType: string
  loadingType: string
  price: number
  priceNegotiable?: boolean
  agreedPrice?: number
  negotiationStatus?: string
  paymentType: string
  vatType: string
  deferredDays?: number
  isPaid?: boolean
  paidDaysAgo?: number
  clientId: string
  clientContact: string
  deadlineInDays: number
  assignedDriverId?: string
  assignedVehicleId?: string
  routeId?: string
  routeSequence?: number
  isAdditionalLoad?: boolean
  deliveredDaysAgo?: number
  aiScore?: number
  aiReason?: string
  requirements?: string
}

const ORDERS: DemoOrder[] = [
  // ── Рейс 1: Москва → Тверь → Санкт-Петербург (рефрижератор, в пути) ──
  {
    id: `${DEMO}order-1`,
    status: "control",
    priority: "high",
    source: "ati",
    routeFrom: "Москва, улица Складочная, 8",
    routeTo: "Санкт-Петербург, Шушары, Московское шоссе, 70",
    distance: 712,
    weight: 12400,
    volume: 48.5,
    cargoType: "Продукты питания (охлаждённые)",
    loadingType: "pallets",
    price: 148000,
    agreedPrice: 145000,
    negotiationStatus: "agreed",
    paymentType: "bank",
    vatType: "with_vat",
    deferredDays: 14,
    clientId: `${DEMO}client-2`,
    clientContact: "Гаврилов Игорь, +78121234567",
    deadlineInDays: 1,
    assignedDriverId: `${DEMO}driver-1`,
    assignedVehicleId: `${DEMO}vehicle-1`,
    routeId: `${DEMO}route-1`,
    routeSequence: 2,
    aiScore: 92,
    aiReason: "Постоянный клиент, оплата в срок 14 дней, температура подтверждена термографом",
    requirements: "Температура +2…+4 °C, выгрузка с 08:00 до 12:00",
  },
  {
    id: `${DEMO}order-2`,
    status: "in_route",
    priority: "medium",
    source: "manual",
    routeFrom: "Тверь, улица Индустриальная, 5",
    routeTo: "Санкт-Петербург, Шушары, Московское шоссе, 70",
    distance: 524,
    weight: 6000,
    volume: 26.0,
    cargoType: "Стройматериалы",
    loadingType: "pallets",
    price: 82000,
    agreedPrice: 82000,
    negotiationStatus: "agreed",
    paymentType: "prepay",
    vatType: "no_vat",
    clientId: `${DEMO}client-3`,
    clientContact: "Белова Марина, +74822123456",
    deadlineInDays: 2,
    assignedDriverId: `${DEMO}driver-1`,
    assignedVehicleId: `${DEMO}vehicle-1`,
    routeId: `${DEMO}route-1`,
    routeSequence: 1,
    aiScore: 74,
    aiReason: "Догруз по пути следования, предоплата получена",
  },

  // ── Рейс 2: Москва → Владимир → Нижний Новгород → Казань ──
  {
    id: `${DEMO}order-3`,
    status: "control",
    priority: "high",
    source: "ati",
    routeFrom: "Москва, улица Складочная, 8",
    routeTo: "Нижний Новгород, улица Коминтерна, 12",
    distance: 425,
    weight: 10200,
    volume: 44.0,
    cargoType: "Оборудование",
    loadingType: "other",
    price: 96000,
    agreedPrice: 94000,
    negotiationStatus: "agreed",
    paymentType: "bank",
    vatType: "with_vat",
    deferredDays: 30,
    clientId: `${DEMO}client-1`,
    clientContact: "Петрова Ольга, +74951234567",
    deadlineInDays: 1,
    assignedDriverId: `${DEMO}driver-2`,
    assignedVehicleId: `${DEMO}vehicle-2`,
    routeId: `${DEMO}route-2`,
    routeSequence: 2,
    aiScore: 88,
    aiReason: "Отсрочка 30 дней, клиент стабильно платит, груз креплён коником",
    requirements: "Крепление ремнями, выгрузка краном на стороне получателя",
  },
  {
    id: `${DEMO}order-4`,
    status: "in_route",
    priority: "medium",
    source: "ati",
    routeFrom: "Владимир, улица Тракторная, 45",
    routeTo: "Казань, улица Восстания, 100",
    distance: 720,
    weight: 9000,
    volume: 44.0,
    cargoType: "ТНП",
    loadingType: "pallets",
    price: 118000,
    agreedPrice: 115000,
    negotiationStatus: "agreed",
    paymentType: "bank",
    vatType: "with_vat",
    deferredDays: 14,
    clientId: `${DEMO}client-1`,
    clientContact: "Петрова Ольга, +74951234567",
    deadlineInDays: 3,
    assignedDriverId: `${DEMO}driver-2`,
    assignedVehicleId: `${DEMO}vehicle-2`,
    routeId: `${DEMO}route-2`,
    routeSequence: 3,
    aiScore: 79,
    aiReason: "Длинное плечо, ставка выше рынка на 6%",
  },

  // ── Рейс 3: Москва → Тула → Воронеж (догруз подтверждён) ──
  {
    id: `${DEMO}order-5`,
    status: "control",
    priority: "high",
    source: "ati",
    routeFrom: "Москва, улица Складочная, 8",
    routeTo: "Воронеж, улица Димитрова, 148",
    distance: 520,
    weight: 13800,
    volume: 58.2,
    cargoType: "Металлопрокат",
    loadingType: "other",
    price: 104000,
    agreedPrice: 104000,
    negotiationStatus: "agreed",
    paymentType: "bank",
    vatType: "with_vat",
    deferredDays: 14,
    clientId: `${DEMO}client-1`,
    clientContact: "Петрова Ольга, +74951234567",
    deadlineInDays: 0,
    assignedDriverId: `${DEMO}driver-3`,
    assignedVehicleId: `${DEMO}vehicle-3`,
    routeId: `${DEMO}route-3`,
    routeSequence: 2,
    aiScore: 85,
    aiReason: "Выгрузка сегодня до 18:00, машина уже на подъезде",
    requirements: "Верхняя погрузка, крепление ремнями",
  },
  {
    id: `${DEMO}order-6`,
    status: "documents",
    priority: "medium",
    source: "manual",
    routeFrom: "Тула, улица Рязанская, 38",
    routeTo: "Воронеж, улица Димитрова, 148",
    distance: 296,
    weight: 3000,
    volume: 12.0,
    cargoType: "Упаковка",
    loadingType: "pallets",
    price: 46000,
    agreedPrice: 46000,
    negotiationStatus: "agreed",
    paymentType: "cash_on_delivery",
    vatType: "no_vat",
    clientId: `${DEMO}client-4`,
    clientContact: "Кузнецов Алексей, +79031234567",
    deadlineInDays: 1,
    assignedDriverId: `${DEMO}driver-3`,
    assignedVehicleId: `${DEMO}vehicle-3`,
    routeId: `${DEMO}route-3`,
    routeSequence: 1,
    isAdditionalLoad: true,
    aiScore: 68,
    aiReason: "Догруз по пути, документы передаются водителю на выгрузке",
  },

  // ── Рейс 4: запланирован на завтра (заказы назначены, машина свободна) ──
  {
    id: `${DEMO}order-7`,
    status: "assigned",
    priority: "medium",
    source: "manual",
    routeFrom: "Московская область, Домодедово, улица Логистическая, 12",
    routeTo: "Калуга, улица Московская, 289",
    distance: 210,
    weight: 4200,
    volume: 26.0,
    cargoType: "Продукты питания",
    loadingType: "pallets",
    price: 38000,
    agreedPrice: 38000,
    negotiationStatus: "agreed",
    paymentType: "bank",
    vatType: "with_vat",
    deferredDays: 14,
    clientId: `${DEMO}client-1`,
    clientContact: "Петрова Ольга, +74951234567",
    deadlineInDays: 2,
    assignedDriverId: `${DEMO}driver-4`,
    assignedVehicleId: `${DEMO}vehicle-4`,
    routeId: `${DEMO}route-4`,
    routeSequence: 1,
    aiScore: 71,
    aiReason: "Короткое плечо, изотерм подходит по температурному режиму",
  },

  // ── Согласованные заказы: холст сборки маршрута ──
  {
    id: `${DEMO}order-8`,
    status: "agreed",
    priority: "high",
    source: "ati",
    routeFrom: "Москва, улица Складочная, 8",
    routeTo: "Смоленск, улица Смольянинова, 12",
    distance: 395,
    weight: 8600,
    volume: 40.0,
    cargoType: "ТНП",
    loadingType: "pallets",
    price: 74000,
    agreedPrice: 72000,
    negotiationStatus: "agreed",
    paymentType: "bank",
    vatType: "with_vat",
    deferredDays: 14,
    clientId: `${DEMO}client-1`,
    clientContact: "Петрова Ольга, +74951234567",
    deadlineInDays: 3,
    aiScore: 81,
    aiReason: "Ставка выше себестоимости на 18%, машина найдётся в парке",
  },
  {
    id: `${DEMO}order-9`,
    status: "agreed",
    priority: "medium",
    source: "ati",
    routeFrom: "Рязань, улица Ситниковская, 67",
    routeTo: "Москва, улица Складочная, 8",
    distance: 196,
    weight: 5400,
    volume: 22.0,
    cargoType: "Оборудование",
    loadingType: "other",
    price: 41000,
    agreedPrice: 41000,
    negotiationStatus: "agreed",
    paymentType: "prepay",
    vatType: "no_vat",
    clientId: `${DEMO}client-3`,
    clientContact: "Белова Марина, +74822123456",
    deadlineInDays: 4,
    aiScore: 66,
    aiReason: "Обратное направление: закрывает порожний пробег из Рязани",
  },

  // ── Переговоры и поиск: живой канбан заказов ──
  {
    id: `${DEMO}order-10`,
    status: "negotiation",
    priority: "needs_clarification",
    source: "ati",
    routeFrom: "Орёл, Московское шоссе, 137",
    routeTo: "Москва, улица Складочная, 8",
    distance: 360,
    weight: 11000,
    volume: 46.0,
    cargoType: "Стройматериалы",
    loadingType: "pallets",
    price: 58000,
    priceNegotiable: true,
    negotiationStatus: "counter_offer",
    paymentType: "bank",
    vatType: "with_vat",
    deferredDays: 45,
    clientId: `${DEMO}client-2`,
    clientContact: "Гаврилов Игорь, +78121234567",
    deadlineInDays: 5,
    aiScore: 44,
    aiReason: "Отсрочка 45 дней и ставка ниже рынка: нужно согласовать с руководителем",
  },
  {
    id: `${DEMO}order-11`,
    status: "search",
    priority: "needs_clarification",
    source: "ati",
    routeFrom: "Казань, улица Восстания, 100",
    routeTo: "Екатеринбург, улица Черняховского, 100",
    distance: 790,
    weight: 15000,
    volume: 60.0,
    cargoType: "ТНП",
    loadingType: "pallets",
    price: 132000,
    negotiationStatus: "new",
    paymentType: "bank",
    vatType: "with_vat",
    clientId: `${DEMO}client-1`,
    clientContact: "Петрова Ольга, +74951234567",
    deadlineInDays: 6,
    aiScore: 57,
    aiReason: "Направление не закрыто своим парком: возможен наёмный перевозчик",
  },
  {
    id: `${DEMO}order-12`,
    status: "search",
    priority: "low",
    source: "manual",
    routeFrom: "Тверь, улица Индустриальная, 5",
    routeTo: "Ярославль, улица Полушкина Роща, 16",
    distance: 190,
    weight: 3200,
    volume: 14.0,
    cargoType: "Упаковка",
    loadingType: "pallets",
    price: 27000,
    negotiationStatus: "new",
    paymentType: "cash_on_delivery",
    vatType: "no_vat",
    clientId: `${DEMO}client-4`,
    clientContact: "Кузнецов Алексей, +79031234567",
    deadlineInDays: 7,
    aiScore: 38,
    aiReason: "Короткое плечо и низкая ставка — выгодно только как догруз",
  },

  // ── Выполненные рейсы: история, отчёты и взаиморасчёты ──
  {
    id: `${DEMO}order-13`,
    status: "delivered",
    priority: "medium",
    source: "ati",
    routeFrom: "Москва, улица Складочная, 8",
    routeTo: "Рязань, улица Ситниковская, 67",
    distance: 196,
    weight: 12000,
    volume: 54.0,
    cargoType: "Продукты питания",
    loadingType: "pallets",
    price: 52000,
    agreedPrice: 52000,
    negotiationStatus: "agreed",
    paymentType: "bank",
    vatType: "with_vat",
    deferredDays: 14,
    isPaid: true,
    paidDaysAgo: 2,
    clientId: `${DEMO}client-1`,
    clientContact: "Петрова Ольга, +74951234567",
    deadlineInDays: -4,
    assignedDriverId: `${DEMO}driver-2`,
    assignedVehicleId: `${DEMO}vehicle-2`,
    routeId: `${DEMO}route-5`,
    routeSequence: 1,
    deliveredDaysAgo: 4,
    aiScore: 90,
    aiReason: "Доставлен в срок, оплата получена",
  },
  {
    id: `${DEMO}order-14`,
    status: "delivered",
    priority: "high",
    source: "ati",
    routeFrom: "Москва, улица Складочная, 8",
    routeTo: "Воронеж, улица Димитрова, 148",
    distance: 520,
    weight: 15400,
    volume: 66.0,
    cargoType: "Металлопрокат",
    loadingType: "other",
    price: 98000,
    agreedPrice: 98000,
    negotiationStatus: "agreed",
    paymentType: "bank",
    vatType: "with_vat",
    deferredDays: 30,
    isPaid: false,
    clientId: `${DEMO}client-2`,
    clientContact: "Гаврилов Игорь, +78121234567",
    deadlineInDays: -11,
    assignedDriverId: `${DEMO}driver-3`,
    assignedVehicleId: `${DEMO}vehicle-3`,
    routeId: `${DEMO}route-6`,
    routeSequence: 2,
    deliveredDaysAgo: 11,
    aiScore: 83,
    aiReason: "Доставлен в срок, ожидание оплаты по отсрочке 30 дней",
  },
  {
    id: `${DEMO}order-15`,
    status: "delivered",
    priority: "medium",
    source: "manual",
    routeFrom: "Орёл, Московское шоссе, 137",
    routeTo: "Воронеж, улица Димитрова, 148",
    distance: 180,
    weight: 4200,
    volume: 18.0,
    cargoType: "ТНП",
    loadingType: "pallets",
    price: 34000,
    agreedPrice: 34000,
    negotiationStatus: "agreed",
    paymentType: "prepay",
    vatType: "no_vat",
    isPaid: true,
    paidDaysAgo: 12,
    clientId: `${DEMO}client-3`,
    clientContact: "Белова Марина, +74822123456",
    deadlineInDays: -12,
    assignedDriverId: `${DEMO}driver-3`,
    assignedVehicleId: `${DEMO}vehicle-3`,
    routeId: `${DEMO}route-6`,
    routeSequence: 1,
    isAdditionalLoad: true,
    deliveredDaysAgo: 12,
    aiScore: 77,
    aiReason: "Догруз закрыл порожний пробег, предоплата",
  },
]

/** Этапы рейсов для заказов, которые уже исполняются: погрузка → путь → выгрузка. */
function stagesForOrder(
  organizationId: string,
  routeId: string,
  order: DemoOrder,
  sequence: number,
): Array<{
  id: string
  organizationId: string
  routeId: string
  orderId: string
  driverId: string | null
  vehicleId: string | null
  type: string
  status: string
  sequence: number
  plannedStartAt: Date
  plannedEndAt: Date
}> {
  const start = hoursFromNow(sequence * 4)
  return [
    {
      id: `${order.id}-stage-loading`,
      organizationId,
      routeId,
      orderId: order.id,
      driverId: order.assignedDriverId ?? null,
      vehicleId: order.assignedVehicleId ?? null,
      type: "loading",
      status: order.status === "control" ? "completed" : "planned",
      sequence: sequence * 3,
      plannedStartAt: start,
      plannedEndAt: new Date(start.getTime() + HOUR),
    },
    {
      id: `${order.id}-stage-driving`,
      organizationId,
      routeId,
      orderId: order.id,
      driverId: order.assignedDriverId ?? null,
      vehicleId: order.assignedVehicleId ?? null,
      type: "driving",
      status: order.status === "control" ? "active" : "planned",
      sequence: sequence * 3 + 1,
      plannedStartAt: new Date(start.getTime() + HOUR),
      plannedEndAt: new Date(start.getTime() + HOUR + 5 * HOUR),
    },
    {
      id: `${order.id}-stage-unloading`,
      organizationId,
      routeId,
      orderId: order.id,
      driverId: order.assignedDriverId ?? null,
      vehicleId: order.assignedVehicleId ?? null,
      type: "unloading",
      status: "planned",
      sequence: sequence * 3 + 2,
      plannedStartAt: new Date(start.getTime() + 6 * HOUR),
      plannedEndAt: new Date(start.getTime() + 7 * HOUR),
    },
  ]
}

// ---------------------------------------------------------------------------
// Шаги сида
// ---------------------------------------------------------------------------

async function ensureOrganization(): Promise<{ id: string; name: string }> {
  const organization = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } })
  if (organization) return { id: organization.id, name: organization.name }

  const name = env("ORGANIZATION_NAME") || "ИП Фролов Иван Александрович"
  const created = await prisma.organization.create({
    data: { name, nameKey: name.toLowerCase().replace(/[^а-яa-z0-9]+/gi, "-") },
  })
  console.log(`✔ Создана организация «${created.name}» (не было ни одной)`)
  return { id: created.id, name: created.name }
}

async function seedFleetSettings(organizationId: string, organizationName: string): Promise<void> {
  await prisma.fleetSettings.upsert({
    where: { organizationId },
    create: {
      organizationId,
      parkName: BASE.parkName,
      baseAddress: BASE.address,
      baseLat: BASE.lat,
      baseLng: BASE.lng,
      legalName: organizationName,
      inn: "500912345678",
      kpp: "",
      ogrn: "316500900012345",
      legalAddress: BASE.address,
      phone: "+74951234567",
      email: "dispatch@loginex.example",
      bankName: "ПАО «Банк Логистика»",
      bankBic: "044525225",
      bankAccount: "40802810500000012345",
      signerName: "Фролов Иван Александрович",
      signerPosition: "Индивидуальный предприниматель",
    },
    update: {
      parkName: BASE.parkName,
      baseAddress: BASE.address,
      baseLat: BASE.lat,
      baseLng: BASE.lng,
      legalName: organizationName,
      legalAddress: BASE.address,
      signerName: "Фролов Иван Александрович",
    },
  })
  console.log(`✔ Настройки автопарка: база «${BASE.parkName}» (${BASE.address})`)
}

async function seedGeoCache(): Promise<void> {
  let created = 0
  for (const entry of GEO_CACHE) {
    // org-audit: manual — GeoCache это общий справочник адресов, не данные организации
    const address = entry.address.trim().toLowerCase()
    const before = await prisma.geoCache.findUnique({ where: { address } })
    await prisma.geoCache.upsert({
      where: { address },
      create: { address, lat: entry.lat, lng: entry.lng },
      update: { lat: entry.lat, lng: entry.lng },
    })
    if (!before) created += 1
  }
  console.log(`✔ GeoCache: адресов всего ${GEO_CACHE.length}, добавлено новых ${created}`)
}

async function seedVehicles(organizationId: string): Promise<void> {
  for (const vehicle of VEHICLES) {
    await prisma.vehicle.upsert({
      where: { id: vehicle.id },
      create: {
        id: vehicle.id,
        organizationId,
        plate: vehicle.plate,
        type: vehicle.type,
        brand: vehicle.brand,
        model: vehicle.model,
        year: vehicle.year,
        capacity: vehicle.capacity,
        volume: vehicle.volume,
        length: vehicle.length,
        width: vehicle.width,
        height: vehicle.height,
        mileage: vehicle.mileage,
        status: vehicle.status,
        features: JSON.stringify(vehicle.features),
        lastMaintenanceDate: daysAgo(45),
        nextMaintenanceDate: daysFromNow(45),
        insuranceExpiry: daysFromNow(120),
        inspectionExpiry: daysFromNow(200),
      },
      update: {
        organizationId,
        plate: vehicle.plate,
        type: vehicle.type,
        status: vehicle.status,
        mileage: vehicle.mileage,
      },
    })
  }
  console.log(`✔ Машин: ${VEHICLES.length}`)
}

async function seedDrivers(organizationId: string): Promise<void> {
  for (const driver of DRIVERS) {
    const vehicle = VEHICLES.find((item) => item.id === driver.vehicleId) ?? null
    await prisma.driver.upsert({
      where: { id: driver.id },
      create: {
        id: driver.id,
        organizationId,
        name: driver.name,
        phone: driver.phone,
        vehicleId: driver.vehicleId,
        vehicleType: vehicle?.type ?? null,
        vehiclePlate: vehicle?.plate ?? null,
        status: driver.status,
        currentLocation: driver.position?.city ?? null,
        latitude: driver.position?.lat ?? null,
        longitude: driver.position?.lng ?? null,
        lastGpsUpdate: driver.position ? hoursFromNow(-0.2) : null,
        ordersCompleted: driver.ordersCompleted,
        rating: driver.rating,
        licenseNumber: driver.licenseNumber,
        licenseExpiry: daysFromNow(400),
        medicalExpiry: daysFromNow(180),
        hiredAt: daysAgo(driver.hiredDaysAgo),
      },
      update: {
        organizationId,
        vehicleId: driver.vehicleId,
        vehicleType: vehicle?.type ?? null,
        vehiclePlate: vehicle?.plate ?? null,
        status: driver.status,
        currentLocation: driver.position?.city ?? null,
        latitude: driver.position?.lat ?? null,
        longitude: driver.position?.lng ?? null,
        lastGpsUpdate: driver.position ? new Date() : null,
      },
    })
  }
  console.log(`✔ Водителей: ${DRIVERS.length} (в рейсе ${DRIVERS.filter((d) => d.status === "busy").length})`)
}

async function seedClients(organizationId: string): Promise<void> {
  for (const client of CLIENTS) {
    await prisma.client.upsert({
      where: { id: client.id },
      create: {
        id: client.id,
        organizationId,
        name: client.name,
        nameKey: clientNameKey(client.name),
        inn: client.inn,
        address: client.address,
        contactName: client.contactName,
        phone: client.phone,
        email: client.email,
        paymentType: client.paymentType,
        vatType: client.vatType,
        deferredDays: client.deferredDays,
        source: "manual",
      },
      update: {
        organizationId,
        name: client.name,
        nameKey: clientNameKey(client.name),
        phone: client.phone,
        email: client.email,
      },
    })
  }
  console.log(`✔ Клиентов: ${CLIENTS.length}`)
}

async function seedRoutes(organizationId: string): Promise<void> {
  for (const route of ROUTES) {
    const startedAt = route.startedHoursAgo ? hoursFromNow(-route.startedHoursAgo) : null
    const completedAt = route.completedDaysAgo ? daysAgo(route.completedDaysAgo) : null
    await prisma.route.upsert({
      where: { id: route.id },
      create: {
        id: route.id,
        organizationId,
        name: route.name,
        status: route.status,
        driverId: route.driverId,
        vehicleId: route.vehicleId,
        startedAt,
        completedAt,
        startOdometer: route.startOdometer ?? null,
        endOdometer: route.endOdometer ?? null,
        totalDistance:
          route.endOdometer && route.startOdometer
            ? route.endOdometer - route.startOdometer
            : null,
        cargoWeight: route.cargoWeight,
        cargoVolume: route.cargoVolume,
        notes: route.notes ?? null,
      },
      update: {
        organizationId,
        name: route.name,
        status: route.status,
        driverId: route.driverId,
        vehicleId: route.vehicleId,
        startedAt,
        completedAt,
      },
    })
  }
  console.log(
    `✔ Рейсов: ${ROUTES.length} (в пути ${ROUTES.filter((r) => r.status === "in_transit").length}, ` +
      `запланировано ${ROUTES.filter((r) => r.status === "planned").length}, ` +
      `завершено ${ROUTES.filter((r) => r.status === "completed").length})`,
  )
}

async function seedOrders(organizationId: string): Promise<void> {
  let stageCount = 0

  for (const order of ORDERS) {
    const data = {
      organizationId,
      source: order.source,
      sourceId: order.source === "ati" ? `ATI-${order.id.slice(-6).toUpperCase()}` : null,
      routeFrom: order.routeFrom,
      routeTo: order.routeTo,
      distance: order.distance,
      weight: order.weight,
      volume: order.volume,
      cargoType: order.cargoType,
      loadingType: order.loadingType,
      requirements: order.requirements ?? null,
      price: order.price,
      agreedPrice: order.agreedPrice ?? null,
      priceNegotiable: Boolean(order.priceNegotiable),
      negotiationStatus: order.negotiationStatus ?? "new",
      paymentType: order.paymentType,
      vatType: order.vatType,
      deferredDays: order.deferredDays ?? null,
      isPaid: Boolean(order.isPaid),
      paidAt: order.paidDaysAgo ? daysAgo(order.paidDaysAgo) : null,
      dueDate: order.deferredDays
        ? new Date(daysFromNow(order.deadlineInDays).getTime() + order.deferredDays * DAY)
        : null,
      clientName: CLIENTS.find((client) => client.id === order.clientId)?.name ?? null,
      clientId: order.clientId,
      clientContact: order.clientContact,
      deadline: daysFromNow(order.deadlineInDays),
      deliveredAt: order.deliveredDaysAgo ? daysAgo(order.deliveredDaysAgo) : null,
      status: order.status,
      priority: order.priority,
      aiScore: order.aiScore ?? 50,
      aiReason: order.aiReason ?? null,
      assignedDriverId: order.assignedDriverId ?? null,
      assignedVehicleId: order.assignedVehicleId ?? null,
      routeId: order.routeId ?? null,
      routeSequence: order.routeSequence ?? null,
      isAdditionalLoad: Boolean(order.isAdditionalLoad),
      addedToRouteAt: order.isAdditionalLoad ? daysAgo(1) : null,
      proposedToDriver: Boolean(order.isAdditionalLoad),
      proposedAt: order.isAdditionalLoad ? daysAgo(1) : null,
      acceptedAt: order.isAdditionalLoad ? daysAgo(1) : null,
      takenAt: daysAgo(Math.max(2, -order.deadlineInDays + 4)),
      createdAt: daysAgo(Math.max(3, -order.deadlineInDays + 6)),
    }

    await prisma.order.upsert({
      where: { id: order.id },
      create: { id: order.id, ...data },
      update: data,
    })

    // Этапы исполнения — только для заказов, которые реально едут или назначены
    if (order.routeId && order.routeSequence != null && order.status !== "delivered") {
      const stages = stagesForOrder(
        organizationId,
        order.routeId,
        order,
        order.routeSequence,
      )
      for (const stage of stages) {
        await prisma.routeStage.upsert({
          where: { id: stage.id },
          create: stage,
          update: {
            type: stage.type,
            status: stage.status,
            sequence: stage.sequence,
            plannedStartAt: stage.plannedStartAt,
            plannedEndAt: stage.plannedEndAt,
          },
        })
        stageCount += 1
      }
    }
  }

  const byStatus = ORDERS.reduce<Record<string, number>>((acc, order) => {
    acc[order.status] = (acc[order.status] ?? 0) + 1
    return acc
  }, {})
  console.log(
    `✔ Заказов: ${ORDERS.length} (${Object.entries(byStatus)
      .map(([status, count]) => `${status}: ${count}`)
      .join(", ")}), этапов рейса: ${stageCount}`,
  )
}

async function seedNotifications(organizationId: string): Promise<void> {
  const admin = await prisma.user.findFirst({
    where: { organizationId, role: { in: ["admin", "logist"] }, status: "active" },
    orderBy: { createdAt: "asc" },
  })
  if (!admin) {
    console.warn("⚠ Активного администратора/логиста нет — уведомления не созданы (npm run seed:auth)")
    return
  }

  const notifications: Array<{
    id: string
    type: string
    title: string
    message: string
    priority: string
    driverId?: string
    orderId?: string
    routeId?: string
    hoursAgo: number
  }> = [
    {
      id: `${DEMO}notification-1`,
      type: "route_started",
      title: "Рейс вышел в путь",
      message: "Иванов С. П. начал рейс Москва — Тверь — Санкт-Петербург (А421ВС750)",
      priority: "normal",
      driverId: `${DEMO}driver-1`,
      routeId: `${DEMO}route-1`,
      hoursAgo: 6,
    },
    {
      id: `${DEMO}notification-2`,
      type: "delivery_soon",
      title: "Выгрузка сегодня до 18:00",
      message: "Заказ «Москва → Воронеж, металлопрокат» — машина на подъезде к выгрузке",
      priority: "high",
      driverId: `${DEMO}driver-3`,
      orderId: `${DEMO}order-5`,
      routeId: `${DEMO}route-3`,
      hoursAgo: 1,
    },
    {
      id: `${DEMO}notification-3`,
      type: "payment_due",
      title: "Ожидается оплата",
      message: "АО «Северный Путь»: 98 000 ₽ по отсрочке 30 дней, срок через 19 дней",
      priority: "normal",
      orderId: `${DEMO}order-14`,
      hoursAgo: 3,
    },
  ]

  for (const item of notifications) {
    await prisma.notification.upsert({
      where: { id: item.id },
      create: {
        id: item.id,
        organizationId,
        userId: admin.id,
        userRole: admin.role,
        type: item.type,
        title: item.title,
        message: item.message,
        priority: item.priority,
        driverId: item.driverId ?? null,
        orderId: item.orderId ?? null,
        routeId: item.routeId ?? null,
        createdAt: hoursFromNow(-item.hoursAgo),
      },
      update: {
        organizationId,
        userId: admin.id,
        title: item.title,
        message: item.message,
        priority: item.priority,
      },
    })
  }
  console.log(`✔ Уведомлений для ${admin.email}: ${notifications.length}`)
}

async function cleanDemoData(): Promise<void> {
  // Порядок важен: сначала дочерние записи, потом родительские
  const stages = await prisma.routeStage.deleteMany({ where: { id: { startsWith: DEMO } } })
  const notifications = await prisma.notification.deleteMany({ where: { id: { startsWith: DEMO } } })
  const orders = await prisma.order.deleteMany({ where: { id: { startsWith: DEMO } } })
  const routes = await prisma.route.deleteMany({ where: { id: { startsWith: DEMO } } })
  const drivers = await prisma.driver.deleteMany({ where: { id: { startsWith: DEMO } } })
  const vehicles = await prisma.vehicle.deleteMany({ where: { id: { startsWith: DEMO } } })
  const clients = await prisma.client.deleteMany({ where: { id: { startsWith: DEMO } } })
  console.log(
    `✔ Удалено демо-записей: этапов ${stages.count}, уведомлений ${notifications.count}, ` +
      `заказов ${orders.count}, рейсов ${routes.count}, водителей ${drivers.count}, ` +
      `машин ${vehicles.count}, клиентов ${clients.count}`,
  )
}

async function main(): Promise<void> {
  const clean = process.argv.includes("--clean")

  const organization = await ensureOrganization()
  if (clean) await cleanDemoData()

  await seedFleetSettings(organization.id, organization.name)
  await seedGeoCache()
  await seedVehicles(organization.id)
  await seedDrivers(organization.id)
  await seedClients(organization.id)
  await seedRoutes(organization.id)
  await seedOrders(organization.id)
  await seedNotifications(organization.id)

  const stats = {
    vehicles: await prisma.vehicle.count({ where: { organizationId: organization.id } }),
    drivers: await prisma.driver.count({ where: { organizationId: organization.id } }),
    clients: await prisma.client.count({ where: { organizationId: organization.id } }),
    routes: await prisma.route.count({ where: { organizationId: organization.id } }),
    orders: await prisma.order.count({ where: { organizationId: organization.id } }),
    activeOrders: await prisma.order.count({
      where: {
        organizationId: organization.id,
        status: { in: ["in_route", "documents", "assigned", "control"] },
      },
    }),
  }

  console.log(
    `\nИтог по организации «${organization.name}»: машин ${stats.vehicles}, водителей ${stats.drivers}, ` +
      `клиентов ${stats.clients}, рейсов ${stats.routes}, заказов ${stats.orders} ` +
      `(в работе ${stats.activeOrders}).`,
  )
  console.log(
    "Дальше: npm run seed:auth — создаст учётки водителей для мобильного приложения.\n" +
      "Карта дашборда возьмёт базу из настроек автопарка, а рейсы — из заказов в работе.",
  )
}

main()
  .catch((error) => {
    console.error("\n✖ seed:demo завершился ошибкой:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

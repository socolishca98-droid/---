/**
 * Демо-грузы ATI для офлайн-разработки и показа биржи.
 *
 *   npm run seed:ati [-- --email admin@example.ru] [--org <organizationId>]
 *
 * Зачем: в ATI грузы отдаются только с площадок (boards/byboards), а на
 * тестовых аккаунтах площадок нет. Чтобы биржа /lm/search, помощник сборки
 * и заказ «из биржи» работали без площадок и без обращения к ATI, этот
 * скрипт кладёт реалистичные грузы прямо в AtiCache.
 *
 * Идемпотентен: записи с atiLoadId `demo-*` удаляются и создаются заново,
 * повторный запуск обновляет данные, а не плодит дубли.
 * Очистка: npm run seed:ati -- --clean
 */
import { prisma } from "../lib/prisma"

const DAY = 24 * 60 * 60 * 1000
const LOAD_PREFIX = "demo-"

function env(name: string): string {
  return (process.env[name] || "").trim()
}

/** Разбор аргументов командной строки: --email, --org, --clean. */
function args(): { email?: string; org?: string; clean: boolean } {
  const argv = process.argv.slice(2)
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  return {
    email: get("--email"),
    org: get("--org"),
    clean: argv.includes("--clean"),
  }
}

const daysFromNow = (days: number): Date =>
  new Date(Date.now() + days * DAY)

type SeedLoad = {
  loadId: string
  routeFrom: string
  routeFromId?: string
  routeTo: string
  routeToId?: string
  distance: number
  weight: number // кг
  volume?: number // м³
  cargoType: string
  truckType: string
  loadingType?: string
  price: number // ₽
  priceType?: string
  paymentType: string
  vatIncluded: boolean
  loadingIn: number // дней до погрузки
  unloadingIn: number // дней до выгрузки
  firmName: string
  contactName: string
  contactPhone: string
  note?: string
  aiScore: number
  aiReason: string
}

/** 24 реалистичных груза: популярные направления РФ, разные кузова и ставки. */
const LOADS: SeedLoad[] = [
  {
    loadId: "1",
    routeFrom: "Москва, Московская обл.",
    routeFromId: "1",
    routeTo: "Санкт-Петербург, Ленинградская обл.",
    routeToId: "2",
    distance: 703,
    weight: 20000,
    volume: 82,
    cargoType: "Паллеты, 20 паллет, обрешётка",
    truckType: "Тент",
    loadingType: "Задняя",
    price: 85000,
    paymentType: "Безналичные",
    vatIncluded: true,
    loadingIn: 1,
    unloadingIn: 2,
    firmName: "ООО «ТоргСнаб»",
    contactName: "Смирнов Алексей",
    contactPhone: "+7 916 204-55-31",
    note: "Погрузка на складе с 9:00, счёт на загрузку 2 часа. Документы на выгрузке.",
    aiScore: 88,
    aiReason: "Хорошая ставка 121 ₽/км, прямой рейс, загрузка уже завтра",
  },
  {
    loadId: "2",
    routeFrom: "Москва, Московская обл.",
    routeFromId: "1",
    routeTo: "Казань, Татарстан",
    routeToId: "93",
    distance: 823,
    weight: 18000,
    volume: 86,
    cargoType: "Стройматериалы, сухие смеси, 900 кг/паллета",
    truckType: "Тент",
    loadingType: "Верхняя",
    price: 92000,
    paymentType: "Безналичные",
    vatIncluded: true,
    loadingIn: 2,
    unloadingIn: 4,
    firmName: "ООО «СтройБаза №1»",
    contactName: "Кузнецов Дмитрий",
    contactPhone: "+7 903 771-12-08",
    aiScore: 84,
    aiReason: "112 ₽/км, полная загрузка, выгодный обратный коридор",
  },
  {
    loadId: "3",
    routeFrom: "Санкт-Петербург, Ленинградская обл.",
    routeFromId: "2",
    routeTo: "Великий Новгород, Новгородская обл.",
    routeToId: "32",
    distance: 186,
    weight: 12000,
    volume: 40,
    cargoType: "Продукты питания, сухие",
    truckType: "Тент",
    loadingType: "Боковая",
    price: 24000,
    paymentType: "Наличные",
    vatIncluded: false,
    loadingIn: 1,
    unloadingIn: 1,
    firmName: "ИП Петров В.С.",
    contactName: "Петров Виктор",
    contactPhone: "+7 921 988-45-12",
    note: "Без документов, оплата на выгрузке.",
    aiScore: 72,
    aiReason: "Короткий рейс, 129 ₽/км, оплата наличными",
  },
  {
    loadId: "4",
    routeFrom: "Москва, Московская обл.",
    routeFromId: "1",
    routeTo: "Нижний Новгород, Нижегородская обл.",
    routeToId: "47",
    distance: 425,
    weight: 22000,
    volume: 86,
    cargoType: "Бытовая техника, в коробах",
    truckType: "Фургон",
    loadingType: "Задняя",
    price: 46000,
    paymentType: "Безналичные",
    vatIncluded: true,
    loadingIn: 1,
    unloadingIn: 2,
    firmName: "ООО «ТехноЛогистик»",
    contactName: "Орлова Мария",
    contactPhone: "+7 926 333-76-90",
    aiScore: 81,
    aiReason: "108 ₽/км, фургон, рядом с базой",
  },
  {
    loadId: "5",
    routeFrom: "Екатеринбург, Свердловская обл.",
    routeFromId: "70",
    routeTo: "Челябинск, Челябинская обл.",
    routeToId: "114",
    distance: 213,
    weight: 16000,
    volume: 60,
    cargoType: "Металлопрокат, в пачках",
    truckType: "Бортовой",
    loadingType: "Верхняя",
    price: 21500,
    paymentType: "Безналичные",
    vatIncluded: true,
    loadingIn: 3,
    unloadingIn: 3,
    firmName: "ООО «УралМеталлТорг»",
    contactName: "Захаров Игорь",
    contactPhone: "+7 912 045-33-27",
    aiScore: 69,
    aiReason: "101 ₽/км, короткий рейс, металл — крепление обязательно",
  },
  {
    loadId: "6",
    routeFrom: "Краснодар, Краснодарский край",
    routeFromId: "65",
    routeTo: "Ростов-на-Дону, Ростовская обл.",
    routeToId: "76",
    distance: 274,
    weight: 20000,
    volume: 86,
    cargoType: "Овощи и фрукты, ящики",
    truckType: "Рефрижератор",
    loadingType: "Задняя",
    price: 34000,
    paymentType: "Безналичные",
    vatIncluded: true,
    loadingIn: 1,
    unloadingIn: 2,
    firmName: "ООО «ЮгАгро»",
    contactName: "Волкова Анна",
    contactPhone: "+7 988 220-17-44",
    note: "Температурный режим +4…+6 °C, гигрометрия по договору.",
    aiScore: 90,
    aiReason: "124 ₽/км, рефрижератор в дефиците на южном коридоре",
  },
  {
    loadId: "7",
    routeFrom: "Казань, Татарстан",
    routeFromId: "93",
    routeTo: "Уфа, Башкортостан",
    routeToId: "111",
    distance: 525,
    weight: 14000,
    volume: 70,
    cargoType: "Нефтехимия, мягкие контейнеры",
    truckType: "Тент",
    loadingType: "Верхняя",
    price: 44000,
    paymentType: "Безналичные",
    vatIncluded: true,
    loadingIn: 2,
    unloadingIn: 3,
    firmName: "ООО «НефтеХимТранс»",
    contactName: "Гареев Ринат",
    contactPhone: "+7 917 555-81-03",
    aiScore: 76,
    aiReason: "84 ₽/км — ниже рынка, но полная загрузка и нет простоев",
  },
  {
    loadId: "8",
    routeFrom: "Нижний Новгород, Нижегородская обл.",
    routeFromId: "47",
    routeTo: "Москва, Московская обл.",
    routeToId: "1",
    distance: 425,
    weight: 20000,
    volume: 86,
    cargoType: "Мебель, в коробах",
    truckType: "Фургон",
    loadingType: "Задняя",
    price: 47000,
    paymentType: "Безналичные",
    vatIncluded: true,
    loadingIn: 1,
    unloadingIn: 2,
    firmName: "ООО «МебельТрейд»",
    contactName: "Тихонов Сергей",
    contactPhone: "+7 909 144-62-75",
    aiScore: 83,
    aiReason: "111 ₽/км, обратное направление в Москву — востребовано",
  },
  {
    loadId: "9",
    routeFrom: "Москва, Московская обл.",
    routeFromId: "1",
    routeTo: "Воронеж, Воронежская обл.",
    routeToId: "24",
    distance: 526,
    weight: 18000,
    volume: 82,
    cargoType: "Хозтовары, паллеты",
    truckType: "Тент",
    loadingType: "Задняя",
    price: 52000,
    paymentType: "Безналичные",
    vatIncluded: true,
    loadingIn: 2,
    unloadingIn: 3,
    firmName: "ООО «Хозмаркет»",
    contactName: "Ерёмин Павел",
    contactPhone: "+7 920 407-19-58",
    aiScore: 79,
    aiReason: "99 ₽/км, стандартный тент, предоплата топлива 30%",
  },
  {
    loadId: "10",
    routeFrom: "Самара, Самарская обл.",
    routeFromId: "102",
    routeTo: "Саратов, Саратовская обл.",
    routeToId: "103",
    distance: 440,
    weight: 22000,
    volume: 86,
    cargoType: "Стройматериалы, керамзит",
    truckType: "Тент",
    loadingType: "Верхняя",
    price: 38000,
    paymentType: "Наличные",
    vatIncluded: false,
    loadingIn: 1,
    unloadingIn: 2,
    firmName: "ИП Сахаров А.А.",
    contactName: "Сахаров Алексей",
    contactPhone: "+7 927 655-04-21",
    aiScore: 66,
    aiReason: "86 ₽/км — низкая ставка, но машина уже в Самаре",
  },
  {
    loadId: "11",
    routeFrom: "Уфа, Башкортостан",
    routeFromId: "111",
    routeTo: "Пермь, Пермский край",
    routeToId: "97",
    distance: 570,
    weight: 20000,
    volume: 86,
    cargoType: "Оборудование, в ящиках",
    truckType: "Тент",
    loadingType: "Задняя",
    price: 61000,
    paymentType: "Безналичные",
    vatIncluded: true,
    loadingIn: 3,
    unloadingIn: 5,
    firmName: "ООО «ПромОборудование»",
    contactName: "Николаев Артём",
    contactPhone: "+7 952 311-78-39",
    note: "Негабарит не допускается: ширина 2,45 м, высота 2,7 м.",
    aiScore: 82,
    aiReason: "107 ₽/км, оборудование — бережная перевозка",
  },
  {
    loadId: "12",
    routeFrom: "Ростов-на-Дону, Ростовская обл.",
    routeFromId: "76",
    routeTo: "Волгоград, Волгоградская обл.",
    routeToId: "60",
    distance: 474,
    weight: 16000,
    volume: 76,
    cargoType: "Напитки, ПЭТ, паллеты",
    truckType: "Тент",
    loadingType: "Задняя",
    price: 45000,
    paymentType: "Безналичные",
    vatIncluded: true,
    loadingIn: 1,
    unloadingIn: 2,
    firmName: "ООО «АкваЛогистика»",
    contactName: "Морозова Ирина",
    contactPhone: "+7 918 066-52-70",
    aiScore: 80,
    aiReason: "95 ₽/км, стабильный клиент, выгрузка по слотам",
  },
  {
    loadId: "13",
    routeFrom: "Санкт-Петербург, Ленинградская обл.",
    routeFromId: "2",
    routeTo: "Псков, Псковская обл.",
    routeToId: "53",
    distance: 310,
    weight: 12000,
    volume: 50,
    cargoType: "ТНП, короба",
    truckType: "Тент",
    loadingType: "Боковая",
    price: 30000,
    paymentType: "Безналичные",
    vatIncluded: true,
    loadingIn: 2,
    unloadingIn: 2,
    firmName: "ООО «СеверТорг»",
    contactName: "Фомин Евгений",
    contactPhone: "+7 911 733-26-14",
    aiScore: 74,
    aiReason: "97 ₽/км, короткий рейс, загрузка днём",
  },
  {
    loadId: "14",
    routeFrom: "Москва, Московская обл.",
    routeFromId: "1",
    routeTo: "Тула, Тульская обл.",
    routeToId: "41",
    distance: 193,
    weight: 9000,
    volume: 36,
    cargoType: "Оборудование, запчасти",
    truckType: "Тент",
    loadingType: "Задняя",
    price: 17500,
    paymentType: "Наличные",
    vatIncluded: false,
    loadingIn: 1,
    unloadingIn: 1,
    firmName: "ООО «МашЗапчасть»",
    contactName: "Комаров Илья",
    contactPhone: "+7 925 900-83-46",
    aiScore: 71,
    aiReason: "91 ₽/км, короткий рейс — можно взять с обратом",
  },
  {
    loadId: "15",
    routeFrom: "Воронеж, Воронежская обл.",
    routeFromId: "24",
    routeTo: "Липецк, Липецкая обл.",
    routeToId: "30",
    distance: 208,
    weight: 10000,
    volume: 42,
    cargoType: "Металл, трубы в пачках",
    truckType: "Бортовой",
    loadingType: "Верхняя",
    price: 19000,
    paymentType: "Безналичные",
    vatIncluded: true,
    loadingIn: 2,
    unloadingIn: 2,
    firmName: "ООО «НЛМК-Логистика»",
    contactName: "Белов Роман",
    contactPhone: "+7 906 588-11-92",
    aiScore: 68,
    aiReason: "91 ₽/км, местный рейс, металл — строповка за счёт груза",
  },
  {
    loadId: "16",
    routeFrom: "Красноярск, Красноярский край",
    routeFromId: "84",
    routeTo: "Иркутск, Иркутская обл.",
    routeToId: "72",
    distance: 1062,
    weight: 22000,
    volume: 86,
    cargoType: "Стройматериалы, железобетон",
    truckType: "Тент",
    loadingType: "Верхняя",
    price: 118000,
    paymentType: "Безналичные",
    vatIncluded: true,
    loadingIn: 2,
    unloadingIn: 4,
    firmName: "ООО «ЕнисейСтрой»",
    contactName: "Дудкин Сергей",
    contactPhone: "+7 902 944-60-15",
    aiScore: 86,
    aiReason: "111 ₽/км, длинный рейс — подряд без простоя",
  },
  {
    loadId: "17",
    routeFrom: "Новосибирск, Новосибирская обл.",
    routeFromId: "88",
    routeTo: "Омск, Омская обл.",
    routeToId: "90",
    distance: 651,
    weight: 20000,
    volume: 86,
    cargoType: "Оборудование, негабарит (2,6 м)",
    truckType: "Тент",
    loadingType: "Задняя",
    price: 74000,
    paymentType: "Безналичные",
    vatIncluded: true,
    loadingIn: 1,
    unloadingIn: 3,
    firmName: "ООО «СибЭнергоМаш»",
    contactName: "Крылов Денис",
    contactPhone: "+7 913 077-42-58",
    note: "Негабарит по ширине, нужен согласованный маршрут.",
    aiScore: 89,
    aiReason: "114 ₽/км, негабарит — повышенная ставка",
  },
  {
    loadId: "18",
    routeFrom: "Волгоград, Волгоградская обл.",
    routeFromId: "60",
    routeTo: "Астрахань, Астраханская обл.",
    routeToId: "61",
    distance: 413,
    weight: 18000,
    volume: 82,
    cargoType: "Овощи, арбузы, ящики",
    truckType: "Тент",
    loadingType: "Верхняя",
    price: 39000,
    paymentType: "Наличные",
    vatIncluded: false,
    loadingIn: 1,
    unloadingIn: 2,
    firmName: "ИП Астраханский В.В.",
    contactName: "Астраханский Виктор",
    contactPhone: "+7 917 688-30-71",
    aiScore: 70,
    aiReason: "94 ₽/км, сезонный груз, наличные",
  },
  {
    loadId: "19",
    routeFrom: "Тюмень, Тюменская обл.",
    routeFromId: "112",
    routeTo: "Екатеринбург, Свердловская обл.",
    routeToId: "70",
    distance: 398,
    weight: 22000,
    volume: 86,
    cargoType: "Морские контейнеры, 2×20ft",
    truckType: "Тент",
    loadingType: "Верхняя",
    price: 52000,
    paymentType: "Безналичные",
    vatIncluded: true,
    loadingIn: 2,
    unloadingIn: 3,
    firmName: "ООО «КонтейнерЛайн»",
    contactName: "Юсупов Артур",
    contactPhone: "+7 912 400-55-83",
    aiScore: 85,
    aiReason: "131 ₽/км, контейнеры — хорошая ставка на Урале",
  },
  {
    loadId: "20",
    routeFrom: "Калининград, Калининградская обл.",
    routeFromId: "58",
    routeTo: "Москва, Московская обл.",
    routeToId: "1",
    distance: 1289,
    weight: 20000,
    volume: 86,
    cargoType: "Мебель, в коробах",
    truckType: "Фургон",
    loadingType: "Задняя",
    price: 168000,
    paymentType: "Безналичные",
    vatIncluded: true,
    loadingIn: 2,
    unloadingIn: 5,
    firmName: "ООО «БалтМебель»",
    contactName: "Шмидт Ольга",
    contactPhone: "+7 921 109-47-26",
    note: "Кантоваться запрещено. Пломбы на выгрузке.",
    aiScore: 87,
    aiReason: "130 ₽/км, междугородка — подряд на два дня",
  },
  {
    loadId: "21",
    routeFrom: "Москва, Московская обл.",
    routeFromId: "1",
    routeTo: "Смоленск, Смоленская обл.",
    routeToId: "40",
    distance: 419,
    weight: 12000,
    volume: 60,
    cargoType: "Сухие грузы, паллеты",
    truckType: "Тент",
    loadingType: "Задняя",
    price: 41000,
    paymentType: "Безналичные",
    vatIncluded: true,
    loadingIn: 1,
    unloadingIn: 2,
    firmName: "ООО «ЗападОпт»",
    contactName: "Романюк Андрей",
    contactPhone: "+7 903 812-64-09",
    aiScore: 78,
    aiReason: "98 ₽/км, предоплата 50% при погрузке",
  },
  {
    loadId: "22",
    routeFrom: "Мурманск, Мурманская обл.",
    routeFromId: "48",
    routeTo: "Санкт-Петербург, Ленинградская обл.",
    routeToId: "2",
    distance: 1492,
    weight: 22000,
    volume: 86,
    cargoType: "Оборудование, в ящиках",
    truckType: "Тент",
    loadingType: "Задняя",
    price: 195000,
    paymentType: "Безналичные",
    vatIncluded: true,
    loadingIn: 3,
    unloadingIn: 5,
    firmName: "ООО «АрктикЛогистик»",
    contactName: "Северов Пётр",
    contactPhone: "+7 909 777-31-48",
    aiScore: 88,
    aiReason: "131 ₽/км, северный коридор — зимой выше ставка",
  },
  {
    loadId: "23",
    routeFrom: "Ставрополь, Ставропольский край",
    routeFromId: "64",
    routeTo: "Минеральные Воды, Ставропольский край",
    routeToId: "63",
    distance: 240,
    weight: 8000,
    volume: 34,
    cargoType: "Сельхозпродукция",
    truckType: "Изотерм",
    loadingType: "Задняя",
    price: 22000,
    paymentType: "Наличные",
    vatIncluded: false,
    loadingIn: 1,
    unloadingIn: 1,
    firmName: "ИП Кочкаров М.М.",
    contactName: "Кочкаров Магомед",
    contactPhone: "+7 988 011-37-64",
    aiScore: 67,
    aiReason: "92 ₽/км, местный рейс, изотерм",
  },
  {
    loadId: "24",
    routeFrom: "Хабаровск, Хабаровский край",
    routeFromId: "118",
    routeTo: "Владивосток, Приморский край",
    routeToId: "119",
    distance: 760,
    weight: 20000,
    volume: 86,
    cargoType: "Продукты питания, сухие",
    truckType: "Тент",
    loadingType: "Задняя",
    price: 88000,
    paymentType: "Безналичные",
    vatIncluded: true,
    loadingIn: 2,
    unloadingIn: 4,
    firmName: "ООО «ДальЛогистика»",
    contactName: "Ким Алексей",
    contactPhone: "+7 914 266-53-10",
    aiScore: 84,
    aiReason: "116 ₽/км, дальневосточный коридор, стабильный тоннаж",
  },
]

/** rawJson в формате ATI load — чтобы заказ «из биржи» имел исходник. */
function rawJsonFor(l: SeedLoad): string {
  return JSON.stringify({
    id: Number(l.loadId) * 100000,
    load_id: `${LOAD_PREFIX}${l.loadId}`,
    route: {
      from: {
        city: l.routeFrom.split(",")[0],
        region: l.routeFrom.split(",").slice(1).join(",").trim(),
        id: l.routeFromId,
      },
      to: {
        city: l.routeTo.split(",")[0],
        region: l.routeTo.split(",").slice(1).join(",").trim(),
        id: l.routeToId,
      },
    },
    distance: l.distance,
    weight: l.weight,
    volume: l.volume ?? null,
    cargo_type: l.cargoType,
    truck_type: l.truckType,
    loading_type: l.loadingType ?? null,
    price: l.price,
    price_type: l.priceType ?? "rub",
    payment_type: l.paymentType,
    vat_included: l.vatIncluded,
    loading_date: daysFromNow(l.loadingIn).toISOString(),
    unloading_date: daysFromNow(l.unloadingIn).toISOString(),
    firm: { name: l.firmName },
    contact: { name: l.contactName, phone: l.contactPhone },
    note: l.note ?? null,
    source: "demo-seed",
  })
}

async function resolveOrganizationId(
  email?: string,
  orgId?: string
): Promise<string> {
  if (orgId) return orgId

  // 1. По email пользователя — тот, под кем заходят в приложение
  if (email) {
    const user = await prisma.user.findUnique({ where: { email } })
    if (user?.organizationId) return user.organizationId
    if (user) {
      const first = await prisma.organization.findFirst({
        orderBy: { createdAt: "asc" },
      })
      if (!first) throw new Error("В базе нет ни одной организации")
      await prisma.user.update({
        where: { id: user.id },
        data: { organizationId: first.id },
      })
      console.warn(
        `[seed:ati] Пользователь ${email} не был привязан к организации — привязан к «${first.name}»`
      )
      return first.id
    }
  }

  // 2. Первый пользователь с организацией
  const staff = await prisma.user.findFirst({
    where: { role: { in: ["admin", "logist"] }, organizationId: { not: null } },
  })
  if (staff?.organizationId) return staff.organizationId

  // 3. Первая организация в базе
  const first = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
  })
  if (!first) {
    throw new Error(
      "В базе нет организаций — сначала запустите npm run seed:demo"
    )
  }
  return first.id
}

async function main(): Promise<void> {
  const { email, org, clean } = args()
  const organizationId = await resolveOrganizationId(email, org)
  const org_ = await prisma.organization.findUnique({
    where: { id: organizationId },
  })
  console.log(
    `[seed:ati] Организация: ${org_?.name ?? organizationId} (${organizationId})`
  )

  if (clean) {
    const { count } = await prisma.atiCache.deleteMany({
      where: { organizationId, atiLoadId: { startsWith: LOAD_PREFIX } },
    })
    console.log(`[seed:ati] Удалено демо-грузов: ${count}`)
    return
  }

  const now = Date.now()
  const atiLoadIds = LOADS.map((l) => `${LOAD_PREFIX}${l.loadId}`)

  // Идемпотентность: удаляем прошлые demo-записи этой организации
  await prisma.atiCache.deleteMany({
    where: { organizationId, atiLoadId: { in: atiLoadIds } },
  })

  await prisma.atiCache.createMany({
    data: LOADS.map((l, i) => ({
      organizationId,
      atiLoadId: `${LOAD_PREFIX}${l.loadId}`,
      routeFrom: l.routeFrom,
      routeFromId: l.routeFromId ?? null,
      routeTo: l.routeTo,
      routeToId: l.routeToId ?? null,
      distance: l.distance,
      weight: l.weight,
      volume: l.volume ?? null,
      cargoType: l.cargoType,
      truckType: l.truckType,
      loadingType: l.loadingType ?? null,
      price: l.price,
      priceType: l.priceType ?? "rub",
      paymentType: l.paymentType,
      vatIncluded: l.vatIncluded,
      loadingDate: daysFromNow(l.loadingIn),
      unloadingDate: daysFromNow(l.unloadingIn),
      firmName: l.firmName,
      contactName: l.contactName,
      contactPhone: l.contactPhone,
      note: l.note ?? null,
      rawJson: rawJsonFor(l),
      status: "new",
      aiScore: l.aiScore,
      aiReason: l.aiReason,
      // scannedAt разнообразим, чтобы сортировка «сначала новые» была живой
      scannedAt: new Date(now - i * 37 * 60 * 1000),
      expiresAt: new Date(now + 2 * DAY),
    })),
  })

  const total = await prisma.atiCache.count({ where: { organizationId } })
  console.log(
    `[seed:ati] Создано ${LOADS.length} демо-грузов (всего в бирже: ${total})`
  )
}

main()
  .catch((error) => {
    console.error("[seed:ati] Ошибка:", error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

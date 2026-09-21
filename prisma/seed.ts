// prisma/seed.ts

import { PrismaClient } from "@prisma/client"
import crypto from "node:crypto"

const prisma = new PrismaClient()

async function main() {
  console.log("Запуск наполнения базы данных реалистичными данными флота...")

  // 1. Настройки автопарка
  await prisma.fleetSettings.upsert({
    where: { id: "default" },
    update: {
      parkName: "Центральный Логистический Хаб",
      baseAddress: "Московская обл., г. Домодедово, Логистическая ул., 1",
      baseLat: 55.4431,
      baseLng: 37.7491,
    },
    create: {
      id: "default",
      parkName: "Центральный Логистический Хаб",
      baseAddress: "Московская обл., г. Домодедово, Логистическая ул., 1",
      baseLat: 55.4431,
      baseLng: 37.7491,
    },
  })

  // 2. Очищаем старые тестовые заказы и смены если были
  await prisma.shiftEvent.deleteMany()
  await prisma.driverShift.deleteMany()
  await prisma.order.deleteMany()
  await prisma.route.deleteMany()
  await prisma.driver.deleteMany()
  await prisma.vehicle.deleteMany()

  // 3. Создаем транспортные средства
  const vehiclesData = [
    {
      id: "veh-1",
      plate: "А123БВ777",
      type: "Тягач с полуприцепом 20т",
      brand: "Scania",
      model: "R450",
      year: 2022,
      capacity: 20000,
      volume: 92,
      length: 13.6,
      width: 2.45,
      height: 2.7,
      features: JSON.stringify(["тент", "пневмоподвеска", "GPS", "пломбировка"]),
      status: "in_use",
      mileage: 184500,
    },
    {
      id: "veh-2",
      plate: "В456ГД199",
      type: "Рефрижератор 10т",
      brand: "MAN",
      model: "TGM 18.290",
      year: 2021,
      capacity: 10000,
      volume: 48,
      length: 8.5,
      width: 2.45,
      height: 2.5,
      features: JSON.stringify(["рефрижератор", "-20...+12C", "термописец"]),
      status: "in_use",
      mileage: 142000,
    },
    {
      id: "veh-3",
      plate: "Е789ЖЗ799",
      type: "Тент 5т (Камаз Компас 9)",
      brand: "КАМАЗ",
      model: "Компас 9",
      year: 2023,
      capacity: 5000,
      volume: 32,
      length: 6.2,
      width: 2.3,
      height: 2.4,
      features: JSON.stringify(["тент", "гидроборт", "боковая загрузка"]),
      status: "in_use",
      mileage: 67300,
    },
    {
      id: "veh-4",
      plate: "К321МН77",
      type: "Фура 20т (штора)",
      brand: "Mercedes-Benz",
      model: "Actros 1845",
      year: 2021,
      capacity: 22000,
      volume: 96,
      length: 13.6,
      width: 2.45,
      height: 2.8,
      features: JSON.stringify(["штора", "верхняя загрузка", "ADR 3"]),
      status: "in_use",
      mileage: 215000,
    },
    {
      id: "veh-5",
      plate: "О654РТ150",
      type: "Газель Next 1.5т",
      brand: "ГАЗ",
      model: "ГАЗель Next",
      year: 2022,
      capacity: 1500,
      volume: 16,
      length: 4.2,
      width: 2.0,
      height: 2.2,
      features: JSON.stringify(["городской пропуск", "экспедирование"]),
      status: "available",
      mileage: 89000,
    },
    {
      id: "veh-6",
      plate: "Х777АМ77",
      type: "Тягач 20т (штора)",
      brand: "Volvo",
      model: "FH16",
      year: 2020,
      capacity: 20000,
      volume: 90,
      length: 13.6,
      width: 2.45,
      height: 2.7,
      features: JSON.stringify(["штора", "пневмоподвеска"]),
      status: "maintenance",
      mileage: 310000,
    },
  ]

  for (const v of vehiclesData) {
    await prisma.vehicle.create({ data: v })
  }

  // 4. Создаем водителей с текущими координатами и статусами из мобильного приложения
  const driversData = [
    {
      id: "drv-1",
      name: "Алексей Смирнов",
      phone: "+7 (916) 123-45-67",
      vehicleId: "veh-1",
      vehicleType: "Тягач 20т (Scania R450)",
      vehiclePlate: "А123БВ777",
      currentLocation: "Трасса М-10, р-н Торжка (в пути)",
      latitude: 56.9856,
      longitude: 35.0421,
      lastGpsUpdate: new Date(),
      status: "busy",
      ordersCompleted: 248,
      rating: 4.95,
      // Статус из мобильного приложения: В ПУТИ
      mobileShift: {
        status: "driving",
        startedAgoMinutes: 240, // 4 часа смена
        statusAgoMinutes: 220,  // в пути 3ч 40м
        totalDrivingSeconds: 13200,
        totalRestingSeconds: 0,
        totalLoadingSeconds: 1200,
        drivingSinceRestSeconds: 13200,
      },
    },
    {
      id: "drv-2",
      name: "Дмитрий Кузнецов",
      phone: "+7 (920) 234-56-78",
      vehicleId: "veh-2",
      vehicleType: "Рефрижератор 10т (MAN TGM)",
      vehiclePlate: "В456ГД199",
      currentLocation: "Стоянка АЗС, М-7 р-н Покрова (Отдых РТО)",
      latitude: 55.9189,
      longitude: 39.1823,
      lastGpsUpdate: new Date(),
      status: "busy",
      ordersCompleted: 182,
      rating: 4.88,
      // Статус из мобильного приложения: ОТДЫХ (РТО)
      mobileShift: {
        status: "resting",
        startedAgoMinutes: 280,
        statusAgoMinutes: 35, // отдыхает 35 минут по тахографу
        totalDrivingSeconds: 14700,
        totalRestingSeconds: 2100,
        totalLoadingSeconds: 0,
        drivingSinceRestSeconds: 0,
      },
    },
    {
      id: "drv-3",
      name: "Сергей Васильев",
      phone: "+7 (905) 345-67-89",
      vehicleId: "veh-3",
      vehicleType: "Камаз 5т (Компас 9)",
      vehiclePlate: "Е789ЖЗ799",
      currentLocation: "Складской терминал Чехов (Погрузка)",
      latitude: 55.1432,
      longitude: 37.4721,
      lastGpsUpdate: new Date(),
      status: "busy",
      ordersCompleted: 115,
      rating: 4.92,
      // Статус из мобильного приложения: ПОГРУЗКА
      mobileShift: {
        status: "loading",
        startedAgoMinutes: 60,
        statusAgoMinutes: 52, // на погрузке 52 минуты
        totalDrivingSeconds: 480,
        totalRestingSeconds: 0,
        totalLoadingSeconds: 3120,
        drivingSinceRestSeconds: 480,
      },
    },
    {
      id: "drv-4",
      name: "Михаил Попов",
      phone: "+7 (917) 456-78-90",
      vehicleId: "veh-4",
      vehicleType: "Фура 20т (Mercedes Actros)",
      vehiclePlate: "К321МН77",
      currentLocation: "Ярославское шоссе М-8, Сергиев Посад (в пути)",
      latitude: 56.3153,
      longitude: 38.1360,
      lastGpsUpdate: new Date(),
      status: "busy",
      ordersCompleted: 310,
      rating: 4.97,
      // Статус из мобильного приложения: В ПУТИ
      mobileShift: {
        status: "driving",
        startedAgoMinutes: 90,
        statusAgoMinutes: 75, // в пути 1ч 15м
        totalDrivingSeconds: 4500,
        totalRestingSeconds: 0,
        totalLoadingSeconds: 900,
        drivingSinceRestSeconds: 4500,
      },
    },
    {
      id: "drv-5",
      name: "Роман Морозов",
      phone: "+7 (926) 567-89-01",
      vehicleId: "veh-5",
      vehicleType: "Газель Next 1.5т",
      vehiclePlate: "О654РТ150",
      currentLocation: "Центральный Хаб Домодедово (Ожидание)",
      latitude: 55.4431,
      longitude: 37.7491,
      lastGpsUpdate: new Date(),
      status: "available",
      ordersCompleted: 76,
      rating: 4.85,
      // Статус из мобильного приложения: ОЖИДАНИЕ
      mobileShift: {
        status: "waiting",
        startedAgoMinutes: 45,
        statusAgoMinutes: 25, // ждет распоряжения 25 минут
        totalDrivingSeconds: 0,
        totalRestingSeconds: 0,
        totalLoadingSeconds: 0,
        drivingSinceRestSeconds: 0,
      },
    },
    {
      id: "drv-6",
      name: "Виктор Орлов",
      phone: "+7 (903) 789-01-23",
      vehicleId: "veh-6",
      vehicleType: "Тягач 20т (Volvo FH16)",
      vehiclePlate: "Х777АМ77",
      currentLocation: "Грузовой сервис 'Трак-Мастер', Подольск (ТО / Ремонт)",
      latitude: 55.4312,
      longitude: 37.5457,
      lastGpsUpdate: new Date(),
      status: "maintenance",
      ordersCompleted: 194,
      rating: 4.91,
      mobileShift: null, // не на смене, машина на ремонте
    },
  ]

  for (const d of driversData) {
    const { mobileShift, ...driverFields } = d
    await prisma.driver.create({ data: driverFields })

    // Открываем активную смену со статусом из мобильного приложения
    if (mobileShift) {
      await prisma.driverShift.create({
        data: {
          driverId: d.id,
          status: mobileShift.status,
          startedAt: new Date(Date.now() - mobileShift.startedAgoMinutes * 60 * 1000),
          lastStatusChangeAt: new Date(Date.now() - mobileShift.statusAgoMinutes * 60 * 1000),
          totalDrivingSeconds: mobileShift.totalDrivingSeconds,
          totalRestingSeconds: mobileShift.totalRestingSeconds,
          totalLoadingSeconds: mobileShift.totalLoadingSeconds,
          drivingSinceRestSeconds: mobileShift.drivingSinceRestSeconds,
        },
      })
    }
  }

  // 4.5. Создаем аккаунт администратора и базовые рейсы для заказов
  const s = "481781a8f30384dc74225fba63b02465"
  const hash = crypto.pbkdf2Sync("demo", s, 100000, 64, "sha512").toString("hex")
  await prisma.user.upsert({
    where: { email: "admin@loginex.ru" },
    update: {
      passwordHash: hash,
      salt: s,
      role: "admin",
      status: "active",
    },
    create: {
      email: "admin@loginex.ru",
      name: "Главный Логист (Loginex)",
      passwordHash: hash,
      salt: s,
      role: "admin",
      status: "active",
    },
  })

  const routesToCreate = [
    {
      id: "route-m10-spb",
      name: "Рейс #101: Москва (Юг) — Тверь — СПб (Шушары)",
      status: "active",
      driverId: "drv-1",
      vehicleId: "veh-1",
      totalDistance: 710,
      totalCost: 98000,
      fuelExpense: 22000,
      cargoWeight: 19500,
      cargoVolume: 86.0,
    },
    {
      id: "route-m7-nn",
      name: "Рейс #102: Ногинск — Покров — Нижний Новгород",
      status: "active",
      driverId: "drv-2",
      vehicleId: "veh-2",
      totalDistance: 380,
      totalCost: 64000,
      fuelExpense: 14500,
      cargoWeight: 8500,
      cargoVolume: 42.0,
    },
    {
      id: "route-m4-vrn",
      name: "Рейс #103: Чехов — Тула — Воронеж",
      status: "active",
      driverId: "drv-3",
      vehicleId: "veh-3",
      totalDistance: 470,
      totalCost: 52000,
      fuelExpense: 11200,
      cargoWeight: 4800,
      cargoVolume: 28.0,
    },
    {
      id: "route-m8-yar",
      name: "Рейс #104: Москва (Север) — Переславль — Ярославль",
      status: "active",
      driverId: "drv-4",
      vehicleId: "veh-4",
      totalDistance: 260,
      totalCost: 49000,
      fuelExpense: 8500,
      cargoWeight: 18000,
      cargoVolume: 82.0,
    },
  ]

  for (const r of routesToCreate) {
    await prisma.route.upsert({
      where: { id: r.id },
      update: r,
      create: r,
    })
  }

  // 5. Создаем активные заказы с рейсами между регионами/областями
  const ordersData = [
    {
      id: "ord-101",
      source: "ATI.SU",
      sourceId: "ati-94812",
      routeFrom: "Москва, Склад Юг",
      routeTo: "Санкт-Петербург, Шушары",
      distance: 710,
      weight: 19500,
      volume: 86.0,
      cargoType: "Промышленное оборудование",
      loadingType: "верхняя, тент",
      price: 98000,
      clientName: "ООО 'БалтСнаб'",
      clientContact: "+7 (812) 345-67-89",
      deadline: new Date(Date.now() + 86400000 * 2),
      status: "in_transit",
      assignedDriverId: "drv-1",
      assignedVehicleId: "veh-1",
      routeId: "route-m10-spb",
    },
    {
      id: "ord-102",
      source: "Прямой договор",
      sourceId: "cnt-4421",
      routeFrom: "Ногинск, Распределительный центр",
      routeTo: "Нижний Новгород, Сормово",
      distance: 380,
      weight: 8500,
      volume: 42.0,
      cargoType: "Фармацевтическая продукция (+4...+8C)",
      loadingType: "задняя, рефрижератор",
      price: 64000,
      clientName: "АО 'ВолгаФарм'",
      clientContact: "+7 (831) 234-56-78",
      deadline: new Date(Date.now() + 86400000),
      status: "in_transit",
      assignedDriverId: "drv-2",
      assignedVehicleId: "veh-2",
      routeId: "route-m7-nn",
    },
    {
      id: "ord-103",
      source: "Грузопоток",
      sourceId: "gp-7712",
      routeFrom: "Чехов, Логистический парк",
      routeTo: "Воронеж, Промзона",
      distance: 470,
      weight: 4800,
      volume: 28.0,
      cargoType: "Электротехнические изделия",
      loadingType: "боковая",
      price: 52000,
      clientName: "ООО 'ЧерноземЭнерго'",
      clientContact: "+7 (473) 299-11-22",
      deadline: new Date(Date.now() + 86400000 * 2),
      status: "loading",
      assignedDriverId: "drv-3",
      assignedVehicleId: "veh-3",
      routeId: "route-m4-vrn",
    },
    {
      id: "ord-104",
      source: "ATI.SU",
      sourceId: "ati-88231",
      routeFrom: "Москва, Северный терминал",
      routeTo: "Ярославль, База снабжения",
      distance: 260,
      weight: 18000,
      volume: 82.0,
      cargoType: "Металлоконструкции",
      loadingType: "верхняя",
      price: 49000,
      clientName: "Завод 'ЯрСталь'",
      clientContact: "+7 (4852) 77-88-99",
      deadline: new Date(Date.now() + 86400000),
      status: "in_transit",
      assignedDriverId: "drv-4",
      assignedVehicleId: "veh-4",
      routeId: "route-m8-yar",
    },
  ]

  for (const o of ordersData) {
    await prisma.order.create({ data: o })
  }

  // 6. Добавим кэш геокодирования для ключевых городов, чтобы API мгновенно строило маршруты
  const geoPoints = [
    { address: "Москва, Склад Юг", lat: 55.6012, lng: 37.6123 },
    { address: "Санкт-Петербург, Шушары", lat: 59.8134, lng: 30.3842 },
    { address: "Ногинск, Распределительный центр", lat: 55.8584, lng: 38.4412 },
    { address: "Нижний Новгород, Сормово", lat: 56.3512, lng: 43.8741 },
    { address: "Чехов, Логистический парк", lat: 55.1432, lng: 37.4721 },
    { address: "Воронеж, Промзона", lat: 51.6712, lng: 39.2104 },
    { address: "Москва, Северный терминал", lat: 55.8821, lng: 37.5214 },
    { address: "Ярославль, База снабжения", lat: 57.6261, lng: 39.8845 },
    { address: "Тверь", lat: 56.8584, lng: 35.9006 },
    { address: "Владимир", lat: 56.1290, lng: 40.4066 },
    { address: "Тула", lat: 54.1931, lng: 37.6173 },
    { address: "Подольск", lat: 55.4312, lng: 37.5457 },
  ]

  for (const pt of geoPoints) {
    await prisma.geoCache.upsert({
      where: { address: pt.address },
      update: { lat: pt.lat, lng: pt.lng },
      create: { address: pt.address, lat: pt.lat, lng: pt.lng },
    })
  }

  console.log("Успешно создано: 6 ТС, 6 водителей с мобильными статусами (в пути, отдых РТО, погрузка, ожидание, ТО) и активные заказы!")
}

main()
  .catch((e) => {
    console.error("Ошибка сидирования:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

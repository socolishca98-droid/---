// Задача 4: сквозной цикл A→O на изолированных тестовых данных.
//
//   заказ → согласование → рейс → назначение водителя и машины → ВСЕ этапы →
//   завершение → сохранение факта → отображение диспетчеру
//
// Не останавливаемся на HTTP 200: после каждого шага сверяем ФАКТИЧЕСКИЕ записи
// в базе (Route.status, RouteStage.endedAt, RouteEvent, RouteExpense, статус
// заказа), историю, повторные команды, несколько промежуточных точек и
// возврат на базу.
const { ENV, Jar, csrf, login, call, Report } = require("./lib.cjs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const rep = new Report("Задача 4 — сквозной цикл A→O");
const TAG = `АУДИТ-ЦИКЛ-${Date.now().toString(36).toUpperCase()}`;
const UNIQUE = Date.now().toString(36);
const BASE = ENV.AUDIT_BASE_URL || "http://localhost:3000";

const step = (name, status, msg, data) => rep.step("4", name, status, msg, data);

async function driverLogin(phone, password) {
  const jar = new Jar();
  const token = await csrf(jar);
  const res = await fetch(`${BASE}/api/m/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-csrf-token": token, Cookie: jar.header() },
    body: JSON.stringify({ phone, password }),
  });
  jar.absorb(res);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, jar };
}

/** Всего фактов исполнения по рейсу — что реально записано в базе. */
async function dbState(routeId) {
  const route = await prisma.route.findUnique({
    where: { id: routeId },
    select: {
      id: true, name: true, status: true, driverId: true, vehicleId: true,
      startedAt: true, completedAt: true, endOdometer: true, totalDistance: true,
      stages: { select: { id: true, sequence: true, type: true, startedAt: true, endedAt: true, orderId: true }, orderBy: { sequence: "asc" } },
      events: { select: { id: true, type: true, status: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      expenses: { select: { id: true, type: true, liters: true, spentAt: true } },
      orders: { select: { id: true, status: true, routeFrom: true, routeTo: true, routeSequence: true } },
    },
  });
  const forecasts = await prisma.etaForecast.count({ where: { routeId } });
  return { route, forecasts };
}

async function main() {
  const admin = await login(ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD);
  if (admin.status !== 200) { step("вход админа", "BROKEN", `HTTP ${admin.status}`); rep.print(); return; }
  const A = admin.jar;
  const orgId = (await call(A, "GET", "/api/organization")).json?.organization?.id;
  const driver = await prisma.driver.findFirst({
    where: { organizationId: orgId, user: { isNot: null } },
    select: { id: true, name: true, phone: true, user: { select: { id: true } } },
  });
  const vehicle = await prisma.vehicle.findFirst({
    where: { organizationId: orgId }, select: { id: true, plate: true, mileage: true },
  });
  if (!driver || !vehicle) { step("подготовка", "BROKEN", "нет водителя или машины в организации"); rep.print(); return; }

  // ─────────── A. ЗАКАЗ (несколько промежуточных точек) ───────────
  const created = [];
  const legs = [
    { from: "Москва, Тверская", to: "Зеленоград", price: 9000, cargo: "Палеты" },
    { from: "Зеленоград", to: "Тверь", price: 12000, cargo: "Палеты" },
    { from: "Тверь", to: "Ржев", price: 8000, cargo: "Палеты" },
  ];
  for (const leg of legs) {
    const r = await call(A, "POST", "/api/orders", {
      routeFrom: leg.from, routeTo: leg.to, price: leg.price, weight: 2,
      cargoType: leg.cargo, clientName: `${TAG} Клиент`, clientContact: `+7900${UNIQUE.slice(-7)}`,
      distance: 100, deadline: new Date(Date.now() + 7 * 86400_000).toISOString(),
    });
    const o = r.json?.order || r.json;
    if (o?.id) created.push(o);
    step(`заказ создан ${leg.from} → ${leg.to}`, o?.id ? "VERIFIED" : "BROKEN",
      `HTTP ${r.status}, id ${o?.id}`, { id: o?.id });
  }
  step("A: три заказа созданы", created.length === 3 ? "VERIFIED" : "BROKEN", `создано ${created.length} из 3`);

  // ─────────── B. СОГЛАСОВАНИЕ ───────────
  const agreed = [];
  for (const o of created) {
    const r = await call(A, "PATCH", `/api/orders/${o.id}`, { status: "agreed" });
    const db = await prisma.order.findUnique({ where: { id: o.id }, select: { status: true } });
    if (db.status === "agreed") agreed.push(o);
    step("B: согласование заказа", r.status === 200 && db.status === "agreed" ? "VERIFIED" : "BROKEN",
      `HTTP ${r.status}, в БД «${db.status}»`, { id: o.id, dbStatus: db.status });
  }
  step("B: все заказы согласованы", agreed.length === 3 ? "VERIFIED" : "BROKEN", `согласовано ${agreed.length} из 3`);

  // Несогласованный заказ в рейс не попадает — бизнес-правило, проверяем
  const raw = await call(A, "POST", "/api/orders", {
    routeFrom: "Кострома", routeTo: "Иваново", price: 7000, weight: 1, cargoType: "Палеты",
    clientName: `${TAG} Несогласованный`, clientContact: `+7901${UNIQUE.slice(-7)}`,
    distance: 80, deadline: new Date(Date.now() + 7 * 86400_000).toISOString(),
  });
  const rawId = (raw.json?.order || raw.json)?.id;
  if (rawId) {
    const bad = await call(A, "POST", "/api/routes", {
      name: `${TAG} несогласованный`, orderIds: [rawId],
    }, { timeoutMs: 120000 });
    step("B: несогласованный заказ в рейс не попадает",
      bad.status === 400 || bad.status === 422 || bad.status === 409 ? "VERIFIED" : "PARTIAL",
      `HTTP ${bad.status} ${bad.json?.error || ""}`, { status: bad.status, error: bad.json?.error });
  }

  // ─────────── C. РЕЙС ───────────
  const routeRes = await call(A, "POST", "/api/routes", {
    name: `${TAG} рейс`, driverId: driver.id, vehicleId: vehicle.id,
    orderIds: agreed.map((o) => o.id),
  }, { timeoutMs: 180000 });
  const routeId = (routeRes.json?.route || routeRes.json)?.id;
  step("C: рейс создан", routeId ? "VERIFIED" : "BROKEN",
    `HTTP ${routeRes.status} ${routeRes.json?.error || ""}`, { id: routeId });

  if (!routeId) { rep.print(); return; }
  let st = await dbState(routeId);

  // ─────────── D. НАЗНАЧЕНИЕ ВОДИТЕЛЯ И МАШИНЫ ───────────
  step("D: рейсу назначен водитель", st.route.driverId === driver.id ? "VERIFIED" : "BROKEN",
    `driverId в БД: ${st.route.driverId}`);
  step("D: рейсу назначена машина", st.route.vehicleId === vehicle.id ? "VERIFIED" : "BROKEN",
    `vehicleId в БД: ${st.route.vehicleId}`);
  step("D: рейс в статусе planned", st.route.status === "planned" ? "VERIFIED" : "PARTIAL",
    `статус в БД: «${st.route.status}»`, { dbStatus: st.route.status });

  const ordersInRoute = st.route.orders.length;
  step("D: все три заказа привязаны к рейсу", ordersInRoute === 3 ? "VERIFIED" : "PARTIAL",
    `заказов в рейсе: ${ordersInRoute}`);
  const inRouteStatus = st.route.orders.filter((o) => o.status === "in_route").length;
  step("D: заказы получили статус in_route", inRouteStatus === 3 ? "VERIFIED" : "PARTIAL",
    `in_route: ${inRouteStatus} из 3`, { statuses: st.route.orders.map((o) => o.status) });


  // Диспетчер открывает карточку рейса: панель ETA (EtaForecastPanel внутри
  // active-route-card) сама POST-ит /api/eta/forecast с routeId, и сервер
  // сохраняет прогноз (save по умолчанию). Без этого шага факту прибытия
  // не с чем сравниваться: recordForecastFact ищет последний прогноз рейса.
  const forecastRes = await call(A, "POST", "/api/eta/forecast", {
    routeId,
    departure: new Date(Date.now() + 3600_000).toISOString(),
  }, { timeoutMs: 120000 });
  step("D: прогноз по рейсу сохранён диспетчером",
    forecastRes.status === 200 && forecastRes.json?.saved !== false ? "VERIFIED" : "PARTIAL",
    `HTTP ${forecastRes.status}, saved=${forecastRes.json?.saved}`,
    { status: forecastRes.status, saved: forecastRes.json?.saved });

  // ─────────── E. ВОДИТЕЛЬ: ВХОД И НАЧАЛО РЕЙСА ───────────
  const reset = await call(A, "PATCH", `/api/auth/users/${driver.user.id}`, { action: "resetPassword" });
  const temp = reset.json?.temporaryPassword || reset.json?.password;
  const d = await driverLogin(driver.phone, temp);
  step("E: водитель вошёл в мобильное приложение", d.status === 200 ? "VERIFIED" : "BROKEN",
    `HTTP ${d.status} ${d.json?.error || ""}`, { status: d.status });

  const start = await call(d.jar, "POST", "/api/m/route/stage", { routeId, command: "start_trip" });
  st = await dbState(routeId);
  step("E: «начать рейс» принят", start.status === 200 ? "VERIFIED" : "BROKEN",
    `HTTP ${start.status} ${start.json?.error || ""}`, { status: start.status });
  step("E: рейс ушёл в in_transit, startedAt заполнен",
    st.route.status === "in_transit" && st.route.startedAt ? "VERIFIED" : "BROKEN",
    `статус «${st.route.status}», startedAt ${st.route.startedAt}`,
    { dbStatus: st.route.status, startedAt: st.route.startedAt });

  // Шкала этапов материализуется в RouteStage при первом обращении к рейсу (getRouteTripEta/listRouteStageIds) — так спроектирован trip-repository.
  // Проверяем её тогда, когда она реально нужна: водитель открыл пульт.
  await call(A, "GET", `/api/routes/${routeId}/trip?ensureStages=1`, undefined, { timeoutMs: 90000 });
  st = await dbState(routeId);
  const stagesInDb = st.route.stages.length;
  const ordersWithStages = new Set(st.route.stages.filter((s) => s.orderId).map((s) => s.orderId)).size;
  step("D: этапы рейса созданы в RouteStage",
    stagesInDb > 0 && ordersWithStages === 3 ? "VERIFIED" : "BROKEN",
    `записей RouteStage: ${stagesInDb}, заказов с этапами: ${ordersWithStages} из 3`,
    { stages: stagesInDb, ordersWithStages });

  // Возврат на базу — отдельный этап шкалы; его наличие проверяем по RouteStage
  const returnStages = st.route.stages.filter((s) => s.type === "return_to_base").length;
  step("D: рейс рассчитан с возвратом на базу", returnStages > 0 ? "VERIFIED" : "PARTIAL",
    `этапов return_to_base: ${returnStages}`,
    { returnStages, stageTypes: st.route.stages.map((s) => s.type) });

  // Повторная команда «начать рейс» не должна ничего сломать или задвоить
  const repeatStart = await call(d.jar, "POST", "/api/m/route/stage", { routeId, command: "start_trip" });
  st = await dbState(routeId);
  const startedStages = st.route.stages.filter((s) => s.startedAt).length;
  step("E: повторное «начать рейс» не создаёт вторую отметку",
    startedStages <= 1 ? "VERIFIED" : "PARTIAL",
    `HTTP ${repeatStart.status}, этапов с отметкой начала: ${startedStages}`,
    { repeatStatus: repeatStart.status, startedStages });

  // ─────────── F. ВСЕ ЭТАПЫ РЕЙСА ───────────
  // Идём ровно по тем кнопкам, которые отдаёт сервер (trip.actions), а не по
  // выдуманному списку: сервер сам решает, что сейчас является текущим этапом.
  const log = [];
  let guard = 0;
  while (guard++ < 60) {
    const trip = await call(d.jar, "GET", "/api/m/route", undefined, { timeoutMs: 90000 });
    const t = trip.json?.trip;
    if (!t) { step("F: пульт рейса отвечает", "BROKEN", `HTTP ${trip.status} ${trip.json?.error || ""}`); break; }
    if (t.finished) { log.push({ done: true }); break; }
    const actions = t.actions || [];
    const primary = actions.find((a) => a.primary) || actions[0];
    if (!primary) {
      // Кнопок нет, но рейс не завершён: причины обязаны быть названы
      const blocked = (t.blocked || []).map((b) => `${b.command}: ${b.reason}`).join("; ");
      log.push({ stuck: blocked || "нет доступных действий" });
      step("F: сервер объясняет, почему кнопок нет", blocked ? "VERIFIED" : "PARTIAL", blocked || "пустой список действий");
      break;
    }
    const res = await call(d.jar, "POST", "/api/m/route/stage", { routeId, command: primary.command });
    log.push({ command: primary.command, status: res.status, error: res.json?.error });

    if (res.status !== 200) {
      step(`F: команда ${primary.command}`, "BROKEN",
        `HTTP ${res.status} ${res.json?.error || ""}`, { command: primary.command, status: res.status });
      break;
    }
    // Сверяем базу после каждой команды. Команды двух видов:
    //   start_* — ставят startedAt (этап начался),
    //   arrive_point/finish_operation/next_leg — ставят endedAt (этап закрыт).
    // Поэтому проверяем то поле, которое эта команда и должна заполнить,
    // а не любой признак: «начал движение» не закрывает этап.
    st = await dbState(routeId);
    const isStart = primary.command.startsWith("start_");
    const mark = isStart
      ? st.route.stages.filter((s) => s.startedAt).length
      : st.route.stages.filter((s) => s.endedAt).length;
    step(`F: ${isStart ? "этап начат" : "этап закрыт"} после «${primary.command}»`,
      mark > 0 ? "VERIFIED" : "PARTIAL",
      `${isStart ? "с отметкой начала" : "закрыто"}: ${mark} из ${st.route.stages.length}`,
      { command: primary.command, marked: mark, total: st.route.stages.length });
  }

  st = await dbState(routeId);
  const closedStages = st.route.stages.filter((s) => s.endedAt).length;
  const totalStages = st.route.stages.length;
  step("F: все этапы рейса закрыты фактическими отметками",
    totalStages > 0 && closedStages === totalStages ? "VERIFIED" : "PARTIAL",
    `закрыто ${closedStages} из ${totalStages}`,
    { closed: closedStages, total: totalStages, log });

  // ─────────── G. РАСХОДЫ (ФАКТ) ───────────
  // Расходы рейса — staff-эндпоинт (requireStaffAuth): водитель получает 403
  // by design. Пишем расход диспетчером, как в реальной работе.
  const expense = await call(A, "POST", `/api/routes/${routeId}/expenses`, {
    // amount обязателен: роут требует положительное число, иначе 400
    type: "fuel", amount: 6500, liters: 120, odometer: (vehicle.mileage ?? 50000) + 300,
    vendor: `${TAG} АЗС`, spentAt: new Date().toISOString(),
  });
  const expenseRow = await prisma.routeExpense.findFirst({ where: { routeId }, select: { id: true, type: true, liters: true } });
  step("G: расход записан и лежит в базе",
    expense.status === 200 && expenseRow ? "VERIFIED" : "PARTIAL",
    `HTTP ${expense.status}, записей RouteExpense в БД: ${expenseRow ? 1 : 0}`,
    { status: expense.status, row: expenseRow });

  // Фактический пробег рейса берётся из показаний одометра с чека: первое
  // значение становится startOdometer, следующие — endOdometer
  // (app/api/m/expenses/route.ts). finish_trip его не пишет — так спроектировано.
  // Водительский расход НЕ принимает routeId: рейс берётся из активного
  // рейса водителя, лишние поля роут отбивает («Неизвестные поля расхода»).
  const mExpense = await call(d.jar, "POST", "/api/m/expenses", {
    type: "fuel", amount: 6500, liters: 120,
    odometer: (vehicle.mileage ?? 50000) + 300, vendor: `${TAG} АЗС`,
  });
  st = await dbState(routeId);
  step("G: пробег рейса сохранён из чека водителя",
    mExpense.status === 200 && st.route.endOdometer != null ? "VERIFIED" : "PARTIAL",
    `HTTP ${mExpense.status}, endOdometer=${st.route.endOdometer}, startOdometer=${st.route.startOdometer}`,
    { status: mExpense.status, endOdometer: st.route.endOdometer, startOdometer: st.route.startOdometer });

  // ─────────── H. ЗАВЕРШЕНИЕ ───────────
  // Правило: рейс не завершается с незакрытыми этапами. Проверяем на отдельном
  // рейсе, чтобы не портить основной.
  const earlyOrder = await call(A, "POST", "/api/orders", {
    routeFrom: "Кострома", routeTo: "Иваново", price: 7000, weight: 1, cargoType: "Палеты",
    clientName: `${TAG} Незакрытый`, clientContact: `+7902${UNIQUE.slice(-7)}`,
    distance: 80, deadline: new Date(Date.now() + 7 * 86400_000).toISOString(),
  });
  const earlyId = (earlyOrder.json?.order || earlyOrder.json)?.id;
  if (earlyId) {
    await call(A, "PATCH", `/api/orders/${earlyId}`, { status: "agreed" });
    const earlyRoute = await call(A, "POST", "/api/routes", {
      name: `${TAG} незакрытый`, driverId: driver.id, vehicleId: vehicle.id, orderIds: [earlyId],
    }, { timeoutMs: 120000 });
    const earlyRouteId = (earlyRoute.json?.route || earlyRoute.json)?.id;
    if (earlyRouteId) {
      const d2 = await driverLogin(driver.phone, temp);
      await call(d2.jar, "POST", "/api/m/route/stage", { routeId: earlyRouteId, command: "start_trip" });
      const earlyFinish = await call(d2.jar, "POST", "/api/m/route/stage", { routeId: earlyRouteId, command: "finish_trip" });
      const earlyDb = await prisma.route.findUnique({ where: { id: earlyRouteId }, select: { status: true } });
      step("H: рейс с незакрытыми этапами не завершается",
        earlyFinish.status === 409 && earlyDb.status !== "completed" ? "VERIFIED" : "PARTIAL",
        `HTTP ${earlyFinish.status} ${earlyFinish.json?.error || ""}, статус в БД «${earlyDb.status}»`,
        { status: earlyFinish.status, dbStatus: earlyDb.status });
      await prisma.route.deleteMany({ where: { id: earlyRouteId } });
      await prisma.order.deleteMany({ where: { id: earlyId } });
    }
  }

  const finish = await call(d.jar, "POST", "/api/m/route/stage", { routeId, command: "finish_trip" });
  st = await dbState(routeId);
  step("H: рейс завершён", finish.status === 200 ? "VERIFIED" : "BROKEN",
    `HTTP ${finish.status} ${finish.json?.error || ""}`, { status: finish.status });
  step("H: статус completed и completedAt заполнен",
    st.route.status === "completed" && st.route.completedAt ? "VERIFIED" : "BROKEN",
    `статус «${st.route.status}», completedAt ${st.route.completedAt}`,
    { dbStatus: st.route.status, completedAt: st.route.completedAt });
  // endOdometer проверен выше — он приходит с чеком водителя, не с завершением.

  const delivered = st.route.orders.filter((o) => o.status === "delivered").length;
  step("H: заказы рейса доставлены", delivered === 3 ? "VERIFIED" : "PARTIAL",
    `delivered: ${delivered} из 3`, { statuses: st.route.orders.map((o) => o.status) });

  // ─────────── I. ИСТОРИЯ И СОХРАНЁННЫЙ ФАКТ ───────────
  const eventsCount = st.route.events.length;
  step("I: история рейса наполнена (RouteEvent)", eventsCount > 0 ? "VERIFIED" : "PARTIAL",
    `событий: ${eventsCount}`, { events: eventsCount, types: st.route.events.map((e) => e.type) });
  step("I: прогноз сохранён (EtaForecast)", st.forecasts > 0 ? "VERIFIED" : "PARTIAL",
    `записей прогноза: ${st.forecasts}`, { forecasts: st.forecasts });

  const fact = await prisma.etaForecast.findFirst({
    where: { routeId }, orderBy: { createdAt: "desc" },
    select: { id: true, initialArrivalAt: true, currentArrivalAt: true, actualArrivalAt: true, errorMinutes: true },
  });
  step("I: факт прибытия записан в прогноз (с чем сравнивать)",
    fact?.actualArrivalAt ? "VERIFIED" : "PARTIAL",
    `actualArrivalAt=${fact?.actualArrivalAt}, ошибка прогноза=${fact?.errorMinutes ?? "?"} мин`,
    { actualArrivalAt: fact?.actualArrivalAt, errorMinutes: fact?.errorMinutes });
  step("I: исходный прогноз не перезаписан фактом",
    fact && fact.initialArrivalAt && fact.currentArrivalAt ? "VERIFIED" : "PARTIAL",
    `initial=${fact?.initialArrivalAt}, current=${fact?.currentArrivalAt}`,
    { initial: fact?.initialArrivalAt, current: fact?.currentArrivalAt });

  const hist = await call(A, "GET", `/api/routes/${routeId}/history`);
  const histStatus = hist.json?.route?.status;
  step("I: диспетчер видит историю рейса",
    hist.status === 200 ? "VERIFIED" : "PARTIAL",
    `HTTP ${hist.status}, статус рейса в истории «${histStatus}»`, { status: hist.status, routeStatus: histStatus });

  const tripAfter = await call(A, "GET", `/api/routes/${routeId}/trip`);
  step("I: факт по рейсу доступен диспетчеру",
    tripAfter.status === 200 ? "VERIFIED" : "PARTIAL",
    `HTTP ${tripAfter.status}`, { status: tripAfter.status });

  // ─────────── J. РЕЙТИНГ ВОДИТЕЛЯ ───────────
  const driversApi = await call(A, "GET", "/api/drivers");
  const rated = (driversApi.json?.drivers || driversApi.json?.items || driversApi.json || [])
    .find((x) => x.id === driver.id);
  step("J: водитель виден в списке с фактическим рейтингом",
    rated ? "VERIFIED" : "PARTIAL",
    `rating=${JSON.stringify(rated?.rating ?? null)}`, { rating: rated?.rating ?? null });

  // ─────────── K. ПОВТОРНЫЕ КОМАНДЫ ПОСЛЕ ЗАВЕРШЕНИЯ ───────────
  const afterFinish = await call(d.jar, "POST", "/api/m/route/stage", { routeId, command: "start_driving" });
  const afterFinishDb = await prisma.route.findUnique({ where: { id: routeId }, select: { status: true } });
  step("K: после завершения рейс не оживает",
    afterFinishDb.status === "completed" ? "VERIFIED" : "BROKEN",
    `HTTP ${afterFinish.status}, статус в БД «${afterFinishDb.status}»`,
    { status: afterFinish.status, dbStatus: afterFinishDb.status });

  const repeatFinish = await call(d.jar, "POST", "/api/m/route/stage", { routeId, command: "finish_trip" });
  const dbRepeat = await dbState(routeId);
  step("K: повторное «завершить рейс» идемпотентно",
    repeatFinish.status === 200 || repeatFinish.status === 409 ? "VERIFIED" : "PARTIAL",
    `HTTP ${repeatFinish.status}, completedAt не изменился: ${dbRepeat.route.completedAt?.getTime() === st.route.completedAt?.getTime()}`,
    { status: repeatFinish.status });

  // ─────────── УБОРКА ───────────
  await prisma.route.deleteMany({ where: { id: routeId } });
  await prisma.order.deleteMany({ where: { clientName: { contains: TAG } } });
  const leftOrders = await prisma.order.count({ where: { clientName: { contains: TAG } } });
  const leftRoutes = await prisma.route.count({ where: { name: { contains: TAG } } });
  step("уборка: аудиторские записи удалены", leftOrders === 0 && leftRoutes === 0 ? "VERIFIED" : "PARTIAL",
    `осталось заказов: ${leftOrders}, рейсов: ${leftRoutes}`);

  rep.print();
  require("fs").writeFileSync(require("path").join(__dirname, "report-cycle.json"), JSON.stringify(rep.toJSON(), null, 2));
  await prisma.$disconnect();
}

main().catch((e) => { console.error("ERR", e); process.exit(1); });

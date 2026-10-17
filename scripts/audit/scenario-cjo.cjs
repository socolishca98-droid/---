// C–J, L, O: заказ → рейс → назначение → маршрут → выполнение → факт → деньги → отказы.
// Создаёт только записи с пометкой "аудит" и удаляет их в конце.
const { ENV, Jar, csrf, login, call, Report } = require("./lib.cjs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const rep = new Report("C–J/L/O — основной бизнес-процесс");
const TAG = `АУДИТ-${Date.now().toString(36).toUpperCase()}`;

async function main() {
  const admin = await login(ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD);
  if (admin.status !== 200) { rep.step("C", "вход админа", "BROKEN", `HTTP ${admin.status}`); rep.print(); return; }
  const A = admin.jar;

  const drivers = await prisma.driver.findMany({
    where: { organizationId: (await orgId(A)) }, select: { id: true, name: true, phone: true }, take: 3,
  });
  const vehicles = await prisma.vehicle.findMany({
    where: { organizationId: (await orgId(A)) }, select: { id: true, plate: true }, take: 3,
  });
  const driver = drivers[0];
  const vehicle = vehicles[0];

  // ===== C. ЗАКАЗ: CRUD И ОТМЕНА =====
  const created = [];
  const orderBodies = [
    { routeFrom: "Москва, ул. Тверская, 1", routeTo: "Санкт-Петербург, Невский пр., 1", weight: 5, price: 30000, cargoType: "Палеты", clientName: `${TAG} Клиент 1` },
    { routeFrom: "Санкт-Петербург, Невский пр., 1", routeTo: "Тверь, ул. Советская, 5", weight: 3, price: 22000, cargoType: "Палеты", clientName: `${TAG} Клиент 2` },
  ];
  for (const body of orderBodies) {
    const r = await call(A, "POST", "/api/orders", body);
    if (r.status === 200 || r.status === 201) {
      const o = r.json?.order || r.json;
      created.push(o);
      rep.step("C", `создание заказа ${body.routeFrom} → ${body.routeTo}`,
        o?.id ? "VERIFIED" : "BROKEN", `HTTP ${r.status}, id: ${o?.id}`, { id: o?.id });
    } else {
      rep.step("C", "создание заказа", "BROKEN", `HTTP ${r.status} ${r.json?.error || ""}`.trim(),
        { status: r.status, error: r.json?.error });
    }
  }
  rep.step("C", "заказы создаются", created.length === 2 ? "VERIFIED" : "BROKEN",
    `создано: ${created.length} из 2`);

  if (created[0]) {
    const upd = await call(A, "PATCH", `/api/orders/${created[0].id}`, { price: 31000 });
    rep.step("C", "изменение заказа", upd.status === 200 ? "VERIFIED" : "BROKEN",
      `HTTP ${upd.status} ${upd.json?.error || ""}`.trim(), { status: upd.status });
  }

  // Отмена проверяется на отдельном заказе: отменённый заказ нельзя согласовать,
  // поэтому основные два должны дойти до рейса.
  const toCancel = await call(A, "POST", "/api/orders", {
    routeFrom: "Казань, ул. Баумана, 1", routeTo: "Нижний Новгород, ул. Большая Покровская, 1",
    weight: 2, price: 15000, cargoType: "Палеты", clientName: `${TAG} Отмена`,
  });
  const cancelId = (toCancel.json?.order || toCancel.json)?.id;
  const cancel = cancelId ? await call(A, "PATCH", `/api/orders/${cancelId}`, { status: "cancelled" }) : { status: 0, json: {} };
  rep.step("C", "отмена заказа", cancel.status === 200 ? "VERIFIED" : "BROKEN",
    `HTTP ${cancel.status} ${cancel.json?.error || ""}`.trim(), { status: cancel.status });
  if (cancelId) {
    const after = await call(A, "GET", `/api/orders/${cancelId}`);
    rep.step("C", "отменённый заказ сохраняет статус",
      (after.json?.order?.status || after.json?.status) === "cancelled" ? "VERIFIED" : "PARTIAL",
      `статус: ${after.json?.order?.status || after.json?.status}`);
    // и обратно его не согласовать
    const back = await call(A, "PATCH", `/api/orders/${cancelId}`, { status: "agreed" });
    rep.step("C", "отменённый заказ нельзя снова согласовать",
      back.status === 400 ? "VERIFIED" : "BROKEN",
      `HTTP ${back.status} ${back.json?.error || ""}`.trim(), { status: back.status });
    created.push({ id: cancelId });
  }

  // ===== D/E. РЕЙС, ВОДИТЕЛЬ, АВТО =====
  // Заказ попадает в рейс только в статусе «Согласован» — это бизнес-правило,
  // поэтому аудит тоже идёт каноническим путём: создан → согласован → в рейс.
  const free = [];
  for (const o of created) {
    if (!o?.id) continue;
    const agree = await call(A, "PATCH", `/api/orders/${o.id}`, { status: "agreed" });
    rep.step("D", `согласование заказа ${o.routeFrom} → ${o.routeTo}`,
      agree.status === 200 ? "VERIFIED" : "BROKEN",
      `HTTP ${agree.status} ${agree.json?.error || ""}`.trim(), { status: agree.status });
    if (agree.status === 200) free.push(o);
  }
  const routeRes = await call(A, "POST", "/api/routes", {
    name: `${TAG} рейс`, driverId: driver?.id, vehicleId: vehicle?.id,
    orderIds: free.map((o) => o.id),
  });
  const route = routeRes.json?.route || routeRes.json;
  rep.step("D", "создание рейса с заказами",
    (routeRes.status === 200 || routeRes.status === 201) && route?.id ? "VERIFIED" : "BROKEN",
    `HTTP ${routeRes.status} ${routeRes.json?.error || ""}`.trim(), { status: routeRes.status, id: route?.id });
  rep.step("E", "водитель и машина назначены рейсу",
    route?.driverId && route?.vehicleId ? "VERIFIED" : "BROKEN",
    `driver: ${route?.driverId ? "есть" : "НЕТ"}, vehicle: ${route?.vehicleId ? "есть" : "НЕТ"}`);

  if (route?.id) {
    const list = await call(A, "GET", "/api/routes");
    const arr = list.json?.routes || list.json?.items || [];
    const found = Array.isArray(arr) && arr.some((r) => r.id === route.id);
    rep.step("D", "рейс виден в списке", found ? "VERIFIED" : "BROKEN", `HTTP ${list.status}, рейсов: ${Array.isArray(arr) ? arr.length : "?"}`);

    const one = await call(A, "GET", `/api/routes/${route.id}`);
    const orders = one.json?.route?.orders || one.json?.orders || [];
    rep.step("D", "заказы привязаны к рейсу",
      Array.isArray(orders) && orders.length > 0 ? "VERIFIED" : "PARTIAL",
      `заказов в рейсе: ${Array.isArray(orders) ? orders.length : "?"}`);

    // ===== F. МАРШРУТ: ETA И ОПТИМИЗАЦИЯ =====
    const eta = await call(A, "POST", "/api/routes/calculate-eta", Object.assign({
      origin: { lat: 55.7558, lng: 37.6173 },
      destination: { lat: 59.9343, lng: 30.3351 },
      departureTime: new Date(Date.now() + 3600_000).toISOString(),
    }), { timeoutMs: 90000 });
    rep.step("F", "расчёт ЕТА по рейсу", eta.status === 200 ? "VERIFIED" : "BROKEN",
      `HTTP ${eta.status} ${eta.json?.error || ""}`.trim(),
      { status: eta.status, routing: eta.json?.sources?.routing, totalSec: eta.json?.totalSec, confidence: eta.json?.confidence?.score });

    const opt = await call(A, "POST", "/api/routes/optimizer", { orderIds: free.map((o) => o.id) }, { timeoutMs: 90000 });
    rep.step("F", "оптимизатор маршрута", opt.status === 200 ? "VERIFIED" : opt.status === 0 ? "NOT_TESTED" : "BROKEN",
      `HTTP ${opt.status} ${opt.json?.error || ""}`.trim(),
      { status: opt.status, etaMin: opt.json?.etaMin, fuelRub: opt.json?.fuelRub });

    const events = await call(A, "GET", `/api/routes/${route.id}/events`);
    rep.step("K", "история событий рейса", events.status === 200 ? "VERIFIED" : "BROKEN", `HTTP ${events.status}`);

    const docs = await call(A, "GET", `/api/routes/${route.id}/documents`);
    rep.step("K", "документы рейса", docs.status === 200 ? "VERIFIED" : "PARTIAL",
      `HTTP ${docs.status} ${docs.json?.error || ""}`.trim(), { status: docs.status });

    const hist = await call(A, "GET", `/api/routes/${route.id}/history`);
    rep.step("K", "история изменений рейса", hist.status === 200 ? "VERIFIED" : "PARTIAL",
      `HTTP ${hist.status} ${hist.json?.error || ""}`.trim(), { status: hist.status });
  }

  // ===== L. ДЕНЬГИ =====
  const stats = await call(A, "GET", "/api/dashboard/stats");
  rep.step("L", "сводка компании", stats.status === 200 ? "VERIFIED" : "BROKEN", `HTTP ${stats.status}`);
  const pay = await call(A, "GET", "/api/payments");
  rep.step("L", "оплаты по заказам", pay.status === 200 ? "VERIFIED" : "BROKEN",
    `HTTP ${pay.status} ${pay.json?.error || ""}`.trim(), { status: pay.status });
  const rep1 = await call(A, "GET", "/api/reports");
  rep.step("L", "отчёты", rep1.status === 200 ? "VERIFIED" : "BROKEN", `HTTP ${rep1.status}`);
  const fuel = await call(A, "GET", "/api/fuel");
  rep.step("L", "топливо", fuel.status === 200 ? "VERIFIED" : "BROKEN", `HTTP ${fuel.status}`);
  const exp = route?.id ? await call(A, "GET", `/api/routes/${route.id}/expenses`) : { status: 0, json: {} };
  rep.step("L", "расходы рейса", exp.status === 200 || exp.status === 404 ? "PARTIAL" : "BROKEN",
    `HTTP ${exp.status} ${exp.json?.error || ""}`.trim(), { status: exp.status });

  // ===== M. ТАРИФЫ =====
  const tariff = await call(A, "GET", "/api/organization");
  const keys = tariff.json ? Object.keys(tariff.json.organization || tariff.json) : [];
  const hasPlan = keys.some((k) => /plan|tariff|subscription|quota|billing/i.test(k));
  rep.step("M", "тариф/подписка организации", hasPlan ? "VERIFIED" : "MISSING",
    hasPlan ? `поля: ${keys.filter((k) => /plan|tariff|subscription|quota|billing/i.test(k)).join(",")}`
            : "в ответе /api/organization нет полей тарифа, подписки, квоты или биллинга",
    { keys });

  // ===== O. ОТКАЗЫ ВНЕШНИХ API =====
  // Отказ геокодера: рейс с заведомо несуществующим адресом. Прогноз обязан
  // честно сказать allLegsGeocoded=false и назвать адрес, а не показать 0 км.
  const bogusRoute = await call(A, "POST", "/api/routes", {
    name: `${TAG} битый адрес`,
    orders: [{ routeFrom: "Москва, ул. Тверская, 1", routeTo: "ЗЗЗ-несуществующий-адрес-9999", price: 10000 }],
  }, { timeoutMs: 90000 });
  const bogusId = (bogusRoute.json?.route || bogusRoute.json)?.id;
  let etaBogus = { status: 0, json: {} };
  if (bogusId) {
    etaBogus = await call(A, "GET", `/api/routes/${bogusId}/trip`, undefined, { timeoutMs: 90000 });
    const okBogus = etaBogus.status === 200 && etaBogus.json?.allLegsGeocoded === false;
    const named = JSON.stringify(etaBogus.json?.warnings || "").includes("ЗЗЗ") ||
                  JSON.stringify(etaBogus.json?.unlocatedOrders || []).length > 0;
    rep.step("O", "отказ геокодера виден в прогнозе",
      okBogus && named ? "VERIFIED" : okBogus ? "PARTIAL" : "BROKEN",
      `HTTP ${etaBogus.status}, allLegsGeocoded=${etaBogus.json?.allLegsGeocoded}, адрес назван: ${named}`,
      { status: etaBogus.status, allLegsGeocoded: etaBogus.json?.allLegsGeocoded, named,
        warnings: etaBogus.json?.warnings, unlocated: etaBogus.json?.unlocatedOrders });
  } else {
    rep.step("O", "отказ геокодера виден в прогнозе", "NOT_TESTED",
      `рейс с битым адресом не создан: HTTP ${bogusRoute.status} ${bogusRoute.json?.error || ""}`.trim());
  }

  // Полный отказ внешней географии: прогноз обязан остаться ответом, а не 500.
  const bogusOrder = await call(A, "POST", "/api/orders", {
    routeFrom: "ЗЗЗ-несуществующий-адрес-1111", routeTo: "QQQQ-тоже-нет-2222", price: 5000,
    clientName: `${TAG} Битый`,
  });
  const bogusOrderId = (bogusOrder.json?.order || bogusOrder.json)?.id;
  if (bogusOrderId) {
    const agree = await call(A, "PATCH", `/api/orders/${bogusOrderId}`, { status: "agreed" });
    if (agree.status === 200) {
      const r2 = await call(A, "POST", "/api/routes", {
        name: `${TAG} оба адреса битые`, orderIds: [bogusOrderId],
      }, { timeoutMs: 90000 });
      const r2id = (r2.json?.route || r2.json)?.id;
      if (r2id) {
        const t = await call(A, "GET", `/api/routes/${r2id}/trip`, undefined, { timeoutMs: 90000 });
        rep.step("O", "оба адреса негеокодируемы — прогноз отвечает, а не падает",
          t.status === 200 ? "VERIFIED" : "BROKEN",
          `HTTP ${t.status} ${t.json?.error || ""}`.trim(),
          { status: t.status, allLegsGeocoded: t.json?.allLegsGeocoded, totalSec: t.json?.totalSec });
        await prisma.route.deleteMany({ where: { id: r2id } });
      }
      await prisma.order.deleteMany({ where: { id: bogusOrderId } });
    }
  }
  if (bogusId) await prisma.route.deleteMany({ where: { id: bogusId } });

  const health = await call(new Jar(), "GET", "/api/health");
  rep.step("O", "проверка здоровья отвечает", health.status === 200 ? "VERIFIED" : "PARTIAL",
    `HTTP ${health.status}`, { status: health.status, body: health.json });

  const traffic = await call(A, "GET", "/api/traffic/info");
  rep.step("O", "пробки: признак источника, а не молчаливый отказ",
    traffic.status === 200 || traffic.status === 404 ? "PARTIAL" : "BROKEN",
    `HTTP ${traffic.status} ${traffic.json?.error || ""}`.trim(),
    { status: traffic.status, provider: ENV.TRAFFIC_PROVIDER });

  // уборка: удаляем то, что создали аудитом
  for (const o of created) {
    if (o?.id) await prisma.order.deleteMany({ where: { id: o.id } });
  }
  if (route?.id) await prisma.route.deleteMany({ where: { id: route.id } });
  const left = await prisma.order.count({ where: { clientName: { contains: TAG } } });
  rep.step("O", "уборка аудиторских записей", left === 0 ? "VERIFIED" : "PARTIAL",
    `осталось заказов аудита: ${left}`);

  rep.print();
  require("fs").writeFileSync(require("path").join(__dirname, "report-cjo.json"), JSON.stringify(rep.toJSON(), null, 2));
  await prisma.$disconnect();
}

async function orgId(jar) {
  const r = await call(jar, "GET", "/api/organization");
  return r.json?.organization?.id || r.json?.id;
}

main().catch((e) => { console.error("ERR", e); process.exit(1); });

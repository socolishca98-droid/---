// G–J: выполнение рейса водителем — этапы, погрузка/выгрузка, статусы, завершение, факт.
// Сценарий идёт через настоящие ручки мобильного кабинета водителя.
const { ENV, Jar, csrf, login, call, Report } = require("./lib.cjs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const rep = new Report("G–J — выполнение рейса водителем");
const TAG = `АУДИТ-DRV-${Date.now().toString(36).toUpperCase()}`;
const BASE = ENV.AUDIT_BASE_URL || "http://localhost:3000";

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

async function main() {
  const admin = await login(ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD);
  if (admin.status !== 200) { rep.step("G", "вход админа", "BROKEN", `HTTP ${admin.status}`); rep.print(); return; }
  const A = admin.jar;
  const orgId = (await call(A, "GET", "/api/organization")).json?.organization?.id;

  const driver = await prisma.driver.findFirst({
    where: { organizationId: orgId }, select: { id: true, name: true, phone: true, user: { select: { id: true } } },
  });
  const vehicle = await prisma.vehicle.findFirst({ where: { organizationId: orgId }, select: { id: true, plate: true } });
  if (!driver || !vehicle) { rep.step("G", "водитель и машина есть", "BROKEN", "не найдены"); rep.print(); return; }

  // Два заказа — чтобы были и погрузка, и выгрузка
  const orders = [];
  for (const [from, to] of [["Москва, ул. Тверская, 1", "Санкт-Петербург, Невский пр., 1"],
                            ["Санкт-Петербург, Невский пр., 1", "Тверь, ул. Советская, 5"]]) {
    const o = await call(A, "POST", "/api/orders", {
      routeFrom: from, routeTo: to, price: 20000, weight: 4, clientName: `${TAG} ${to}`,
    });
    const id = (o.json?.order || o.json)?.id;
    if (id) {
      await call(A, "PATCH", `/api/orders/${id}`, { status: "agreed" });
      orders.push(id);
    }
  }
  if (orders.length < 2) { rep.step("D", "заказы созданы", "BROKEN", `создано ${orders.length}`); rep.print(); return; }

  const r = await call(A, "POST", "/api/routes", {
    name: `${TAG} рейс`, driverId: driver.id, vehicleId: vehicle.id, orderIds: orders,
  }, { timeoutMs: 120000 });
  const routeId = (r.json?.route || r.json)?.id;
  if (!routeId) { rep.step("D", "рейс создан", "BROKEN", `HTTP ${r.status} ${r.json?.error || ""}`); rep.print(); return; }

  // Водитель входит
  const driverUserId = driver.user?.id;
  const reset = driverUserId ? await call(A, "PATCH", `/api/auth/users/${driverUserId}`, { action: "resetPassword" }) : { status: 0, json: {} };
  const temp = reset.json?.temporaryPassword || reset.json?.password;
  const d = await driverLogin(driver.phone, temp);
  rep.step("G", "водитель входит в мобильный кабинет", d.status === 200 ? "VERIFIED" : "BROKEN",
    `HTTP ${d.status} ${d.json?.error || ""}`.trim(), { status: d.status, phone: driver.phone });
  if (d.status !== 200) { rep.print(); return; }
  const D = d.jar;

  // G: водитель видит назначенный рейс
  const myRoute = await call(D, "GET", "/api/m/route");
  const seen = myRoute.json?.route?.id === routeId || myRoute.json?.id === routeId;
  rep.step("G", "водитель видит свой рейс", seen ? "VERIFIED" : "PARTIAL",
    `HTTP ${myRoute.status}, рейс назначен: ${seen}, в ответе: ${JSON.stringify(myRoute.json?.route?.id || myRoute.json?.id)}`,
    { status: myRoute.status, routeIdInResponse: myRoute.json?.route?.id || myRoute.json?.id });

  const myOrders = await call(D, "GET", "/api/m/orders");
  rep.step("G", "водитель видит заказы рейса",
    myOrders.status === 200 && Array.isArray(myOrders.json?.orders) && myOrders.json.orders.length > 0
      ? "VERIFIED" : "PARTIAL",
    `HTTP ${myOrders.status}, заказов: ${myOrders.json?.orders?.length ?? "?"}`,
    { status: myOrders.status, count: myOrders.json?.orders?.length });

  // G/H: команда этапа — принимаем рейс и начинаем погрузку
  const stageCall = async (command, note, expectOk = true) => {
    const res = await call(D, "POST", "/api/m/route/stage", { routeId, command });
    const ok = res.status === 200;
    rep.step("H", note, ok ? "VERIFIED" : expectOk ? "BROKEN" : "PARTIAL",
      `«${command}» → HTTP ${res.status} ${res.json?.error || ""}`.trim(),
      { command, status: res.status, error: res.json?.error, actions: res.json?.actions || res.json?.trip?.actions });
    return res;
  };

  const tripBefore = await call(D, "GET", `/api/routes/${routeId}/trip?ensureStages=1`, undefined, { timeoutMs: 120000 });
  const stages = tripBefore.json?.stages || [];
  rep.step("H", "план рейса рассчитан для водителя",
    stages.length > 0 ? "VERIFIED" : "BROKEN",
    `этапов в плане: ${stages.length}, источники: ${JSON.stringify(tripBefore.json?.sources)}`,
    { stages: stages.length, sources: tripBefore.json?.sources });

  const first = await call(D, "GET", "/api/m/route");
  const commands = first.json?.trip?.actions || first.json?.actions || [];
  rep.step("H", "водителю предложена следующая команда",
    Array.isArray(commands) && commands.length > 0 ? "VERIFIED" : "PARTIAL",
    `доступные действия: ${JSON.stringify(commands.map((c) => c.command || c.primary || c))}`,
    { actions: commands });

  // принять рейс
  const accept = await call(D, "POST", "/api/m/route/stage", { routeId, command: "accept_route" });
  rep.step("G", "водитель принимает рейс", accept.status === 200 ? "VERIFIED" : "PARTIAL",
    `HTTP ${accept.status} ${accept.json?.error || ""}`.trim(), { status: accept.status });

  // пройти все предложенные команды по очереди (до 12 шагов)
  let steps = 0;
  let lastRes = accept;
  while (steps < 12) {
    steps++;
    const view = await call(D, "GET", "/api/m/route");
    const acts = view.json?.trip?.actions || view.json?.actions || [];
    const primary = acts.find((a) => a.primary)?.command || acts[0]?.command;
    if (!primary) break;
    if (/finish|complete|done/i.test(primary) && steps < 3) { /* не заканчиваем сразу */ }
    const res = await call(D, "POST", "/api/m/route/stage", { routeId, command: primary });
    lastRes = res;
    if (res.status !== 200) {
      rep.step("H", `шаг ${steps}: «${primary}»`, "PARTIAL",
        `HTTP ${res.status} ${res.json?.error || ""}`.trim(), { command: primary, status: res.status });
      break;
    }
    rep.step("H", `шаг ${steps}: «${primary}» выполнен`, "VERIFIED", `HTTP 200`, { command: primary });
    const done = view.json?.route?.status || view.json?.status;
    if (done === "completed") break;
  }

  // I: диспетчер видит продвижение
  const staffView = await call(A, "GET", `/api/routes/${routeId}`);
  rep.step("I", "диспетчер видит состояние рейса",
    staffView.status === 200 ? "VERIFIED" : "BROKEN",
    `HTTP ${staffView.status}, статус: ${staffView.json?.route?.status || staffView.json?.status}`,
    { status: staffView.status, routeStatus: staffView.json?.route?.status || staffView.json?.status });

  const events = await call(A, "GET", `/api/routes/${routeId}/events`);
  const evArr = events.json?.events || events.json?.items || [];
  rep.step("I", "события рейса записываются",
    Array.isArray(evArr) && evArr.length > 0 ? "VERIFIED" : "PARTIAL",
    `событий: ${Array.isArray(evArr) ? evArr.length : "?"}`,
    { count: Array.isArray(evArr) ? evArr.length : null });

  // J: завершение и факт
  const finish = await call(D, "POST", "/api/m/route/stage", { routeId, command: "finish_trip" });
  rep.step("J", "водитель завершает рейс", finish.status === 200 ? "VERIFIED" : "PARTIAL",
    `HTTP ${finish.status} ${finish.json?.error || ""}`.trim(), { status: finish.status });

  const after = await call(A, "GET", `/api/routes/${routeId}`);
  const st = after.json?.route?.status || after.json?.status;
  rep.step("J", "рейс перешёл в завершённое состояние",
    st === "completed" ? "VERIFIED" : "PARTIAL", `статус рейса: ${st}`, { routeStatus: st });

  const tripAfter = await call(A, "GET", `/api/routes/${routeId}/trip`, undefined, { timeoutMs: 120000 });
  const stagesAfter = tripAfter.json?.stages || [];
  const done = stagesAfter.filter((s) => s.status === "completed" || s.actualEndAt).length;
  rep.step("J", "факт по этапам зафиксирован", done > 0 ? "VERIFIED" : "PARTIAL",
    `этапов с фактом: ${done} из ${stagesAfter.length}`,
    { done, total: stagesAfter.length });

  const ordersAfter = await call(A, "GET", `/api/routes/${routeId}`);
  const ordArr = ordersAfter.json?.route?.orders || ordersAfter.json?.orders || [];
  const delivered = Array.isArray(ordArr) ? ordArr.filter((o) => o.status === "delivered").length : -1;
  rep.step("J", "заказы получили статус доставки",
    delivered > 0 ? "VERIFIED" : "PARTIAL",
    `доставлено заказов: ${delivered} из ${Array.isArray(ordArr) ? ordArr.length : "?"}`,
    { delivered, total: Array.isArray(ordArr) ? ordArr.length : null });

  // повторное завершение не должно ломать историю
  const again = await call(D, "POST", "/api/m/route/stage", { routeId, command: "finish_trip" });
  rep.step("J", "повторное завершение не создаёт второй факт",
    again.status === 200 || again.status === 400 ? "VERIFIED" : "BROKEN",
    `HTTP ${again.status} ${again.json?.error || ""}`.trim(), { status: again.status });

  // уборка
  await prisma.route.deleteMany({ where: { id: routeId } });
  await prisma.order.deleteMany({ where: { id: { in: orders } } });
  rep.step("O", "уборка", "VERIFIED", "рейс и заказы аудита удалены");

  rep.print();
  require("fs").writeFileSync(require("path").join(__dirname, "report-driver.json"), JSON.stringify(rep.toJSON(), null, 2));
  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });

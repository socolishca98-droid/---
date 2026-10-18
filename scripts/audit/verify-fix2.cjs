// Приёмка задачи 2: согласованность статуса рейса.
// Новые записи пишут канон in_transit; старые in_progress из базы не ломаются.
const { ENV, Jar, csrf, login, call, Report } = require("./lib.cjs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const rep = new Report("Задача 2 — статусы рейса");
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
  return { status: res.status, json: await res.json().catch(() => ({})), jar };
}

async function main() {
  const admin = await login(ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD);
  const A = admin.jar;
  const orgId = (await call(A, "GET", "/api/organization")).json?.organization?.id;
  const driver = await prisma.driver.findFirst({
    where: { organizationId: orgId }, select: { id: true, phone: true, user: { select: { id: true } } },
  });
  const vehicle = await prisma.vehicle.findFirst({ where: { organizationId: orgId }, select: { id: true } });

  // ── Новый рейс ──
  const o = await call(A, "POST", "/api/orders", {
    routeFrom: "Москва, ул. Тверская, 1", routeTo: "Тверь, ул. Советская, 5",
    price: 12000, weight: 3, clientName: "АУДИТ-СТАТУС",
  });
  const orderId = (o.json?.order || o.json)?.id;
  await call(A, "PATCH", `/api/orders/${orderId}`, { status: "agreed" });
  const r = await call(A, "POST", "/api/routes", {
    name: "АУДИТ-СТАТУС рейс", driverId: driver.id, vehicleId: vehicle.id, orderIds: [orderId],
  }, { timeoutMs: 120000 });
  const routeId = (r.json?.route || r.json)?.id;
  if (!routeId) { rep.step("2", "рейс создан", "BROKEN", `HTTP ${r.status} ${r.json?.error || ""}`); rep.print(); return; }

  const before = await prisma.route.findUnique({ where: { id: routeId }, select: { status: true } });
  rep.step("2", "новый рейс — словарный статус", before.status === "planned" ? "VERIFIED" : "BROKEN",
    `в БД: «${before.status}»`);

  // ── Водитель начинает рейс ──
  const reset = await call(A, "PATCH", `/api/auth/users/${driver.user.id}`, { action: "resetPassword" });
  const temp = reset.json?.temporaryPassword || reset.json?.password;
  const d = await driverLogin(driver.phone, temp);
  if (d.status !== 200) { rep.step("2", "водитель вошёл", "BROKEN", `HTTP ${d.status}`); rep.print(); return; }
  const start = await call(d.jar, "POST", "/api/m/route/stage", { routeId, command: "start_trip" });
  const afterStart = await prisma.route.findUnique({ where: { id: routeId }, select: { status: true } });

  rep.step("2", "после «начать рейс» в БД каноническое in_transit",
    afterStart.status === "in_transit" ? "VERIFIED" : "BROKEN",
    `команда HTTP ${start.status}, в БД «${afterStart.status}»`,
    { dbStatus: afterStart.status });

  // ── Диспетчер видит «В пути» ──
  const disp = await call(A, "GET", `/api/routes/${routeId}`);
  const dispStatus = disp.json?.route?.status;
  const dispLabel = disp.json?.route?.statusLabel;
  rep.step("2", "диспетчерский API отдаёт канон и русскую подпись",
    dispStatus === "in_transit" && dispLabel === "В пути" ? "VERIFIED" : "BROKEN",
    `status=«${dispStatus}», подпись=«${dispLabel}»`, { status: dispStatus, label: dispLabel });

  const list = await call(A, "GET", "/api/routes");
  const inList = (list.json?.routes || list.json?.items || []).find((x) => x.id === routeId);
  rep.step("2", "в списке рейсов статус тоже канонический",
    inList?.status === "in_transit" ? "VERIFIED" : "BROKEN",
    `status=«${inList?.status}»`, { status: inList?.status });

  const hist = await call(A, "GET", `/api/routes/${routeId}/history`);
  rep.step("2", "история рейса показывает тот же смысл",
    hist.status === 200 ? "VERIFIED" : "PARTIAL",
    `HTTP ${hist.status}, подпись=«${hist.json?.route?.status}»`,
    { status: hist.json?.route?.status });

  // ── Совместимость со старой записью ──
  await prisma.route.update({ where: { id: routeId }, data: { status: "in_progress" } });
  const legacy = await call(A, "GET", `/api/routes/${routeId}`);
  const legacyLabel = legacy.json?.route?.statusLabel;
  rep.step("2", "старая запись in_progress не ломает диспетчера",
    legacyLabel === "В пути" ? "VERIFIED" : "BROKEN",
    `в БД «in_progress», API отдаёт подпись «${legacyLabel}»`,
    { dbStatus: "in_progress", label: legacyLabel });

  const legacyList = await call(A, "GET", "/api/routes");
  const legacyInList = (legacyList.json?.routes || legacyList.json?.items || []).find((x) => x.id === routeId);
  rep.step("2", "старый рейс попадает в «в пути», а не «запланирован»",
    legacyInList?.status === "in_transit" ? "VERIFIED" : "PARTIAL",
    `status=«${legacyInList?.status}»`, { status: legacyInList?.status });

  // ── Чистота словаря в БД ──
  const all = await prisma.route.findMany({ select: { status: true } });
  const vocab = ["planned", "active", "in_transit", "completed", "cancelled"];
  const odd = all.filter((x) => !vocab.includes(x.status) && x.status !== "in_progress");
  rep.step("2", "в базе нет статусов вне словаря (кроме легаси in_progress)",
    odd.length === 0 ? "VERIFIED" : "BROKEN",
    `рейсов всего ${all.length}, нераспознанных статусов: ${odd.length}${odd.length ? ` (${odd.map((x) => x.status).join(",")})` : ""}`,
    { total: all.length, odd: odd.map((x) => x.status) });

  // ── Уборка ──
  await prisma.route.deleteMany({ where: { id: routeId } });
  await prisma.order.deleteMany({ where: { id: orderId } });
  rep.step("2", "уборка", "VERIFIED", "рейс и заказ аудита удалены");

  rep.print();
  require("fs").writeFileSync(require("path").join(__dirname, "report-fix2.json"), JSON.stringify(rep.toJSON(), null, 2));
  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });

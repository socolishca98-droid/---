// Доказательство: каким статусом помечается рейс в БД после команды водителя.
const { ENV, Jar, csrf, login, call, Report } = require("./lib.cjs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const rep = new Report("I — словарь статусов рейса");
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

const VOCAB = ["planned", "active", "in_transit", "completed", "cancelled"];

async function main() {
  const admin = await login(ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD);
  const A = admin.jar;
  const orgId = (await call(A, "GET", "/api/organization")).json?.organization?.id;
  const driver = await prisma.driver.findFirst({
    where: { organizationId: orgId }, select: { id: true, phone: true, user: { select: { id: true } } },
  });
  const vehicle = await prisma.vehicle.findFirst({ where: { organizationId: orgId }, select: { id: true } });
  const TAG = `АУДИТ-ST-${Date.now().toString(36).toUpperCase()}`;

  const o = await call(A, "POST", "/api/orders", {
    routeFrom: "Москва, ул. Тверская, 1", routeTo: "Тверь, ул. Советская, 5",
    price: 12000, weight: 3, clientName: TAG,
  });
  const orderId = (o.json?.order || o.json)?.id;
  await call(A, "PATCH", `/api/orders/${orderId}`, { status: "agreed" });
  const r = await call(A, "POST", "/api/routes", {
    name: `${TAG} рейс`, driverId: driver.id, vehicleId: vehicle.id, orderIds: [orderId],
  }, { timeoutMs: 120000 });
  const routeId = (r.json?.route || r.json)?.id;

  const reset = await call(A, "PATCH", `/api/auth/users/${driver.user.id}`, { action: "resetPassword" });
  const temp = reset.json?.temporaryPassword || reset.json?.password;
  const d = await driverLogin(driver.phone, temp);
  const D = d.jar;

  const before = await prisma.route.findUnique({ where: { id: routeId }, select: { status: true } });
  rep.step("I", "новый рейс — словарный статус", VOCAB.includes(before.status) ? "VERIFIED" : "BROKEN",
    `в БД: «${before.status}»`);

  const start = await call(D, "POST", "/api/m/route/stage", { routeId, command: "start_trip" });
  const afterStart = await prisma.route.findUnique({ where: { id: routeId }, select: { status: true, startedAt: true } });
  rep.step("I", "после «начать рейс» статус остаётся словарным",
    VOCAB.includes(afterStart.status) ? "VERIFIED" : "BROKEN",
    `команда HTTP ${start.status}, в БД статус «${afterStart.status}»` +
    (VOCAB.includes(afterStart.status) ? "" : ` — значения нет в словаре ${JSON.stringify(VOCAB)}`),
    { status: afterStart.status, inVocab: VOCAB.includes(afterStart.status) });

  const view = await call(A, "GET", `/api/routes/${routeId}`);
  const uiStatus = view.json?.route?.status;
  const label = view.json?.route?.statusLabel || view.json?.route?.status;
  rep.step("I", "диспетчер видит понятный статус",
    VOCAB.includes(uiStatus) ? "VERIFIED" : "BROKEN",
    `API отдаёт статус «${uiStatus}» (подпись: ${JSON.stringify(label)})`);

  // уборка
  await prisma.route.deleteMany({ where: { id: routeId } });
  await prisma.order.deleteMany({ where: { id: orderId } });
  rep.step("O", "уборка", "VERIFIED", "рейс и заказ аудита удалены");

  rep.print();
  require("fs").writeFileSync(require("path").join(__dirname, "report-vocab.json"), JSON.stringify(rep.toJSON(), null, 2));
  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });

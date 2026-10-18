// Приёмка задачи 3: reliable не должен быть true при allLegsGeocoded=false.
// Провалим геокодер настоящим несуществующим адресом и посмотрим ответ API.
const { ENV, Jar, csrf, login, call, Report } = require("./lib.cjs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const rep = new Report("Задача 3 — корректность ETA");
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
  const A = admin.jar;
  const orgId = (await call(A, "GET", "/api/organization")).json?.organization?.id;
  const driver = await prisma.driver.findFirst({
    where: { organizationId: orgId }, select: { id: true, phone: true, user: { select: { id: true } } },
  });
  const vehicle = await prisma.vehicle.findFirst({ where: { organizationId: orgId }, select: { id: true } });

  // Заказ с заведомо негеокодируемым адресом + рабочий
  const bad = await call(A, "POST", "/api/orders", {
    routeFrom: "Москва, Тверская", routeTo: "ЗЗЗ-несуществующий-город-12345, ул. Нету",
    price: 9000, weight: 1, clientName: "АУДИТ-ETA-СЛОМАН",
  });
  const badId = (bad.json?.order || bad.json)?.id;
  await call(A, "PATCH", `/api/orders/${badId}`, { status: "agreed" });

  const good = await call(A, "POST", "/api/orders", {
    routeFrom: "Москва, Тверская", routeTo: "Тверь, Советская, 5",
    price: 9000, weight: 1, clientName: "АУДИТ-ETA-РАБОЧИЙ",
  });
  const goodId = (good.json?.order || good.json)?.id;
  await call(A, "PATCH", `/api/orders/${goodId}`, { status: "agreed" });

  const r = await call(A, "POST", "/api/routes", {
    name: "АУДИТ-ETA рейс", driverId: driver.id, vehicleId: vehicle.id,
    orderIds: [badId, goodId],
  }, { timeoutMs: 120000 });
  const routeId = (r.json?.route || r.json)?.id;
  if (!routeId) { rep.step("3", "рейс создан", "BROKEN", `HTTP ${r.status} ${r.json?.error || ""}`); rep.print(); return; }

  const reset = await call(A, "PATCH", `/api/auth/users/${driver.user.id}`, { action: "resetPassword" });
  const temp = reset.json?.temporaryPassword || reset.json?.password;
  const d = await driverLogin(driver.phone, temp);
  await call(d.jar, "POST", "/api/m/route/stage", { routeId, command: "start_trip" });

  // ── Пульт рейса водителя: главный потребитель ETA ──
  // Это staff-эндпоинт (requireStaffAuth): водительский пульт берёт
  // ETA с другого входа. Сначала проверяем диспетчерский,
  // затем сверяем, что водительский отдаёт тот же вердикт.
  const trip = await call(A, "GET", `/api/routes/${routeId}/trip`);
  if (process.env.DUMP) {
    console.log("TRIP HTTP", trip.status);
    console.log(JSON.stringify(trip.json).slice(0, 3000));
  }
  // /api/routes/[id]/trip отвечает ПЛОСКИМ объектом: поля надёжности лежат
  // на верхнем уровне, а не под trip/eta — так ответ конструирует сам роут.
  const eta = trip.json;
  const reliable = eta?.reliable;
  const note = eta?.reliabilityNote;
  const quality = eta?.dataQuality;

  rep.step("3", "allLegsGeocoded=false при отказе геокодера",
    quality?.allLegsGeocoded === false ? "VERIFIED" : "PARTIAL",
    `allLegsGeocoded=${quality?.allLegsGeocoded}, предупреждений ${quality?.warnings?.length ?? "?"}`,
    { allLegsGeocoded: quality?.allLegsGeocoded, warnings: quality?.warnings });

  rep.step("3", "reliable=false, а не true",
    reliable === false ? "VERIFIED" : "BROKEN",
    `reliable=${reliable}`, { reliable });

  rep.step("3", "ограничение названо словами, а не спрятано",
    typeof note === "string" && note.length > 10 ? "VERIFIED" : "BROKEN",
    `reliabilityNote=«${note}»`, { reliabilityNote: note });

  rep.step("3", "адрес негеокодированного заказа назван в предупреждении",
    (quality?.warnings || []).some((w) => String(w).includes("ЗЗЗ"))
      ? "VERIFIED" : "PARTIAL",
    `предупреждения: ${(quality?.warnings || []).join(" | ")}`, { warnings: quality?.warnings });

  // ── Прогноз API (та же задача, другой вход) ──
  // POST с телом: роут ждёт departureAt + routeId и отвечает ПЛОСКИМ объектом
  // (reliable на верхнем уровне, не внутри trip).
  const fc = await call(A, "POST", "/api/eta/forecast", {
    routeId,
    departureAt: new Date().toISOString(),
    save: false,
  });
  const fcReliable = fc.json?.reliable;
  rep.step("3", "прогнозный API тоже честен",
    fcReliable === false ? "VERIFIED" : "PARTIAL",
    `HTTP ${fc.status}, reliable=${fcReliable}`, { status: fc.status, reliable: fcReliable });

  // ── Водительский пульт рейса (/m) ──
  const mRoute = await call(d.jar, "GET", "/api/m/route");
  if (process.env.DUMP) console.log("M/ROUTE:", JSON.stringify(mRoute.json).slice(0, 1500));
  const mItem = (mRoute.json?.routes || mRoute.json?.items || mRoute.json || []).find?.((x) => x.id === routeId || x.routeId === routeId);
  const mTrip = mRoute.json?.trip;
  const mReliable = mTrip?.reliable;
  const mQuality = mTrip?.dataQuality;
  rep.step("3", "водительский пульт получает тот же вердикт",
    mReliable === false ? "VERIFIED" : "PARTIAL",
    `HTTP ${mRoute.status}, trip.reliable=${mReliable}, предупреждений ${mQuality?.length ?? "?"}`,
    { reliable: mReliable, dataQuality: mQuality, note: mRoute.json?.trip?.reliabilityNote });

  // ── Дашборд диспетчера ──
  const dash = await call(A, "GET", "/api/dashboard/routes");
  if (process.env.DUMP) console.log("DASH IDS:", JSON.stringify((dash.json?.routes||[]).map(x=>({id:x.id,st:x.status,rel:x.reliable,dq:x.dataQuality?.length}))));
  // Поля надёжности лежат внутри вложенного trip, не на корне маршрута
  const dashRoute = (dash.json?.routes || []).find((x) => x.id === routeId);
  rep.step("3", "диспетчерский дашборд получает тот же вердикт",
    dashRoute?.trip?.reliable === false ? "VERIFIED" : "PARTIAL",
    `trip.reliable=${dashRoute?.trip?.reliable}`, { reliable: dashRoute?.trip?.reliable });

  // ── Уборка ──
  await prisma.route.deleteMany({ where: { id: routeId } });
  await prisma.order.deleteMany({ where: { id: { in: [badId, goodId] } } });
  rep.step("3", "уборка", "VERIFIED", "рейс и заказы аудита удалены");

  rep.print();
  require("fs").writeFileSync(require("path").join(__dirname, "report-fix3.json"), JSON.stringify(rep.toJSON(), null, 2));
  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });

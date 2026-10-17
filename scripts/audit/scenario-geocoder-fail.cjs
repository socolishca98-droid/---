// O: поведение при отказе геокодера — что именно видит диспетчер в прогнозе.
const { ENV, Jar, csrf, login, call, Report } = require("./lib.cjs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const rep = new Report("O — отказ геокодера в прогнозе рейса");

async function main() {
  const admin = await login(ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD);
  if (admin.status !== 200) { rep.step("O", "вход", "BROKEN", `HTTP ${admin.status}`); rep.print(); return; }
  const A = admin.jar;
  const TAG = `АУДИТ-GEO-${Date.now().toString(36).toUpperCase()}`;

  // Заказ с заведомо несуществующим адресом назначения
  const o = await call(A, "POST", "/api/orders", {
    routeFrom: "Москва, ул. Тверская, 1",
    routeTo: "ЗЗЗ-несуществующий-адрес-777",
    price: 10000, weight: 1, clientName: TAG,
  });
  const orderId = (o.json?.order || o.json)?.id;
  if (!orderId) { rep.step("O", "заказ создан", "BROKEN", `HTTP ${o.status}`); rep.print(); return; }

  const agree = await call(A, "PATCH", `/api/orders/${orderId}`, { status: "agreed" });
  const r = await call(A, "POST", "/api/routes", {
    name: `${TAG} рейс`, orderIds: [orderId],
  }, { timeoutMs: 120000 });
  const routeId = (r.json?.route || r.json)?.id;
  if (!routeId) { rep.step("O", "рейс создан", "BROKEN", `HTTP ${r.status} ${r.json?.error || ""}`); rep.print(); return; }

  const trip = await call(A, "GET", `/api/routes/${routeId}/trip?ensureStages=1`, undefined, { timeoutMs: 120000 });
  const t = trip.json || {};
  const dq = t.dataQuality || {};
  rep.step("O", "прогноз отвечает на битый адрес", trip.status === 200 ? "VERIFIED" : "BROKEN",
    `HTTP ${trip.status}`, { status: trip.status });

  rep.step("O", "признак «не все адреса размечены» виден диспетчеру",
    dq.allLegsGeocoded === false ? "VERIFIED" : dq.allLegsGeocoded === true ? "BROKEN" : "PARTIAL",
    `dataQuality.allLegsGeocoded = ${JSON.stringify(dq.allLegsGeocoded)}`,
    { allLegsGeocoded: dq.allLegsGeocoded });

  const named = JSON.stringify(dq).includes("ЗЗЗ") || JSON.stringify(t.warnings || "").includes("ЗЗЗ");
  rep.step("O", "негеокодированный адрес назван в ответе",
    named ? "VERIFIED" : "BROKEN",
    `в dataQuality/warnings упомянут адрес: ${named}`,
    { dataQuality: dq, warnings: t.warnings });

  rep.step("O", "источник расстояния честно указан",
    (t.sources && (t.sources.routing || t.sources.distance)) ? "VERIFIED" : "PARTIAL",
    `sources = ${JSON.stringify(t.sources)}`, { sources: t.sources });

  rep.step("O", "надёжность прогноза понижена",
    t.reliable === false || (typeof t.confidence?.score === "number" && t.confidence.score < 0.7) ? "VERIFIED" : "PARTIAL",
    `reliable=${t.reliable}, confidence=${JSON.stringify(t.confidence)}`,
    { reliable: t.reliable, confidence: t.confidence });

  // Что показано в этапах: битый адрес не должен молча стать нулевым расстоянием
  const bogusStage = (t.stages || []).find((s) => String(s.address || "").includes("ЗЗЗ"));
  rep.step("O", "этап с битым адресом присутствует в плане",
    bogusStage ? "VERIFIED" : "PARTIAL",
    bogusStage ? `адрес в плане: ${bogusStage.address}, distanceM=${bogusStage.distanceM}` : "этапа с таким адресом в ответе нет",
    { stage: bogusStage });

  // Сравнение: тот же рейс с хорошим адресом
  const good = await call(A, "POST", "/api/orders", {
    routeFrom: "Москва, ул. Тверская, 1", routeTo: "Тверь, ул. Советская, 5",
    price: 10000, weight: 1, clientName: `${TAG}-ok`,
  });
  const goodId = (good.json?.order || good.json)?.id;
  let goodTrip = null;
  if (goodId) {
    await call(A, "PATCH", `/api/orders/${goodId}`, { status: "agreed" });
    const r2 = await call(A, "POST", "/api/routes", { name: `${TAG} ok`, orderIds: [goodId] }, { timeoutMs: 120000 });
    const r2id = (r2.json?.route || r2.json)?.id;
    if (r2id) goodTrip = await call(A, "GET", `/api/routes/${r2id}/trip?ensureStages=1`, undefined, { timeoutMs: 120000 });
  }
  rep.step("O", "контроль: хороший адрес даёт размеченное плечо",
    goodTrip?.json?.dataQuality?.allLegsGeocoded === true ? "VERIFIED" : "BROKEN",
    `allLegsGeocoded=${goodTrip?.json?.dataQuality?.allLegsGeocoded}, estimatedLegs=${goodTrip?.json?.dataQuality?.estimatedLegs}`,
    { allLegsGeocoded: goodTrip?.json?.dataQuality?.allLegsGeocoded });

  await prisma.route.deleteMany({ where: { id: routeId } });
  if (goodId) {
    const routes = await prisma.route.findMany({ where: { name: `${TAG} ok` }, select: { id: true } });
    for (const rr of routes) await prisma.route.deleteMany({ where: { id: rr.id } });
    await prisma.order.deleteMany({ where: { id: goodId } });
  }
  await prisma.order.deleteMany({ where: { id: orderId } });
  rep.step("O", "уборка", "VERIFIED", "заказы и рейсы аудита удалены");

  rep.print();
  require("fs").writeFileSync(require("path").join(__dirname, "report-geo.json"), JSON.stringify(rep.toJSON(), null, 2));
  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });

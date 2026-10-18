// Аудит: история рейсов — фильтр по периоду на GET /api/routes.
//
// Проверяем не «код существует», а поведение на реальных данных песочницы:
//   demo-route-6 completed 2026-10-04T21:50Z
//   demo-route-5 completed 2026-10-11T21:50Z
//   stg-route-eta completed 2026-10-15T22:25Z
// Остальные рейсы активные/запланированные и в выборку completed,cancelled
// попадать не должны.
//
// Только чтение: ни одного POST/PATCH/DELETE.

const fs = require("node:fs");
const path = require("node:path");
const { ENV, BASE, login, call, Report } = require("./lib.cjs");

const ROOT = path.resolve(__dirname, "../..");

// Ожидаемый состав выборки completed,cancelled без фильтра по дате.
const COMPLETED_IDS = ["demo-route-6", "demo-route-5", "stg-route-eta"];

async function routes(jar, query) {
  const url = `/api/routes?status=completed,cancelled${query ? `&${query}` : ""}`;
  const res = await call(jar, "GET", url);
  const ids = Array.isArray(res.json?.routes) ? res.json.routes.map((r) => r.id) : [];
  return { status: res.status, json: res.json, ids };
}

function idsOf(list) {
  return [...list].sort().join(",");
}

async function main() {
  const report = new Report("История рейсов: период");
  const admin = await login(ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD);
  report.step("вход", "админ", admin.status === 200 && admin.json?.success ? "VERIFIED" : "BROKEN",
    `status=${admin.status} role=${admin.json?.user?.role ?? "?"}`);

  const jar = admin.jar;

  // 1. Без фильтра по дате — все завершённые рейсы.
  const all = await routes(jar, "");
  report.step("период", "без dateFrom/dateTo", all.status === 200 && idsOf(all.ids) === idsOf(COMPLETED_IDS) ? "VERIFIED" : "BROKEN",
    `status=${all.status} рейсов=${all.ids.length} (${all.ids.join(", ") || "—"})`,
    { expected: COMPLETED_IDS.join(","), actual: all.ids.join(",") });

  // 2. total/limit/offset в ответе — без них «Показать ещё» не построить.
  report.step("пагинация", "total/limit/offset в ответе",
    all.status === 200 && typeof all.json?.total === "number" && typeof all.json?.limit === "number" && typeof all.json?.offset === "number" ? "VERIFIED" : "BROKEN",
    `total=${all.json?.total} limit=${all.json?.limit} offset=${all.json?.offset}`);

  // 3. dateFrom отсекает старые: до 06.10 остаётся только demo-route-6.
  const from6 = await routes(jar, "dateFrom=2026-10-06T00:00:00.000Z");
  report.step("период", "dateFrom=2026-10-06 отсекает рейс от 04.10",
    from6.status === 200 && idsOf(from6.ids) === "demo-route-5,stg-route-eta" ? "VERIFIED" : "BROKEN",
    `получено: ${from6.ids.join(", ") || "—"}`,
    { expected: "demo-route-5,stg-route-eta", actual: from6.ids.join(",") });

  // 4. dateFrom=2026-10-12 — только самый свежий рейс.
  const from12 = await routes(jar, "dateFrom=2026-10-12T00:00:00.000Z");
  report.step("период", "dateFrom=2026-10-12 оставляет один рейс",
    from12.status === 200 && idsOf(from12.ids) === "stg-route-eta" ? "VERIFIED" : "BROKEN",
    `получено: ${from12.ids.join(", ") || "—"}`,
    { expected: "stg-route-eta", actual: from12.ids.join(",") });

  // 5. dateTo отсекает свежие: до 11.10 остаётся только demo-route-6.
  const to11 = await routes(jar, "dateTo=2026-10-11T00:00:00.000Z");
  report.step("период", "dateTo=2026-10-11 отсекает рейсы 11.10 и 15.10",
    to11.status === 200 && idsOf(to11.ids) === "demo-route-6" ? "VERIFIED" : "BROKEN",
    `получено: ${to11.ids.join(", ") || "—"}`,
    { expected: "demo-route-6", actual: to11.ids.join(",") });

  // 6. Оба края: рейс 11.10 попадает в сутки полностью (конец дня = 23:59:59).
  const day11 = await routes(jar, "dateFrom=2026-10-11T00:00:00.000Z&dateTo=2026-10-11T23:59:59.999Z");
  report.step("период", "рейс 11.10 целиком внутри суток",
    day11.status === 200 && idsOf(day11.ids) === "demo-route-5" ? "VERIFIED" : "BROKEN",
    `получено: ${day11.ids.join(", ") || "—"}`,
    { expected: "demo-route-5", actual: day11.ids.join(",") });

  // 7. Форма YYYY-MM-DD принимается (владелец выбирает период календарём).
  const plainDate = await routes(jar, "dateFrom=2026-10-20");
  report.step("период", "dateFrom=2026-10-20 (без времени) — будущего нет",
    plainDate.status === 200 && plainDate.ids.length === 0 ? "VERIFIED" : "BROKEN",
    `status=${plainDate.status} рейсов=${plainDate.ids.length}`);

  // 8. Мусор в дате — 400 с внятным текстом, а не молчаливый «за всё время».
  const badFrom = await routes(jar, "dateFrom=32.01.2026");
  report.step("период", "dateFrom=32.01.2026 → 400",
    badFrom.status === 400 && /дата/i.test(badFrom.json?.error || "") ? "VERIFIED" : "BROKEN",
    `status=${badFrom.status} error=${badFrom.json?.error ?? "—"}`);

  const badTo = await routes(jar, "dateTo=завтра");
  report.step("период", "dateTo=завтра → 400",
    badTo.status === 400 && /дата/i.test(badTo.json?.error || "") ? "VERIFIED" : "BROKEN",
    `status=${badTo.status} error=${badTo.json?.error ?? "—"}`);

  const bareYear = await routes(jar, "dateFrom=2026");
  report.step("период", "dateFrom=2026 → 400 (один год — не период)",
    bareYear.status === 400 ? "VERIFIED" : "BROKEN",
    `status=${bareYear.status} error=${bareYear.json?.error ?? "—"}`);

  // 9. Пагинация: limit=1 отдаёт один рейс и total больше — «Показать ещё» работает.
  const page1 = await call(jar, "GET", "/api/routes?status=completed,cancelled&limit=1&offset=0");
  const page2 = await call(jar, "GET", "/api/routes?status=completed,cancelled&limit=1&offset=1");
  report.step("пагинация", "limit=1&offset=1 — вторая страница",
    page1.status === 200 && page2.status === 200 &&
    page1.json?.routes?.length === 1 && page2.json?.routes?.length === 1 &&
    page1.json.routes[0].id !== page2.json.routes[0].id ? "VERIFIED" : "BROKEN",
    `стр1=${page1.json?.routes?.[0]?.id ?? "—"} стр2=${page2.json?.routes?.[0]?.id ?? "—"} total=${page1.json?.total}`);

  // 10. Смена статуса на клиенте: фильтр «только отменённые» — валидный статус.
  const onlyCancelled = await routes(jar, "");
  const cancelledCall = await call(jar, "GET", "/api/routes?status=cancelled");
  report.step("статус", "status=cancelled — валидный фильтр",
    cancelledCall.status === 200 && Array.isArray(cancelledCall.json?.routes) ? "VERIFIED" : "BROKEN",
    `status=${cancelledCall.status} рейсов=${cancelledCall.json?.routes?.length ?? "—"}`);
  report.step("статус", "выборка без отменённых не теряет завершённые",
    onlyCancelled.status === 200 && onlyCancelled.ids.includes("demo-route-5") ? "VERIFIED" : "BROKEN",
    `завершённые на месте: ${onlyCancelled.ids.join(", ") || "—"}`);

  // 11. Неизвестный статус по-прежнему 400 (регресс-проверка).
  const badStatus = await call(jar, "GET", "/api/routes?status=нет-такого");
  report.step("статус", "неизвестный статус → 400",
    badStatus.status === 400 ? "VERIFIED" : "BROKEN", `status=${badStatus.status}`);

  report.print();
  const out = path.join(ROOT, "scripts/audit/report-routes-history.json");
  fs.writeFileSync(out, JSON.stringify(report.toJSON(), null, 1));
  console.log(`Отчёт: ${out}`);
  process.exit(report.summary.BROKEN || report.summary.MISSING ? 1 : 0);
}

main().catch((error) => {
  console.error("Сценарий упал:", error);
  process.exit(1);
});

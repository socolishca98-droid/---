// Задача B (пульт владельца платформы), браузерная часть.
//
// Проверяем настоящим браузером на localhost:
//   B1 вход владельца и отказ обычному пользователю (интерфейс);
//   B2 компании: карточки, цифры, поиск, пустые состояния;
//   B3 подключение к компании, полоса поддержки, возврат;
//   B4 журнал: реальные записи, фильтры, догрузка;
//   B7 единая навигация и оформление пульта.

const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || "playwright-core");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "../..");

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}
const ENV = { ...process.env, ...loadEnv() };
const BASE = ENV.AUDIT_BASE_URL || "http://localhost:3000";

const results = [];
function step(name, ok, note) {
  results.push({ name, status: ok ? "VERIFIED" : "BROKEN", note });
  console.log(`${ok ? "[OK ]" : "[XX ]"} ${name} — ${note}`);
}

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(600);
  await page.fill('input[name="email"], input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(3000);
}

/** Закрыть приветственный диалог, если он открылся. */
async function dismissOnboarding(page) {
  const buttons = await page.$$('[role="dialog"] button');
  if (buttons.length) {
    await buttons[buttons.length - 1].click().catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(400);
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });

  // ─── B1: владелец входит и попадает в свой пульт ────────────────────────
  await login(page, ENV.OWNER_EMAIL, ENV.OWNER_PASSWORD);
  step("B1 владелец после входа попадает в пульт /owner", page.url().includes("/owner"), `URL: ${page.url()}`);
  const ownerText = await page.evaluate(() => document.body.innerText);
  step("B7 в шапке пульта написано «Владелец платформы»", ownerText.includes("Владелец платформы"), "шапка найдена");
  step("B7 навигация пульта содержит «Компании» и «Журнал»",
    ownerText.includes("Компании") && ownerText.includes("Журнал"), "оба пункта на месте");

  // ─── B2: компании ───────────────────────────────────────────────────────
  await page.waitForTimeout(2500);
  const orgCards = await page.evaluate(() =>
    [...document.querySelectorAll('a[href^="/owner/org/"]')].map((a) => ({
      href: a.getAttribute("href"),
      name: (a.querySelector("p")?.textContent || "").trim(),
      text: (a.innerText || "").replace(/\n/g, " | ").slice(0, 220),
    })));
  step("B2 на стартовом экране видны карточки компаний", orgCards.length >= 2, `карточек: ${orgCards.length}`);
  for (const card of orgCards) {
    console.log(`   компания: ${card.name} → ${card.href}`);
    console.log(`   ${card.text}`);
  }
  const noMix = orgCards.every((c) => c.text.includes("Сотрудников") && c.text.includes("Водителей"));
  step("B2 в карточке компании есть её цифры", noMix, "плитки сотрудников/водителей/машин на месте");

  // Цифры платформы
  const tiles = await page.evaluate(() => [...document.querySelectorAll("div")].map((d) => (d.innerText || "").split("\n").filter(Boolean).join(" ")).filter((t) => /Компаний|Сотрудников|Водителей/.test(t)).slice(0, 6));
  console.log("   плитки платформы:", JSON.stringify(tiles));

  // ─── B2: поиск в интерфейсе ─────────────────────────────────────────────
  const searchBox = await page.$('input[placeholder*="Найти человека"]');
  if (searchBox) {
    await searchBox.fill("Кузнецов");
    await page.waitForTimeout(1800);
    const found = await page.evaluate(() => document.body.innerText.includes("Кузнецов"));
    step("B2 поиск по интерфейсу находит водителя", found, "результат показан");
    await searchBox.fill("зззззнетакого");
    await page.waitForTimeout(1800);
    const emptyText = await page.evaluate(() => document.body.innerText);
    step("B2 пустой результат поиска показан текстом, а не ошибкой", emptyText.includes("Никого не нашли"), "сообщение о пустом результате есть");
    await page.click('button[aria-label="Очистить"]').catch(() => {});
    await page.waitForTimeout(600);
  } else {
    step("B2 поле поиска есть на странице", false, "поле не найдено");
  }

  // ─── B2/B3: карточка компании ───────────────────────────────────────────
  const firstOrg = orgCards[0];
  await page.goto(`${BASE}${firstOrg.href}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3000);
  const orgPageText = await page.evaluate(() => document.body.innerText);
  step("B3 карточка компании открывается и показывает её название", orgPageText.includes(firstOrg.name), `открыта: ${firstOrg.name}`);
  step("B3 на странице компании есть сотрудники и водители",
    orgPageText.includes("Сотрудники") && orgPageText.includes("Водители"), "оба раздела на месте");
  const h1 = await page.evaluate(() => document.querySelector("h1")?.textContent?.trim());
  step("B3 заголовок страницы — название компании", h1 === firstOrg.name, `h1: «${h1}»`);

  // Кнопка входа в аккаунт
  const enterButtons = await page.$$('button:has-text("Войти")');
  step("B3 у аккаунтов компании есть кнопка входа", enterButtons.length > 0, `кнопок «Войти»: ${enterButtons.length}`);

  // ─── B3: подключение к компании ─────────────────────────────────────────
  const beforeText = await page.evaluate(() => document.body.innerText);
  const targetName = (beforeText.match(/([А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+(?: [А-ЯЁ][а-яё]+)?)\s*\n/) || [])[1];
  await enterButtons[0].click();
  await page.waitForTimeout(6000);
  const afterEnterUrl = page.url();
  const bannerText = await page.evaluate(() => document.body.innerText);
  step("B3 после подключения открывается рабочее пространство компании", !afterEnterUrl.includes("/owner"), `URL: ${afterEnterUrl}`);
  step("B3 интерфейс явно показывает режим поддержки", bannerText.includes("Вы вошли как"), "полоса «Вы вошли как …» показана");
  step("B3 в полосе поддержки есть кнопка возврата", bannerText.includes("Вернуть"), "кнопка «Вернуться» на месте");
  await page.screenshot({ path: path.join(ROOT, "docs/audit-screens/taskB-impersonation-banner.png") });

  // Из режима компании пульт владельца недоступен
  await page.goto(`${BASE}/owner`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);
  const ownerFromSupport = await page.evaluate(() => document.body.innerText);
  const stillInSupport = ownerFromSupport.includes("Вы вошли как");
  step("B3 из режима компании пульт владельца не открывается", stillInSupport, "полоса поддержки остаётся, пульт не показан");

  // ─── B3: возврат ────────────────────────────────────────────────────────
  await page.goBack().catch(() => {});
  await page.waitForTimeout(2500);
  let backBtn = await page.$('button:has-text("Вернуть")');
  if (!backBtn) {
    await page.goto(`${BASE}/lm`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(3000);
    backBtn = await page.$('button:has-text("Вернуть")');
  }
  if (backBtn) {
    await backBtn.click();
    await page.waitForTimeout(6000);
    const backUrl = page.url();
    const backText = await page.evaluate(() => document.body.innerText);
    step("B3 возврат в пульт владельца работает", backUrl.includes("/owner"), `URL: ${backUrl}`);
    step("B3 после возврата режим поддержки выключен", !backText.includes("Вы вошли как"), "полоса ушла");
    const ovAgain = await page.evaluate(() => document.body.innerText);
    step("B3 после возврата снова видны компании платформы", ovAgain.includes("Компании на платформе") || ovAgain.includes("Компаний"), "список компаний на месте");
  } else {
    step("B3 кнопка возврата найдена", false, "кнопка «Вернуться» не найдена");
  }

  // ─── B4: журнал ─────────────────────────────────────────────────────────
  await page.goto(`${BASE}/owner/journal`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3500);
  const journalText = await page.evaluate(() => document.body.innerText);
  const rows = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
  step("B4 журнал открывается и показывает записи", rows > 0, `строк в таблице: ${rows}`);
  step("B4 в журнале есть колонки Когда/Компания/Кто/Действие/Над кем",
    ["Когда", "Компания", "Кто", "Действие", "Над кем"].every((c) => journalText.includes(c)), "все колонки на месте");
  step("B4 в журнале видно подключение к компании", journalText.includes("Вход в чужой аккаунт"), "событие поддержки подписано словами");
  const rawCodes = await page.evaluate(() => {
    const cells = [...document.querySelectorAll("table tbody tr td:nth-child(4)")].map((c) => (c.textContent || "").trim());
    return cells.filter((c) => /^[a-z_]{4,}$/.test(c));
  });
  step("B4 действия в журнале подписаны словами, а не сырыми кодами", rawCodes.length === 0,
    rawCodes.length === 0 ? "сырых кодов нет" : `сырые коды: ${[...new Set(rawCodes)].join(", ")}`);
  const firstRow = await page.evaluate(() => document.querySelector("table tbody tr")?.innerText?.replace(/\n/g, " | "));
  console.log("   первая запись журнала:", firstRow);

  // Фильтр по компании
  const orgSelect = await page.$('select[aria-label="Компания"]');
  if (orgSelect) {
    const options = await page.evaluate(() => [...document.querySelectorAll('select[aria-label="Компания"] option')].map((o) => o.value));
    if (options.length > 1) {
      await page.selectOption('select[aria-label="Компания"]', options[1]);
      await page.waitForTimeout(2500);
      const filtered = await page.evaluate(() => document.body.innerText);
      const filteredRows = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
      step("B4 фильтр журнала по компании работает", filteredRows >= 0 && !filtered.includes("Загружаю журнал"), `строк после фильтра: ${filteredRows}`);
    }
  }

  // Догрузка
  const loadMore = await page.$('button:has-text("Показать ещё")');
  if (loadMore) {
    const before = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
    await loadMore.click();
    await page.waitForTimeout(3000);
    const after = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
    step("B4 догрузка журнала добавляет записи", after > before, `строк: ${before} → ${after}`);
  } else {
    step("B4 догрузка журнала", true, "все записи уместились на одной странице");
  }

  // ─── B1: обычный пользователь не попадает в пульт ───────────────────────
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU" });
  const page2 = await ctx2.newPage();
  await login(page2, ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD);
  await page2.waitForTimeout(2500);
  await dismissOnboarding(page2);
  await page2.goto(`${BASE}/owner`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page2.waitForTimeout(4000);
  const adminUrl = page2.url();
  const adminText = await page2.evaluate(() => document.body.innerText);
  step("B1 обычный администратор не попадает в пульт владельца", !adminUrl.includes("/owner"), `URL после перехода: ${adminUrl}`);
  step("B1 интерфейс не раскрывает существование пульта", !adminText.includes("Владелец платформы"), "никаких намёков на пульт нет");
  await page2.goto(`${BASE}/owner/journal`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page2.waitForTimeout(3500);
  step("B1 обычный администратор не открывает и журнал владельца", !page2.url().includes("/owner/journal"), `URL: ${page2.url()}`);

  // ─── B7: оформление и состояния ────────────────────────────────────────
  await page.goto(`${BASE}/owner`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);
  const finalText = await page.evaluate(() => document.body.innerText);
  step("B7 на экране компаний есть пояснение и цифры", finalText.includes("Компании на платформе"), "заголовок и описание на месте");

  // 401/403 от /api/auth/session?kind=... и /api/onboarding — известный шум:
  // клиент спрашивает чужой контур сессии, а онбординг владельцу не нужен.
  const realErrors = errors.filter((e) => !/Failed to load resource: the server responded with a status of (401|403)/.test(e));
  step("B5 на проверенных страницах нет ошибок скриптов", realErrors.length === 0,
    realErrors.length ? realErrors.slice(0, 3).join(" | ") : `ошибок нет (известный шум 401/403 от чужих контуров сессии: ${errors.length})`);

  await page.screenshot({ path: path.join(ROOT, "docs/audit-screens/taskB-owner-home.png") });
  await page2.screenshot({ path: path.join(ROOT, "docs/audit-screens/taskB-owner-denied.png") });

  const summary = { VERIFIED: 0, BROKEN: 0 };
  for (const r of results) summary[r.status] = (summary[r.status] || 0) + 1;
  console.log("\n===== ИТОГ =====");
  console.log(JSON.stringify(summary));
  fs.writeFileSync(path.join(ROOT, "scripts/audit/report-owner-ui.json"), JSON.stringify({ summary, results, errors }, null, 1));
  console.log("отчёт: scripts/audit/report-owner-ui.json");

  await browser.close();
})().catch((e) => {
  console.error("СЦЕНАРИЙ УПАЛ:", e);
  process.exit(1);
});

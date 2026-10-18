// Задача D: пульт владельца — имя, «Кабинет», подключение к компании,
// и история рейсов. Проверяем в браузере то, на что жаловался владелец:
//   1) сменить имя в пульте и увидеть результат;
//   2) кнопка «Кабинет» называет организацию, а не уводит «куда-то»;
//   3) войти в компанию одним нажатием с общего экрана и вернуться;
//   4) страница компании: поиск по учётным записям;
//   5) история рейсов: период, статус, фильтры, догрузка.
//
// Сценарий самоубирается: имя владельца и его организация возвращаются к
// исходным значениям в блоке finally.

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

const steps = [];
function step(name, ok, note, extra = {}) {
  steps.push({ name, status: ok ? "VERIFIED" : "BROKEN", note, ...extra });
  console.log(`${ok ? "[OK ]" : "[XX ]"} ${name} — ${note}`);
  return ok;
}

const TAG = `D-${Date.now().toString(36).toUpperCase()}`;
const NEW_NAME = `${TAG} Владелец`;

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(500);
  await page.fill('input[name="email"], input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(2500);
}

/** Закрывает приветственный диалог, если он перехватывает клики. */
async function dismissWelcome(page) {
  const buttons = await page.$$('[role="dialog"] button');
  if (buttons.length) {
    await buttons[buttons.length - 1].click().catch(() => {});
    await page.waitForTimeout(600);
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
}

const prismaClient = () => {
  const { PrismaClient } = require(path.join(ROOT, "node_modules/@prisma/client"));
  return new PrismaClient();
};

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  // Исходное состояние владельца — чтобы вернуть его после сценария.
  const prisma = prismaClient();
  const owner = await prisma.user.findUnique({
    where: { email: ENV.OWNER_EMAIL },
    select: { id: true, name: true, organizationId: true },
  });
  const originalName = owner?.name ?? "";
  const originalOrg = owner?.organizationId ?? null;
  const targetOrg = await prisma.organization.findFirst({
    where: { name: { contains: "Фролов" } },
    select: { id: true, name: true },
  });
  await prisma.$disconnect();

  const pageErrors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/401|403|favicon/i.test(m.text())) pageErrors.push(m.text().slice(0, 200));
  });

  /** Имя из шапки пульта. */
  const headerName = () =>
    page.evaluate(() => {
      const p = document.querySelector("header p");
      return p ? p.textContent.trim() : "";
    });

  try {
    // ── 1. Вход владельца и смена имени ──────────────────────────────────
    await login(page, ENV.OWNER_EMAIL, ENV.OWNER_PASSWORD);
    await page.goto(`${BASE}/owner`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2500);

    const before = await headerName();
    step("шапка пульта", before.length > 0, `показано: «${before}»`, { headerName: before });

    await page.click('button[aria-label="Мой профиль"]').catch(() => {});
    await page.waitForTimeout(900);
    const dialogOpen = (await page.locator('[role="dialog"]').count()) > 0;
    const dialogTitle = dialogOpen ? await page.locator('[role="dialog"]').first().innerText() : "";
    step("диалог «Мой профиль»", dialogOpen && /Мой профиль/.test(dialogTitle), dialogOpen ? "открылся" : "не открылся");

    const nameField = page.locator("#owner-profile-name");
    const prefilled = (await nameField.count()) > 0 ? await nameField.inputValue() : "";
    step("поле имени заполнено из базы", prefilled.length > 0, `значение: «${prefilled}»`, { prefilled });

    if ((await nameField.count()) > 0) {
      await nameField.fill(NEW_NAME);
      await page.locator('[role="dialog"] button:has-text("Сохранить данные")').first().click();
      await page.waitForTimeout(2500);
    }
    const after = await headerName();
    step(
      "новое имя видно в шапке пульта",
      after === NEW_NAME,
      `было «${before}» → стало «${after}»`,
      { before, after },
    );

    const p2 = prismaClient();
    const dbName = (await p2.user.findUnique({ where: { email: ENV.OWNER_EMAIL }, select: { name: true } }))?.name;
    await p2.$disconnect();
    step("имя сохранено в базе", dbName === NEW_NAME, `в БД: «${dbName}»`, { dbName });

    // ── 2. «Кабинет» называет организацию ───────────────────────────────
    // Владелец в песочнице без своей организации, поэтому временно
    // прикрепляем его к существующей — и сразу открепляем обратно.
    if (targetOrg) {
      const p3 = prismaClient();
      await p3.user.update({ where: { email: ENV.OWNER_EMAIL }, data: { organizationId: targetOrg.id } });
      await p3.$disconnect();

      await page.goto(`${BASE}/owner`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(3000);
      const cabinet = page.locator('a[title^="Открыть кабинет организации"]');
      const cabinetText = (await cabinet.count()) ? (await cabinet.first().innerText()).trim() : "";
      step(
        "«Кабинет» называет организацию",
        (await cabinet.count()) > 0 && cabinetText.includes(targetOrg.name),
        `подпись: «${cabinetText}»`,
        { cabinetText, expectedOrg: targetOrg.name },
      );

      // Без своей организации кнопки быть не должно — иначе она ведёт «куда-то».
      const p4 = prismaClient();
      await p4.user.update({ where: { email: ENV.OWNER_EMAIL }, data: { organizationId: originalOrg } });
      await p4.$disconnect();
      await page.goto(`${BASE}/owner`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(3000);
      const gone = (await page.locator('a[title^="Открыть кабинет организации"]').count()) === 0;
      step("без своей компании кнопки «Кабинет» нет", gone, gone ? "кнопка скрыта" : "кнопка осталась");
    } else {
      step("«Кабинет» называет организацию", false, "тестовая организация не найдена");
    }

    // ── 3. Подключение к компании одним нажатием ────────────────────────
    await page.goto(`${BASE}/owner`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);
    const enterBtn = page.locator('button:has-text("Войти как")').first();
    const enterCount = await page.locator('button:has-text("Войти как")').count();
    const enterLabel = enterCount ? (await enterBtn.innerText()).trim() : "";
    const entersSomeoneElse = enterCount > 0 && !enterLabel.includes(NEW_NAME);
    step(
      "кнопка «Войти как …» на карточке компании",
      entersSomeoneElse,
      enterCount ? `подпись: «${enterLabel}»` : "кнопки нет",
      { enterLabel },
    );

    if (entersSomeoneElse) {
      const beforeUrl = page.url();
      await enterBtn.click();
      await page.waitForTimeout(6000);
      const afterUrl = page.url();
      const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 800));
      step(
        "вход в компанию с общего экрана",
        /\/(lm|dashboard|m)(\?|$)/.test(afterUrl) && afterUrl !== beforeUrl,
        `адрес: ${afterUrl}`,
        { beforeUrl, afterUrl },
      );

      // Полоса «Вы вошли как …» — иначе в чужом кабинете легко забыть, кто ты.
      const bannerText = await page.evaluate(() => document.body.innerText);
      step(
        "баннер «Вы вошли как …»",
        /Вы вошли как/.test(bannerText),
        /Вы вошли как/.test(bannerText) ? "показан" : "не показан",
      );

      // Возврат к своему аккаунту — иначе владелец остаётся в чужом кабинете.
      const backBtn = page.locator('button:has-text("Вернуться")').first();
      if ((await backBtn.count()) > 0) {
        await backBtn.click();
        await page.waitForTimeout(6000);
        const backUrl = page.url();
        step(
          "возврат к своему аккаунту",
          /\/owner/.test(backUrl),
          `адрес после возврата: ${backUrl}`,
          { backUrl },
        );
      } else {
        step("возврат к своему аккаунту", false, "кнопки возврата не нашли");
      }
    }

    // ── 4. Страница компании: поиск по учётным записям ──────────────────
    if (targetOrg) {
      await page.goto(`${BASE}/owner/org/${targetOrg.id}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      const search = page.locator('input[placeholder^="Найти в компании"]');
      await search.first().waitFor({ state: "attached", timeout: 20000 }).catch(() => {});
      const hasSearch = (await search.count()) > 0;
      step("поиск по учётным записям компании", hasSearch, hasSearch ? "поле на месте" : "поля нет");

      if (hasSearch) {
        const titleOf = () =>
          page.locator("text=/Сотрудники ·/").first().innerText().catch(() => "");
        const staffBefore = (await titleOf()).trim();
        await search.first().fill("Иван");
        await page.waitForTimeout(1500);
        const staffAfter = (await titleOf()).trim();
        step(
          "поиск фильтрует сотрудников",
          /из/.test(staffAfter),
          `«${staffBefore}» → «${staffAfter}»`,
          { before: staffBefore, after: staffAfter },
        );

        await search.first().fill("зязя");
        await page.waitForTimeout(1500);
        const miss = await page.evaluate(() => document.body.innerText);
        step(
          "неудачный поиск честно сообщён",
          /Никого не нашли по запросу/.test(miss),
          "показано «Никого не нашли по запросу …»",
        );

        await search.first().fill("");
        await page.waitForTimeout(1200);
        const restored = await page.evaluate(() => document.body.innerText);
        step("очистка поиска возвращает список", !/Никого не нашли/.test(restored), "список восстановлен");
      }
    }

    await ctx.close();

    // ── 5. История рейсов (вход админом) ───────────────────────────────
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: "ru-RU" });
    const page2 = await ctx2.newPage();
    page2.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
    await login(page2, ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD);
    await dismissWelcome(page2);
    await page2.goto(`${BASE}/routes`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page2.waitForTimeout(3500);

    const activeTitle = (await page2.locator("h1").first().innerText()).trim();
    step("вкладка активных", /Активные маршруты/.test(activeTitle), `заголовок: «${activeTitle}»`);

    await page2.locator('button[role="tab"]:has-text("Завершённые")').first().click();
    await page2.waitForTimeout(3000);
    const historyTitle = (await page2.locator("h1").first().innerText()).trim();
    step("заголовок истории", /История рейсов/.test(historyTitle), `заголовок: «${historyTitle}»`);

    const filters = await page2.evaluate(() => ({
      period: !!document.querySelector('[aria-label="Период"]'),
      status: !!document.querySelector('[aria-label="Статус рейса"]'),
      driver: !!document.querySelector('[aria-label="Водитель"]'),
      vehicle: !!document.querySelector('[aria-label="Машина"]'),
      sort: !!document.querySelector('[aria-label="Сортировка"]'),
    }));
    step(
      "фильтры истории",
      filters.period && filters.status && filters.driver && filters.vehicle && filters.sort,
      JSON.stringify(filters),
      filters,
    );

    // Карточки истории считаем по строке «Точек:» — она есть только в них.
    const cards = async () => (await page2.evaluate(() => (document.body.innerText.match(/Точек:/g) || []).length));
    const summaryText = await page2.evaluate(() => document.body.innerText);
    const cardsAll = await cards();
    step(
      "карточки истории показаны",
      /Рейсов за период/.test(summaryText) && cardsAll > 0,
      `«Рейсов за период» в сводке, карточек: ${cardsAll}`,
      { cardsAll },
    );

    // Период «7 дней» должен убрать рейс от 04.10.
    await page2.click('[aria-label="Период"]');
    await page2.waitForTimeout(500);
    await page2.locator('[role="option"]:has-text("7 дней")').first().click();
    await page2.waitForTimeout(3000);
    const weekCards = await cards();
    const weekText = await page2.evaluate(() => document.body.innerText);
    step(
      "период «7 дней» фильтрует",
      /Рейсов за период/.test(weekText) && weekCards < cardsAll,
      `карточек: ${cardsAll} → ${weekCards}`,
      { before: cardsAll, after: weekCards },
    );

    // «Только отменённые» — пустое состояние должно объясняться, а не молчать.
    await page2.click('[aria-label="Период"]');
    await page2.waitForTimeout(400);
    await page2.locator('[role="option"]:has-text("всё время")').first().click();
    await page2.waitForTimeout(400);
    await page2.click('[aria-label="Статус рейса"]');
    await page2.waitForTimeout(400);
    await page2.locator('[role="option"]:has-text("Только отменённые")').first().click();
    await page2.waitForTimeout(3000);
    const emptyText = await page2.evaluate(() => document.body.innerText);
    step(
      "пустая история объяснена",
      /Рейсов за этот период нет/.test(emptyText),
      /Рейсов за этот период нет/.test(emptyText) ? "сообщение показано" : "сообщения нет",
    );

    await ctx2.close();
  } finally {
    // Возврат исходного состояния владельца: имя и организация.
    try {
      const p5 = prismaClient();
      await p5.user.update({
        where: { email: ENV.OWNER_EMAIL },
        data: { name: originalName, organizationId: originalOrg },
      });
      const check = await p5.user.findUnique({
        where: { email: ENV.OWNER_EMAIL },
        select: { name: true, organizationId: true },
      });
      await p5.$disconnect();
      step(
        "уборка: владелец возвращён к исходному",
        check?.name === originalName && check?.organizationId === originalOrg,
        `имя «${check?.name}», organizationId=${check?.organizationId}`,
      );
    } catch (error) {
      step("уборка: владелец возвращён к исходному", false, String(error).slice(0, 200));
    }
    await browser.close();
  }

  const broken = steps.filter((s) => s.status === "BROKEN");
  console.log("\n===== ИТОГ =====");
  console.log(JSON.stringify({ verified: steps.length - broken.length, broken: broken.length, total: steps.length }));
  if (pageErrors.length) console.log("Ошибки страницы:", pageErrors.slice(0, 8));
  for (const b of broken) console.log(` ПРОБЛЕМА: ${b.name}: ${b.note}`);
  fs.writeFileSync(
    path.join(ROOT, "scripts/audit/report-owner-profile.json"),
    JSON.stringify({ steps, pageErrors, summary: { verified: steps.length - broken.length, broken: broken.length } }, null, 1),
  );
  process.exit(broken.length ? 1 : 0);
}

main().catch((error) => {
  console.error("Сценарий упал:", error);
  process.exit(1);
});

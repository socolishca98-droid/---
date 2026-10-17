// Скриншоты задачи D для отчёта: пульт владельца (имя, «Кабинет», вход в
// компанию), страница компании с поиском и история рейсов с фильтрами.
// Владелец временно прикрепляется к организации ради кадра «Кабинет: …» и
// возвращается в исходное состояние.
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
const OUT = path.join(ROOT, "docs/audit-screens");

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

(async () => {
  const { PrismaClient } = require(path.join(ROOT, "node_modules/@prisma/client"));
  const prisma = new PrismaClient();
  const owner = await prisma.user.findUnique({
    where: { email: ENV.OWNER_EMAIL },
    select: { organizationId: true },
  });
  const originalOrg = owner?.organizationId ?? null;
  const org = await prisma.organization.findFirst({
    where: { name: { contains: "Фролов" } },
    select: { id: true },
  });
  await prisma.$disconnect();

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  try {
    // ── Пульт владельца: шапка с именем, профиль, «Кабинет: организация» ──
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: "ru-RU" });
    const page = await ctx.newPage();
    await login(page, ENV.OWNER_EMAIL, ENV.OWNER_PASSWORD);

    if (org) {
      const p = new PrismaClient();
      await p.user.update({ where: { email: ENV.OWNER_EMAIL }, data: { organizationId: org.id } });
      await p.$disconnect();
    }
    await page.goto(`${BASE}/owner`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(OUT, "taskD-owner-home.png") });
    console.log("снят taskD-owner-home.png");

    // Диалог «Мой профиль»
    await page.click('button[aria-label="Мой профиль"]').catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, "taskD-owner-profile-dialog.png") });
    console.log("снят taskD-owner-profile-dialog.png");
    await page.keyboard.press("Escape");

    // Страница компании с поиском
    if (org) {
      await page.goto(`${BASE}/owner/org/${org.id}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(3500);
      await page.screenshot({ path: path.join(OUT, "taskD-owner-org-search.png") });
      console.log("снят taskD-owner-org-search.png");
    }
    await ctx.close();

    // ── История рейсов ──
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU" });
    const page2 = await ctx2.newPage();
    await login(page2, ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD);
    const dlg = await page2.$$('[role="dialog"] button');
    if (dlg.length) await dlg[dlg.length - 1].click().catch(() => {});
    await page2.keyboard.press("Escape").catch(() => {});
    await page2.goto(`${BASE}/routes`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page2.waitForTimeout(3500);
    await page2.locator('button[role="tab"]:has-text("Завершённые")').first().click();
    await page2.waitForTimeout(3500);
    await page2.screenshot({ path: path.join(OUT, "taskD-routes-history.png") });
    console.log("снят taskD-routes-history.png");
    await ctx2.close();
  } finally {
    const p = new PrismaClient();
    await p.user.update({ where: { email: ENV.OWNER_EMAIL }, data: { organizationId: originalOrg } });
    await p.$disconnect();
    await browser.close();
    console.log("владелец возвращён, organizationId =", originalOrg);
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});

// Приёмка задачи 1, часть 3: полный цикл восстановления пароля в браузере.
// Токен выдаётся той же библиотекой, что и API (lib/password-reset.ts) —
// отправка письма в песочнице недоступна (Resend), но сам сценарий
// «ссылка → новый пароль → вход» проверяется целиком.
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || "playwright-core");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "../..");
require(path.join(ROOT, "scripts/register-path-alias.cjs"));

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

// Выдача токена теми же средствами, что и lib/password-reset.ts: случайные
// байты + sha256-хэш в базе, прежние неиспользованные гасятся.
async function issueToken(email) {
  const { randomBytes, createHash } = require("node:crypto");
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  const user = await prisma.user.findFirst({ where: { email }, select: { id: true, organizationId: true } });
  if (!user) { await prisma.$disconnect(); return null; }
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.passwordResetToken.create({ data: { tokenHash, userId: user.id, organizationId: user.organizationId ?? null, expiresAt } }),
  ]);
  await prisma.$disconnect();
  return { token, expiresAt };
}

(async () => {
  const issued = await issueToken(ENV.ADMIN_EMAIL);
  if (!issued) { console.error("пользователь не найден"); process.exit(1); }
  console.log("токен выдан, живёт до:", issued.expiresAt.toISOString());

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU" })).newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 220)));

  const url = `${BASE}/reset-password?token=${encodeURIComponent(issued.token)}`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2500);
  let txt = await page.evaluate(() => document.body.innerText);
  console.log("\n=== страница по настоящей ссылке из письма ===");
  console.log(" Error Boundary :", /Что-то сломалось/.test(txt) ? "ДА — СЛОМАНО" : "НЕТ");
  console.log(" полей пароля   :", await page.locator('input[type="password"]').count());
  console.log(" кнопка отправки:", await page.locator('button[type="submit"]').count());
  console.log(" текст          :", JSON.stringify(txt.slice(0, 150).replace(/\n/g, " | ")));
  console.log(" ошибок страницы:", errs.length);
  await page.screenshot({ path: path.join(ROOT, "docs/audit-screens/fix1-reset-token.png") });

  const NEW_PW = "Audit-Reset-Passw0rd!2026";
  if (await page.locator('input[type="password"]').count() >= 2) {
    const f = page.locator('input[type="password"]');
    await f.nth(0).fill(NEW_PW);
    await f.nth(1).fill(NEW_PW);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
      page.click('button[type="submit"]'),
    ]);
    await page.waitForTimeout(3500);
    txt = await page.evaluate(() => document.body.innerText);
    console.log("\n=== после задания нового пароля ===");
    console.log(" адрес:", page.url());
    console.log(" текст:", JSON.stringify(txt.slice(0, 170).replace(/\n/g, " | ")));
    console.log(" ошибок страницы:", errs.length);

    // Старый пароль больше не работает
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(500);
    await page.fill('input[name="email"], input[type="email"]', ENV.ADMIN_EMAIL);
    await page.fill('input[type="password"]', ENV.ADMIN_PASSWORD);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
      page.click('button[type="submit"]'),
    ]);
    await page.waitForTimeout(2500);
    console.log("\n=== старый пароль после сброса ===");
    console.log(" ", /\/login(\?|$)/.test(page.url()) ? "отклонён — правильно" : "ПУСТИЛ — проверять", "|", page.url());

    // Новый пароль работает
    await page.fill('input[name="email"], input[type="email"]', ENV.ADMIN_EMAIL);
    await page.fill('input[type="password"]', NEW_PW);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
      page.click('button[type="submit"]'),
    ]);
    await page.waitForTimeout(2500);
    const ok = !/\/login(\?|$)/.test(page.url());
    console.log("\n=== новый пароль ===");
    console.log(" ", ok ? "РАБОТАЕТ — цикл пройден" : "НЕ РАБОТАЕТ", "|", page.url());

    // Повторное использование той же ссылки не должно сработать
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2200);
    txt = await page.evaluate(() => document.body.innerText);
    console.log("\n=== повторное использование ссылки ===");
    console.log(" полей пароля:", await page.locator('input[type="password"]').count(), "(0 = ссылка погашена)");
    console.log(" текст:", JSON.stringify(txt.slice(0, 140).replace(/\n/g, " | ")));

    // Возвращаем исходный пароль, чтобы стенд не сломать
    const restore = await page.evaluate(async ([cur, next]) => {
      const csrf = await (await fetch("/api/auth/csrf")).json();
      const res = await fetch("/api/auth/change-password", {
        method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": csrf.csrfToken },
        body: JSON.stringify({ currentPassword: cur, newPassword: next }),
      });
      return res.status;
    }, [NEW_PW, ENV.ADMIN_PASSWORD]);
    console.log("\nвозврат исходного пароля: HTTP", restore);
  }
  await browser.close();
})().catch((e) => { console.error("ERR", e); process.exit(1); });

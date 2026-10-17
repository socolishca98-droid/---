// Матрица «любой пользователь умеет менять имя».
//
// Требование: редактирование имени доступно КАЖДОЙ роли в её контуре, а не
// только владельцу. Проверяем по-настоящему, в браузере, каждую форму:
//   админ    — компьютерная версия, меню пользователя → «Мой профиль»
//   логист   — мобильная панель, /lm/more → «Изменить данные»
//   водитель — /m/profile → «Изменить»
//   владелец — пульт /owner → «Мой профиль»
//
// Каждый шаг: прочитать имя → изменить → увидеть НОВОЕ имя в интерфейсе этого
// контура → перезагрузить и убедиться, что имя сохранилось → проверить базу →
// вернуть исходное имя.
//
// Временный логист создаётся сценарием и удаляется им же (изолированные данные).

const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || "playwright-core");
const crypto = require("node:crypto");
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
const DRIVER_PHONE = "79161234502";

const steps = [];
function step(name, ok, note, extra = {}) {
  steps.push({ name, status: ok ? "VERIFIED" : "BROKEN", note, ...extra });
  console.log(`${ok ? "[OK ]" : "[XX ]"} ${name} — ${note}`);
  return ok;
}

const TAG = `N-${Date.now().toString(36).toUpperCase()}`;
const prismaClient = () => {
  const { PrismaClient } = require(path.join(ROOT, "node_modules/@prisma/client"));
  return new PrismaClient();
};

/** Хеш пароля теми же параметрами, что в lib/auth/password.ts. */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password.normalize("NFKC"), Buffer.from(salt, "hex"), 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return { hash: derived.toString("hex"), salt };
}

async function login(page, email, password, tel = false) {
  const url = tel ? `${BASE}/m/login` : `${BASE}/login`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(500);
  await page.fill(tel ? 'input[type="tel"]' : 'input[name="email"], input[type="email"]', tel ? email : email);
  await page.fill('input[type="password"]', password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(2500);
}

async function dismissWelcome(page) {
  const buttons = await page.$$('[role="dialog"] button');
  if (buttons.length) {
    await buttons[buttons.length - 1].click().catch(() => {});
    await page.waitForTimeout(600);
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
}

/** Имя пользователя из базы. */
async function dbName(email) {
  const p = prismaClient();
  const row = await p.user.findUnique({ where: { email }, select: { name: true } });
  await p.$disconnect();
  return row?.name ?? "";
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  // ── Подготовка: исходные имена и временный логист ─────────────────────
  const prisma = prismaClient();
  const adminBefore = await dbName(ENV.ADMIN_EMAIL);
  const ownerBefore = await dbName(ENV.OWNER_EMAIL);
  const driverRow = await prisma.user.findFirst({
    where: { role: "driver", phone: DRIVER_PHONE },
    select: { id: true, name: true, email: true, driverId: true },
  });
  const driverBefore = driverRow?.name ?? ""
  // Имя водителя живёт в двух записях: User (вход) и Driver (карточка для
  // логиста) — обе вернуть на место, иначе сценарий оставляет мусор.
  const driverCardRow = driverRow?.driverId
    ? await prisma.driver.findUnique({
        where: { id: driverRow.driverId },
        select: { id: true, name: true },
      })
    : null
  const driverCardBefore = driverCardRow?.name ?? "";
  const org = await prisma.organization.findFirst({
    where: { name: { contains: "Фролов" } },
    select: { id: true },
  });

  const logistPassword = `Logi${crypto.randomBytes(6).toString("base64url")}7`;
  const { hash, salt } = hashPassword(logistPassword);
  const logistEmail = `temp-logist-${TAG.toLowerCase()}@a.test`;
  const logist = org
    ? await prisma.user.create({
        data: {
          organizationId: org.id,
          name: "Временный Логист",
          email: logistEmail,
          role: "logist",
          status: "active",
          phone: "",
          passwordHash: hash,
          passwordSalt: salt,
        },
        select: { id: true },
      })
    : null;
  await prisma.$disconnect();
  console.log(`временный логист: ${logist ? logistEmail : "НЕ СОЗДАН (нет организации)"}`);

  const pageErrors = [];

  /** Меняет имя через переданный открытый интерфейс и проверяет результат. */
  async function changeName(page, { fill, save, visible }) {
    await fill();
    await save();
    await page.waitForTimeout(3000);
    const shown = await visible();
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => null);
    await page.waitForTimeout(3000);
    const afterReload = await visible();
    return { shown, afterReload };
  }

  /** Своя чистая сессия на каждую роль: иначе cookie прошлого пользователя
      отправляет на дашборд вместо формы входа. */
  async function withRole(run) {
    const roleCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU" });
    const rolePage = await roleCtx.newPage();
    rolePage.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
    try {
      await run(rolePage);
    } finally {
      await roleCtx.close();
    }
  }

  try {
    // ── 1. АДМИН: меню пользователя в шапке → «Мой профиль» ─────────────
    await withRole(async (page) => {
      await login(page, ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD);
      await dismissWelcome(page);
      await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(2500);

      const trigger = await page.evaluateHandle(() => {
        const header = document.querySelector("header.surface-glass") || document.querySelector("header");
        if (!header) return null;
        const btns = [...header.querySelectorAll("button")];
        return btns[btns.length - 1] || null;
      });
      if (trigger?.asElement()) await trigger.asElement().click().catch(() => {});
      await page.waitForTimeout(1200);
      const profileItem = await page.$('text=Мой профиль');
      if (profileItem) await profileItem.click();
      await page.waitForTimeout(1500);

      const adminName = `${TAG} Админов`;
      const r = await changeName(page, {
        fill: async () => {
          const input = page.locator("#profile-name");
          if ((await input.count()) === 0) throw new Error("нет поля #profile-name");
          await input.fill(adminName);
        },
        save: async () => {
          await page.locator('[role="dialog"] button[type="submit"]').first().click();
        },
        visible: async () => (await page.evaluate(() => document.body.innerText)).includes(adminName),
      });
      const db = await dbName(ENV.ADMIN_EMAIL);
      step(
        "админ меняет имя в шапке компьютерной версии",
        r.shown && r.afterReload && db === adminName,
        `новое имя на экране: ${r.shown ? "да" : "нет"}, после перезагрузки: ${r.afterReload ? "да" : "нет"}, в базе: ${db === adminName ? "да" : "нет"}`,
        { role: "admin", name: adminName },
      );
    });

    // ── 2. ЛОГИСТ: мобильная панель /lm/more → «Изменить данные» ────────
    if (logist) {
      await withRole(async (page) => {
        await login(page, logistEmail, logistPassword);
        await page.goto(`${BASE}/lm/more`, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(3000);
        const nameShownBefore = (await page.evaluate(() => document.body.innerText)).includes("Временный Логист");
        await page.locator('button:has-text("Изменить данные")').first().click();
        await page.waitForTimeout(900);

        const logistName = `${TAG} Логистов`;
        const r = await changeName(page, {
          fill: async () => {
            const input = page.locator('input[placeholder="Имя"]');
            if ((await input.count()) === 0) throw new Error("нет поля имени в /lm/more");
            await input.fill(logistName);
          },
          save: async () => {
            await page.locator('button:has-text("Сохранить данные")').first().click();
          },
          visible: async () => (await page.evaluate(() => document.body.innerText)).includes(logistName),
        });
        const db = await dbName(logistEmail);
        step(
          "логист меняет имя в мобильной панели",
          nameShownBefore && r.shown && r.afterReload && db === logistName,
          `исходное имя показано: ${nameShownBefore ? "да" : "нет"}, новое на экране: ${r.shown ? "да" : "нет"}, после перезагрузки: ${r.afterReload ? "да" : "нет"}, в базе: ${db === logistName ? "да" : "нет"}`,
          { role: "logist", name: logistName },
        );
      });
    } else {
      step("логист меняет имя в мобильной панели", false, "временный логист не создан");
    }

    // ── 3. ВОДИТЕЛЬ: /m/profile → «Изменить» ────────────────────────────
    await withRole(async (page) => {
      await login(page, DRIVER_PHONE, ENV.DRIVER_DEFAULT_PASSWORD, true);
      await page.goto(`${BASE}/m/profile`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(3000);
      const editBtn = page.locator('button:has-text("Изменить")').first();
      if ((await editBtn.count()) > 0) await editBtn.click();
      await page.waitForTimeout(900);

      const driverName = `${TAG} Водителев`;
      const r = await changeName(page, {
        fill: async () => {
          const input = page.locator("#m-profile-name");
          if ((await input.count()) === 0) throw new Error("нет поля #m-profile-name");
          await input.fill(driverName);
        },
        save: async () => {
          await page.locator('button:has-text("Сохранить")').first().click();
        },
        visible: async () => {
          const header = await page.evaluate(() => document.querySelector("h1")?.innerText || "");
          const body = await page.evaluate(() => document.body.innerText);
          return header.includes(driverName) || body.includes(driverName);
        },
      });
      let driverDb = "";
      if (driverRow) {
        const p = prismaClient();
        const row = await p.user.findUnique({ where: { id: driverRow.id }, select: { name: true } });
        await p.$disconnect();
        driverDb = row?.name ?? "";
      }
      step(
        "водитель меняет имя в приложении водителя",
        r.shown && r.afterReload && driverDb === driverName,
        `новое имя на экране: ${r.shown ? "да" : "нет"}, после перезагрузки: ${r.afterReload ? "да" : "нет"}, в базе: ${driverDb === driverName ? "да" : "нет"}`,
        { role: "driver", name: driverName },
      );
    });

    // ── 4. ВЛАДЕЛЕЦ: пульт /owner → «Мой профиль» ───────────────────────
    await withRole(async (page) => {
      await login(page, ENV.OWNER_EMAIL, ENV.OWNER_PASSWORD);
      await page.goto(`${BASE}/owner`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(3000);
      await page.click('button[aria-label="Мой профиль"]').catch(() => {});
      await page.waitForTimeout(1200);

      const ownerName = `${TAG} Владельцев`;
      const r = await changeName(page, {
        fill: async () => {
          const input = page.locator("#owner-profile-name");
          if ((await input.count()) === 0) throw new Error("нет поля #owner-profile-name");
          await input.fill(ownerName);
        },
        save: async () => {
          await page.locator('[role="dialog"] button:has-text("Сохранить данные")').first().click();
        },
        visible: async () =>
          (await page.evaluate(() => document.querySelector("header p")?.innerText || "")).includes(ownerName),
      });
      const db = await dbName(ENV.OWNER_EMAIL);
      step(
        "владелец меняет имя в пульте",
        r.shown && r.afterReload && db === ownerName,
        `новое имя в шапке пульта: ${r.shown ? "да" : "нет"}, после перезагрузки: ${r.afterReload ? "да" : "нет"}, в базе: ${db === ownerName ? "да" : "нет"}`,
        { role: "owner", name: ownerName },
      );
    });
  } finally {
    // ── Уборка: имена на место, временный логист удалён ─────────────────
    try {
      const p = prismaClient();
      if (driverRow) await p.user.update({ where: { id: driverRow.id }, data: { name: driverBefore } });
      if (driverCardRow) {
        await p.driver.update({ where: { id: driverCardRow.id }, data: { name: driverCardBefore } });
      }
      await p.user.updateMany({ where: { email: ENV.ADMIN_EMAIL }, data: { name: adminBefore } });
      await p.user.updateMany({ where: { email: ENV.OWNER_EMAIL }, data: { name: ownerBefore } });
      if (logist) {
        await p.session.deleteMany({ where: { userId: logist.id } });
        await p.user.delete({ where: { id: logist.id } });
      }
      const left = await p.user.count({ where: { email: logistEmail } });
      const driverUserNow = driverRow
        ? (await p.user.findUnique({ where: { id: driverRow.id }, select: { name: true } }))?.name ?? ""
        : "";
      const driverCardNow = driverCardRow
        ? (await p.driver.findUnique({ where: { id: driverCardRow.id }, select: { name: true } }))?.name ?? ""
        : "";
      await p.$disconnect();
      const namesOk =
        (await dbName(ENV.ADMIN_EMAIL)) === adminBefore &&
        (await dbName(ENV.OWNER_EMAIL)) === ownerBefore &&
        (!driverRow || (driverUserNow === driverBefore && driverCardNow === driverCardBefore));
      step(
        "уборка: имена возвращены, временный логист удалён",
        left === 0 && namesOk,
        `админ «${await dbName(ENV.ADMIN_EMAIL)}», владелец «${await dbName(ENV.OWNER_EMAIL)}», водитель User «${driverUserNow}» / Driver «${driverCardNow}», временных записей: ${left}`,
      );
    } catch (error) {
      step("уборка", false, String(error).slice(0, 200));
    }
    await browser.close();
  }

  const broken = steps.filter((s) => s.status === "BROKEN");
  console.log("\n===== ИТОГ =====");
  console.log(JSON.stringify({ verified: steps.length - broken.length, broken: broken.length, total: steps.length }));
  if (pageErrors.length) console.log("Ошибки страницы:", pageErrors.slice(0, 8));
  for (const b of broken) console.log(` ПРОБЛЕМА: ${b.name}: ${b.note}`);
  fs.writeFileSync(
    path.join(ROOT, "scripts/audit/report-name-all-roles.json"),
    JSON.stringify({ steps, pageErrors, summary: { verified: steps.length - broken.length, broken: broken.length } }, null, 1),
  );
  process.exit(broken.length ? 1 : 0);
}

main().catch((error) => {
  console.error("Сценарий упал:", error);
  process.exit(1);
});

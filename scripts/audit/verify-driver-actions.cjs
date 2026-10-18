// Жалобы водителя из личного кабинета: смена имени, смена статуса с таймером,
// отправка фото. Проверяем по-настоящему, в браузере, на живом стенде.
//
// 1. Имя      — /m/profile → «Изменить»: доступность формы смены имени
//               (полная смена с проверкой базы — в verify-name-all-roles.cjs).
// 2. Статус   — кнопка «Погрузка» на /m: статус на экране, живой таймер,
//               ShiftEvent в базе, статус заказа control.
// 3. Фото     — /m/photo: выбор файла → upload → запись Photo в базе,
//               файл в хранилище. Созданные тестом записи удаляются.
//
// Все временные данные снимаются сценарием (уборка), сессия закрывается.

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
const DRIVER_PHONE = "79161234502";

const steps = [];
function step(name, ok, note, extra = {}) {
  steps.push({ name, status: ok ? "VERIFIED" : "BROKEN", note, ...extra });
  console.log(`${ok ? "[OK ]" : "[XX ]"} ${name} — ${note}`);
  return ok;
}

const prismaClient = () => {
  const { PrismaClient } = require(path.join(ROOT, "node_modules/@prisma/client"));
  return new PrismaClient();
};

async function loginDriver(page) {
  await page.goto(`${BASE}/m/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(600);
  await page.fill('input[type="tel"]', DRIVER_PHONE);
  await page.fill('input[type="password"]', ENV.DRIVER_DEFAULT_PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(3000);
}

async function dismissWelcome(page) {
  const buttons = await page.$$('[role="dialog"] button');
  if (buttons.length) {
    await buttons[buttons.length - 1].click().catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
}

/** Минимальный валидный JPEG — реальный файл, не заглушка. */
function writeTestJpeg(filePath) {
  const base64 =
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAA" +
    "AAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==";
  fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
  return fs.statSync(filePath).size;
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const prisma = prismaClient();
  const driverUser = await prisma.user.findFirst({
    where: { role: "driver", phone: DRIVER_PHONE },
    select: { id: true, driverId: true },
  });
  const driverId = driverUser?.driverId ?? null;

  const testPhotoPath = path.join(ROOT, "test-cargo-photo.jpg");
  const bytes = writeTestJpeg(testPhotoPath);

  const pageErrors = [];
  const ctx = await browser.newContext({
    viewport: { width: 420, height: 900 },
    locale: "ru-RU",
    permissions: [],
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));

  let createdPhotoId = null;

  try {
    await loginDriver(page);
    step("водитель входит в приложение", page.url().includes("/m"), `адрес: ${page.url()}`);

    // ── 1. Смена имени: форма доступна водителю ───────────────────────────
    await page.goto(`${BASE}/m/profile`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3500);
    const hasEditName = await page.evaluate(() =>
      [...document.querySelectorAll("button")].some((b) => /Изменить/.test(b.innerText || "")),
    );
    step("водителю доступна смена имени", hasEditName, "в профиле есть кнопка «Изменить»");

    // ── 2. Статус «Погрузка» + таймер ─────────────────────────────────────
    await page.goto(`${BASE}/m`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(4000);
    await dismissWelcome(page);

    // Смена должна быть начата: без неё кнопка «Начать смену»
    const needShift = await page.evaluate(() =>
      [...document.querySelectorAll("button")].some((b) => /Начать смену/.test(b.innerText || "")),
    );
    if (needShift) {
      await page.locator('button:has-text("Начать смену")').first().click();
      await page.waitForTimeout(3000);
    }

    const beforeClock = await page.evaluate(() => {
      const el = document.querySelector(".font-mono");
      return el ? el.innerText.trim() : "";
    });

    const loadingBtn = page.locator('button:has-text("Погрузка")').first();
    if ((await loadingBtn.count()) === 0) throw new Error("нет кнопки «Погрузка» на /m");
    await loadingBtn.click();
    await page.waitForTimeout(4500);

    const after = await page.evaluate(() => {
      const clock = document.querySelector(".font-mono");
      const panel = document.querySelector("section");
      return {
        clock: clock ? clock.innerText.trim() : "",
        statusLabel: panel ? (panel.querySelector("p.text-lg")?.innerText ?? "") : "",
        body: document.body.innerText,
      };
    });

    // API-снимок: статус и секунды в текущем статусе
    const shiftRes = await page.evaluate(async () => {
      const r = await fetch("/api/m/shift", { credentials: "include" });
      return r.json();
    });
    const shiftStatus = shiftRes?.shift?.status ?? "";
    const statusSeconds = Number(shiftRes?.statusSeconds ?? 0);

    const dbEvent = await prisma.shiftEvent.findFirst({
      where: { shift: { driverId, endedAt: null } },
      orderBy: { createdAt: "desc" },
      select: { type: true, metadata: true, createdAt: true },
    });
    const meta = dbEvent?.metadata ? JSON.parse(dbEvent.metadata) : {};

    step(
      "кнопка «Погрузка» меняет статус смены",
      shiftStatus === "loading" && /Погрузка/.test(after.statusLabel + after.body),
      `статус в API: ${shiftStatus || "нет"}, на экране: ${after.statusLabel || "нет"}`,
    );
    step(
      "таймер простоя идёт",
      statusSeconds >= 3 && after.clock !== beforeClock && after.clock !== "00:00",
      `было ${beforeClock || "—"}, стало ${after.clock || "—"}, API statusSeconds=${statusSeconds}`,
    );
    step(
      "время погрузки пишется в журнал смены",
      dbEvent?.type === "status" && meta.to === "loading",
      `последнее событие: ${dbEvent?.type ?? "нет"} ${dbEvent ? `to=${meta.to}` : ""}`,
    );

    // Статус заказа: погрузка означает «контроль». Заказ привязан к карточке
    // водителя (Driver.id), а не к учётной записи (User.id).
    const activeOrder = await prisma.order.findFirst({
      where: driverId
        ? { assignedDriverId: driverId, status: { notIn: ["delivered", "cancelled"] } }
        : { id: "none" },
      orderBy: { createdAt: "asc" },
      select: { id: true, status: true },
    });
    step(
      "заказ переходит в «контроль» на погрузке",
      Boolean(activeOrder) && activeOrder.status === "control",
      activeOrder ? `заказ ${activeOrder.id}: ${activeOrder.status}` : "активного заказа нет",
    );

    // Возврат «В пути»: время погрузки попадает в итоги смены
    await page.locator('button:has-text("В пути")').first().click();
    await page.waitForTimeout(3500);
    const totalsRes = await page.evaluate(async () => {
      const r = await fetch("/api/m/shift", { credentials: "include" });
      return r.json();
    });
    const loadingTotal = Number(totalsRes?.totals?.loading ?? 0);
    step("итоги смены учитывают погрузку", loadingTotal > 0, `погрузка в итогах: ${loadingTotal} с`);

    // ── 3. Фото груза ─────────────────────────────────────────────────────
    await page.goto(`${BASE}/m/photo?context=loading`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3500);
    await dismissWelcome(page);

    const fileInput = page.locator('input[type="file"]').first();
    if ((await fileInput.count()) === 0) throw new Error("нет поля выбора файла на /m/photo");
    await fileInput.setInputFiles(testPhotoPath);
    await page.waitForTimeout(6000);

    const photoRow = await prisma.photo.findFirst({
      where: { driverId },
      orderBy: { createdAt: "desc" },
      select: { id: true, type: true, url: true, createdAt: true, storageKey: true, bytes: true },
    });
    createdPhotoId = photoRow?.id ?? null;

    const dbDriver = String(process.env.STORAGE_DRIVER || "local").toLowerCase() === "db";
    const fileOnDisk = photoRow?.url
      ? fs.existsSync(path.join(ROOT, "public", photoRow.url.replace(/^\/+/, "")))
      : false;
    const bytesInDb = Boolean(photoRow?.bytes && photoRow.bytes.length > 0);

    step(
      "фото груза отправляется и сохраняется",
      dbDriver ? bytesInDb && !fileOnDisk : Boolean(photoRow) && fileOnDisk,
      dbDriver
        ? `драйвер db: байты в базе: ${bytesInDb ? "да" : "нет"}, файла на диске: ${fileOnDisk ? "есть (не должно)" : "нет"}`
        : photoRow
          ? `запись ${photoRow.id}, тип ${photoRow.type}, файл на диске: ${fileOnDisk ? "да" : "нет"}`
          : "запись о фото не создана",
    );

    // Отдача: фото открывается через /api/photos/file после проверки сессии.
    // Ссылка в базе не меняется от драйвера — это и проверяем.
    if (photoRow?.url) {
      const served = await page.evaluate(async (url) => {
        const res = await fetch(`/api/photos/file?path=${encodeURIComponent(url)}`, {
          credentials: "include",
        });
        if (!res.ok) return { status: res.status, type: "", length: 0 };
        const buf = new Uint8Array(await res.arrayBuffer());
        return { status: res.status, type: res.headers.get("content-type") || "", length: buf.length };
      }, photoRow.url);
      step(
        "фото открывается через приложение",
        served.status === 200 && served.length > 0 && /image\//.test(served.type),
        `HTTP ${served.status}, content-type ${served.type || "нет"}, байт: ${served.length}`,
      );
    }

    await page.screenshot({ path: path.join(ROOT, "docs/audit-screens/taskE-driver-photo.png") });
  } catch (error) {
    step("сценарий жалоб водителя", false, String(error).slice(0, 240));
  } finally {
    // ── Уборка: тестовое фото и открытая смена ────────────────────────────
    try {
      const p = prismaClient();
      if (createdPhotoId) {
        const row = await p.photo.findUnique({ where: { id: createdPhotoId }, select: { url: true } });
        if (row?.url) {
          const abs = path.join(ROOT, "public", row.url.replace(/^\/+/, ""));
          if (fs.existsSync(abs)) fs.unlinkSync(abs);
        }
        await p.photo.deleteMany({ where: { id: createdPhotoId } });
      }
      // Смена, открытая сценарием, закрывается: она была начата ради проверки
      const open = await p.driverShift.findFirst({
        where: driverId ? { driverId, endedAt: null } : { id: "none" },
        select: { id: true },
      });
      if (open) await p.driverShift.updateMany({ where: { id: open.id }, data: { endedAt: new Date() } });
      await p.$disconnect();
      console.log("уборка: тестовое фото удалено, сценарийная смена закрыта");
    } catch (error) {
      console.log("уборка не завершена:", String(error).slice(0, 160));
    }
    try {
      fs.unlinkSync(testPhotoPath);
    } catch {
      /* файл уже удалён */
    }
    await browser.close();
  }

  const broken = steps.filter((s) => s.status === "BROKEN");
  console.log("\n===== ИТОГ =====");
  console.log(
    JSON.stringify({ verified: steps.length - broken.length, broken: broken.length, total: steps.length }),
  );
  if (pageErrors.length) console.log("Ошибки страницы:", pageErrors.slice(0, 8));
  for (const b of broken) console.log(` ПРОБЛЕМА: ${b.name}: ${b.note}`);
  fs.writeFileSync(
    path.join(ROOT, "scripts/audit/report-driver-actions.json"),
    JSON.stringify(
      {
        title: "Жалобы водителя: имя, статус с таймером, фото",
        summary: { verified: steps.length - broken.length, broken: broken.length, total: steps.length },
        steps,
        pageErrors,
      },
      null,
      1,
    ),
  );
}

main();

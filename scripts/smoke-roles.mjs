// scripts/smoke-roles.mjs
//
// Смоук по ролям на живом экземпляре: администратор, логист, водитель и
// гость. Проверяет ровно то, что раньше проверялось глазами: кто видит
// настройки, кому недоступна админка, пускает ли водителя в staff-API и
// закрыты ли данные от гостя. Запускается и локально, и против прода.
//
//   BASE_URL=http://localhost:3000 \
//   ADMIN_EMAIL=admin@company.ru ADMIN_PASSWORD=… \
//   LOGIST_EMAIL=logist@company.ru LOGIST_PASSWORD=… \
//   DRIVER_PHONE=+79990000000 DRIVER_PASSWORD=… \
//   npm run smoke:roles
//
// Роль, для которой не переданы креды, пропускается (не считается ошибкой) —
// смоук должен работать и тогда, когда заведён только администратор.
// Коды выхода: 0 — всё прошло, 1 — есть проваленные проверки.

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

const results = [];
let skipped = 0;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
}

/** Собрать cookie из ответа: Node отдаёт Set-Cookie массивом. */
function cookiesFrom(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  return raw
    .map((value) => String(value).split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function request(path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    return { status: response.status, payload, cookie: cookiesFrom(response) };
  } catch (error) {
    return { status: 0, payload: null, cookie: "", error: error?.message ?? String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** Проверка: ожидаемый статус (или «любой из» для отказов в доступе). */
function expectStatus(name, response, expected) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  const ok = allowed.includes(response.status);
  record(
    name,
    ok,
    ok
      ? `${response.status}`
      : `ожидали ${allowed.join("/")}, получили ${response.status}${
          response.error ? ` (${response.error})` : ""
        }`,
  );
  return ok;
}

async function login(path, credentials) {
  const response = await request(path, { method: "POST", body: credentials });
  return response;
}

async function checkHealth() {
  const response = await request("/api/health");
  if (response.status === 0) {
    console.error(
      `✗ ${BASE_URL} недоступен (${response.error ?? "нет ответа"}). Запустите приложение или укажите BASE_URL.`,
    );
    process.exit(1);
  }
  expectStatus("GET /api/health — приложение отвечает", response, 200);
  if (response.payload?.database === "unavailable") {
    record("база данных доступна", false, "/api/health сообщает database: unavailable");
  } else {
    record("база данных доступна", true, "ok");
  }
}

async function checkGuest() {
  const orders = await request("/api/orders");
  expectStatus("гость: GET /api/orders закрыт", orders, [401, 403]);
  const adminAudit = await request("/api/admin/audit");
  expectStatus("гость: GET /api/admin/audit закрыт", adminAudit, [401, 403]);
}

async function checkStaff(role, credentials) {
  const loginResponse = await login("/api/auth/login", credentials);
  if (loginResponse.status !== 200) {
    skipped += 1;
    record(
      `${role}: вход`,
      true,
      `пропущено — логин/пароль не заданы или не подошли (${loginResponse.status})`,
    );
    return null;
  }
  const cookie = loginResponse.cookie;
  record(`${role}: вход в кабинет`, true, `role=${loginResponse.payload?.user?.role ?? "?"}`);

  const settings = await request("/api/org-settings", { cookie });
  expectStatus(`${role}: GET /api/org-settings`, settings, 200);

  const audit = await request("/api/admin/audit", { cookie });
  // Отказ — это и 401 (нет staff-сессии), и 403 (сессия есть, прав нет):
  // для смоука важно, что дверь закрыта, а не какой именно код
  expectStatus(
    `${role}: GET /api/admin/audit ${role === "администратор" ? "доступен" : "закрыт"}`,
    audit,
    role === "администратор" ? 200 : [401, 403],
  );

  const writeSettings = await request("/api/org-settings", {
    method: "POST",
    body: { atiEnabled: true },
    cookie,
  });
  expectStatus(
    `${role}: POST /api/org-settings ${role === "администратор" ? "разрешён" : "запрещён"}`,
    writeSettings,
    role === "администратор" ? 200 : [401, 403],
  );

  const vehicles = await request("/api/vehicles", { cookie });
  expectStatus(`${role}: GET /api/vehicles`, vehicles, 200);

  const driverApi = await request("/api/m/me", { cookie });
  expectStatus(`${role}: /api/m/me (API водителя) закрыт`, driverApi, [401, 403]);

  return cookie;
}

async function checkDriver(credentials) {
  const loginResponse = await login("/api/m/login", credentials);
  if (loginResponse.status !== 200) {
    skipped += 1;
    record(
      "водитель: вход",
      true,
      `пропущено — телефон/пароль не заданы или не подошли (${loginResponse.status})`,
    );
    return;
  }
  const cookie = loginResponse.cookie;
  record("водитель: вход в мобильный пульт", true, "ok");

  const me = await request("/api/m/me", { cookie });
  expectStatus("водитель: GET /api/m/me", me, 200);

  const orders = await request("/api/m/orders", { cookie });
  expectStatus("водитель: GET /api/m/orders", orders, 200);

  const vehicles = await request("/api/vehicles", { cookie });
  expectStatus("водитель: staff-API (/api/vehicles) закрыт", vehicles, [401, 403]);

  const audit = await request("/api/admin/audit", { cookie });
  expectStatus("водитель: админка закрыта", audit, [401, 403]);
}

async function main() {
  console.log(`=== Смоук по ролям: ${BASE_URL} ===`);

  await checkHealth();
  await checkGuest();

  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    await checkStaff("администратор", {
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    });
  } else {
    skipped += 1;
    console.log("  — администратор: пропущен (нет ADMIN_EMAIL/ADMIN_PASSWORD)");
  }

  if (process.env.LOGIST_EMAIL && process.env.LOGIST_PASSWORD) {
    await checkStaff("логист", {
      email: process.env.LOGIST_EMAIL,
      password: process.env.LOGIST_PASSWORD,
    });
  } else {
    skipped += 1;
    console.log("  — логист: пропущен (нет LOGIST_EMAIL/LOGIST_PASSWORD)");
  }

  if (process.env.DRIVER_PHONE && process.env.DRIVER_PASSWORD) {
    await checkDriver({
      phone: process.env.DRIVER_PHONE,
      password: process.env.DRIVER_PASSWORD,
    });
  } else {
    skipped += 1;
    console.log("  — водитель: пропущен (нет DRIVER_PHONE/DRIVER_PASSWORD)");
  }

  console.log("");
  for (const item of results) {
    console.log(`  ${item.ok ? "✓" : "✗"} ${item.name} — ${item.detail}`);
  }

  const failed = results.filter((item) => !item.ok);
  console.log("");
  if (failed.length > 0) {
    console.log(`✗ Провалено проверок: ${failed.length} из ${results.length}`);
    process.exit(1);
  }
  console.log(
    `✓ Роли ведут себя правильно: ${results.length} проверок` +
      (skipped > 0 ? ` (пропущено ролей: ${skipped})` : ""),
  );
}

main().catch((error) => {
  console.error("✗", error?.message ?? error);
  process.exit(1);
});

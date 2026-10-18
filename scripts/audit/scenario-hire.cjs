// A/B: полный путь найма — pending → одобрение → вход; и вход водителя по телефону.
const { ENV, Jar, csrf, login, call, Report } = require("./lib.cjs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const rep = new Report("A/B — найм, одобрение, вход водителя");

// Вход водителя: отдельная ручка /api/m/login (телефон + пароль), не общая /api/auth/login.
async function driverLogin(phone, password) {
  const jar = new Jar();
  const token = await csrf(jar);
  const res = await fetch(`${ENV.AUDIT_BASE_URL || "http://localhost:3000"}/api/m/login`, {
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
  if (admin.status !== 200) { rep.step("A", "вход админа", "BROKEN", `HTTP ${admin.status}`); rep.print(); return; }
  const A = admin.jar;

  // 1. инвайт-код
  const inv = await call(A, "POST", "/api/organization/invites", { role: "logist", maxUses: 1 });
  const code = inv.json?.invite?.code || inv.json?.code;
  rep.step("A", "инвайт-код создан", code ? "VERIFIED" : "BROKEN", `HTTP ${inv.status}`);

  // 2. регистрация сотрудника
  const email = `audit-hire-${Date.now()}@loginex.local`;
  const reg = await call(new Jar(), "POST", "/api/auth/register", {
    name: "Аудит Найм", email, password: "Audit-Passw0rd!2026", inviteCode: code, acceptedTerms: true,
  });
  rep.step("A", "сотрудник зарегистрирован", reg.status === 200 || reg.status === 201 ? "VERIFIED" : "BROKEN",
    `HTTP ${reg.status} ${reg.json?.error || ""}`.trim());

  // 3. до одобрения вход закрыт
  const before = await login(email, "Audit-Passw0rd!2026");
  rep.step("B", "до одобрения вход закрыт", before.status === 403 && before.json.code === "pending_approval"
    ? "VERIFIED" : "BROKEN", `HTTP ${before.status}, code=${before.json.code}`,
    { status: before.status, code: before.json.code });

  // 4. админ видит заявку
  const users = await call(A, "GET", "/api/auth/users");
  const arr = users.json?.users || users.json?.items || [];
  const pending = Array.isArray(arr) ? arr.filter((u) => u.status === "pending") : [];
  const mine = Array.isArray(arr) ? arr.find((u) => (u.email || "").toLowerCase() === email) : null;
  rep.step("A", "заявка видна администратору", mine ? "VERIFIED" : "BROKEN",
    `HTTP ${users.status}, заявок pending: ${pending.length}, наш сотрудник найден: ${!!mine}`,
    { pendingCount: pending.length, found: !!mine, status: mine?.status });

  // 5. одобрение
  let approved = false;
  if (mine) {
    const ap = await call(A, "PATCH", `/api/auth/users/${mine.id}`, { action: "approve" });
    approved = ap.status === 200;
    rep.step("A", "одобрение сотрудника", approved ? "VERIFIED" : "BROKEN",
      `HTTP ${ap.status} ${ap.json?.error || ""}`.trim(), { status: ap.status, error: ap.json?.error });
  }

  // 6. после одобрения вход работает
  if (approved) {
    const after = await login(email, "Audit-Passw0rd!2026");
    rep.step("A", "после одобрения сотрудник входит", after.status === 200 ? "VERIFIED" : "BROKEN",
      `HTTP ${after.status}, роль: ${after.json.user?.role}`, { role: after.json.user?.role });
    const st = await call(after.jar, "GET", "/api/dashboard/stats");
    rep.step("A", "одобренный сотрудник читает сводку", st.status === 200 ? "VERIFIED" : "BROKEN",
      `HTTP ${st.status}`);
    // и он НЕ владелец платформы
    const ov = await call(after.jar, "GET", "/api/admin/overview");
    rep.step("B", "логист не попадает в админку платформы", ov.status === 401 || ov.status === 403
      ? "VERIFIED" : "BROKEN", `HTTP ${ov.status}`);
    // блокировка сотрудника
    const sus = await call(A, "PATCH", `/api/auth/users/${mine.id}`, { action: "suspend", reason: "аудит" });
    const blocked = await login(email, "Audit-Passw0rd!2026");
    rep.step("B", "заблокированный сотрудник не входит",
      sus.status === 200 && blocked.status === 403 ? "VERIFIED" : "BROKEN",
      `блокировка HTTP ${sus.status}, вход после: HTTP ${blocked.status} code=${blocked.json.code}`);
  }

  // уборка
  const del = await prisma.user.deleteMany({ where: { email } });
  rep.step("A", "уборка тестового сотрудника", "VERIFIED", `удалено: ${del.count}`);

  // ===== ВОДИТЕЛЬ =====
  const drivers = await prisma.user.findMany({
    where: { role: "driver" }, select: { id: true, phone: true, email: true, status: true, name: true },
  });
  rep.step("G", "водители существуют в базе", drivers.length > 0 ? "VERIFIED" : "BROKEN",
    `водителей: ${drivers.length}; с email: ${drivers.filter((d) => d.email).length}; с телефоном: ${drivers.filter((d) => d.phone).length}`,
    { count: drivers.length, withEmail: drivers.filter((d) => d.email).length, withPhone: drivers.filter((d) => d.phone).length });

  const withPhone = drivers.find((d) => d.phone);
  if (withPhone) {
    // Пароль водителя неизвестен (создан ранее сидом) — сбрасываем его админом
    // и заодно проверяем сценарий B: администратор выдаёт временный пароль.
    const reset = await call(A, "PATCH", `/api/auth/users/${withPhone.id}`, { action: "resetPassword" });
    const temp = reset.json?.temporaryPassword || reset.json?.user?.temporaryPassword || reset.json?.password;
    rep.step("B", "администратор сбрасывает пароль водителя",
      reset.status === 200 && temp ? "VERIFIED" : "PARTIAL",
      `HTTP ${reset.status}, временный пароль получен: ${!!temp}`,
      { status: reset.status, hasTemp: !!temp });
    const dl = await driverLogin(withPhone.phone, temp || ENV.DRIVER_DEFAULT_PASSWORD);
    rep.step("G", "водитель входит по телефону", dl.status === 200 ? "VERIFIED" : "PARTIAL",
      `HTTP ${dl.status} ${dl.json?.error || ""}`.trim(), { status: dl.status, code: dl.json.code });
    if (dl.status === 200) {
      const me = await call(dl.jar, "GET", "/api/m/me");
      rep.step("G", "водитель видит свой профиль", me.status === 200 ? "VERIFIED" : "BROKEN", `HTTP ${me.status}`);
      const orders = await call(dl.jar, "GET", "/api/m/orders");
      rep.step("G", "водитель видит свои заказы", orders.status === 200 ? "VERIFIED" : "BROKEN", `HTTP ${orders.status}`);
      // водитель не видит чужие данные через staff-ручки
      const staff = await call(dl.jar, "GET", "/api/dashboard/stats");
      rep.step("B", "водитель не читает сводку компании",
        staff.status === 401 || staff.status === 403 ? "VERIFIED" : "BROKEN",
        `HTTP ${staff.status} (ожидалось 401/403)`, { status: staff.status });
      const allOrders = await call(dl.jar, "GET", "/api/orders");
      rep.step("B", "водитель не читает все заказы компании",
        allOrders.status === 401 || allOrders.status === 403 ? "VERIFIED" : "BROKEN",
        `HTTP ${allOrders.status} (ожидалось 401/403)`, { status: allOrders.status });
    }
  } else {
    rep.step("G", "водитель входит по телефону", "NOT_TESTED", "нет водителя с телефоном");
  }

  rep.print();
  require("fs").writeFileSync(require("path").join(__dirname, "report-hire.json"), JSON.stringify(rep.toJSON(), null, 2));
  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });

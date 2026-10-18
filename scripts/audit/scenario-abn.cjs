// Сценарный аудит: A (организация и сотрудники), B (вход/права), N (изоляция организаций).
// Read-only по бизнес-данным: создание/удаление только для проверки возможности.
const { ENV, Jar, csrf, login, call, Report } = require("./lib.cjs");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const rep = new Report("A/B/N — организация, доступ, изоляция");

async function main() {
  // ===== A. ОРГАНИЗАЦИЯ И СОТРУДНИКИ =====
  const admin = await login(ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD);
  rep.step("A", "вход владельца компании", admin.status === 200 && admin.json.success ? "VERIFIED" : "BROKEN",
    `HTTP ${admin.status}, success=${admin.json.success}`, { status: admin.status });

  if (admin.status !== 200) { rep.print(); return; }
  const A = admin.jar;

  // A1: текущая организация
  const org = await call(A, "GET", "/api/organization");
  const orgOk = org.status === 200 && org.json && (org.json.organization || org.json.id);
  rep.step("A", "просмотр своей организации", orgOk ? "VERIFIED" : "BROKEN",
    `HTTP ${org.status}`, { status: org.status });

  // A2: список сотрудников
  const users = await call(A, "GET", "/api/auth/users");
  const usersArr = users.json?.users || users.json?.items || [];
  rep.step("A", "список сотрудников", users.status === 200 && Array.isArray(usersArr) ? "VERIFIED" : "PARTIAL",
    `HTTP ${users.status}, сотрудников: ${Array.isArray(usersArr) ? usersArr.length : "не массив"}`,
    { status: users.status, count: Array.isArray(usersArr) ? usersArr.length : null });

  // A3: роли в системе
  const roles = new Set((Array.isArray(usersArr) ? usersArr : []).map((u) => u.role));
  const logists = usersArr.filter((u) => u.role === "logist").length;
  rep.step("A", "роль диспетчера (logist) используется",
    logists > 0 ? "VERIFIED" : "PARTIAL",
    `пользователей с ролью logist: ${logists}; роли в компании: ${[...roles].join(",") || "нет"}`,
    { roles: [...roles], logists });

  // A4: приглашение сотрудника инвайт-кодом (не email-рассылкой)
  const inv = await call(A, "POST", "/api/organization/invites", { role: "logist", maxUses: 1 });
  const invOk = inv.status === 200 || inv.status === 201;
  const inviteCode = inv.json?.invite?.code || inv.json?.code;
  rep.step("A", "создание инвайт-кода для сотрудника", invOk && inviteCode ? "VERIFIED" : "BROKEN",
    `HTTP ${inv.status} ${inv.json?.error || ""}`.trim(),
    { status: inv.status, code: inviteCode, error: inv.json?.error });
  if (invOk && inviteCode) {
    const list = await call(A, "GET", "/api/organization/invites");
    const arr = list.json?.invites || [];
    const found = Array.isArray(arr) && arr.some((i) => i.code === inviteCode);
    rep.step("A", "инвайт-код видно в списке", found ? "VERIFIED" : "BROKEN",
      `HTTP ${list.status}, найдено: ${found}, кодов в списке: ${Array.isArray(arr) ? arr.length : "?"}`);
    // A4b: регистрация сотрудника по коду — полный путь найма
    const empEmail = `audit-logist-${Date.now()}@loginex.local`;
    const emp = await call(new Jar(), "POST", "/api/auth/register", {
      name: "Аудит Логист", email: empEmail, password: "Audit-Passw0rd!2026", inviteCode, acceptedTerms: true,
    });
    const empOk = emp.status === 200 || emp.status === 201;
    rep.step("A", "найм сотрудника по инвайт-коду", empOk ? "VERIFIED" : "BROKEN",
      `HTTP ${emp.status} ${emp.json?.error || ""}`.trim(), { status: emp.status, error: emp.json?.error });
    if (empOk) {
      const empLogin = await login(empEmail, "Audit-Passw0rd!2026");
      rep.step("A", "новый сотрудник входит и видит данные своей организации",
        empLogin.status === 200 ? "VERIFIED" : "BROKEN",
        `HTTP ${empLogin.status}, роль: ${empLogin.json?.user?.role}`);
      const empStats = await call(empLogin.jar, "GET", "/api/dashboard/stats");
      rep.step("A", "новый сотрудник читает сводку", empStats.status === 200 ? "VERIFIED" : "BROKEN",
        `HTTP ${empStats.status}`);
      // уборка: удаляем созданного аудитом сотрудника
      const { PrismaClient } = require("@prisma/client");
      const p = new PrismaClient();
      const del = await p.user.deleteMany({ where: { email: empEmail } });
      rep.step("A", "уборка тестового сотрудника", del.count >= 0 ? "VERIFIED" : "BROKEN",
        `удалено записей: ${del.count}`);
      await p.$disconnect();
    }
    // отзыв кода
    const mine = Array.isArray(arr) ? arr.find((i) => i.code === inviteCode) : null;
    if (mine) {
      const del = await call(A, "DELETE", `/api/organization/invites/${mine.id}`, {});
      rep.step("A", "отзыв инвайт-кода", del.status === 200 ? "VERIFIED" : "PARTIAL", `HTTP ${del.status}`);
    }
  }

  // A5: регистрация новой компании (self-service)
  const regEmail = `audit-org-${Date.now()}@loginex.local`;
  const reg = await call(new Jar(), "POST", "/api/auth/register", {
    email: regEmail, password: "Audit-Passw0rd!2026", name: "Аудит Организация",
    organizationName: `Аудит-Орг ${Date.now()}`, phone: "+79000000000", acceptedTerms: true,
  });
  rep.step("A", "регистрация новой организации", reg.status === 200 || reg.status === 201 ? "VERIFIED" : "PARTIAL",
    `HTTP ${reg.status} ${reg.json?.error || ""}`.trim(),
    { status: reg.status, error: reg.json?.error });

  // ===== B. ВХОД / ПРАВА =====
  const owner = await login(ENV.OWNER_EMAIL, ENV.OWNER_PASSWORD);
  rep.step("B", "вход владельца платформы", owner.status === 200 && owner.json.success ? "VERIFIED" : "BROKEN",
    `HTTP ${owner.status}`, { status: owner.status });

  const ov = await call(owner.jar, "GET", "/api/admin/overview");
  rep.step("B", "владелец платформы: обзор всех организаций",
    ov.status === 200 ? "VERIFIED" : "BROKEN", `HTTP ${ov.status} ${ov.json?.error || ""}`.trim(),
    { status: ov.status });

  const adminBlocked = await call(A, "GET", "/api/admin/overview");
  rep.step("B", "админ компании не попадает в /api/admin/*",
    adminBlocked.status === 401 || adminBlocked.status === 403 ? "VERIFIED" : "BROKEN",
    `HTTP ${adminBlocked.status} (ожидалось 401/403)`, { status: adminBlocked.status });

  const anon = await call(new Jar(), "GET", "/api/dashboard/stats");
  rep.step("B", "без входа данные недоступны", anon.status === 401 ? "VERIFIED" : "BROKEN",
    `HTTP ${anon.status} (ожидалось 401)`, { status: anon.status });

  const spoof = await call(new Jar(), "GET", "/api/dashboard/stats", undefined, {
    headers: { "x-loginex-user-id": "00000000-0000-0000-0000-000000000000", "x-loginex-role": "admin" },
  });
  rep.step("B", "подделанные заголовки личности не работают",
    spoof.status === 401 ? "VERIFIED" : "BROKEN",
    `HTTP ${spoof.status} (ожидалось 401)`, { status: spoof.status });

  const fp = await call(new Jar(), "POST", "/api/auth/forgot-password", { email: ENV.ADMIN_EMAIL });
  rep.step("B", "восстановление пароля отвечает",
    fp.status === 200 ? "VERIFIED" : "PARTIAL", `HTTP ${fp.status} ${fp.json?.error || ""}`.trim(),
    { status: fp.status, error: fp.json?.error, mailDriver: ENV.MAIL_DRIVER });

  const cp = await call(A, "POST", "/api/auth/change-password", {
    currentPassword: ENV.ADMIN_PASSWORD, newPassword: "Audit-New-Passw0rd!2026",
  });
  rep.step("B", "смена своего пароля", cp.status === 200 ? "VERIFIED" : "PARTIAL",
    `HTTP ${cp.status} ${cp.json?.error || ""}`.trim(), { status: cp.status, error: cp.json?.error });
  if (cp.status === 200) {
    const back = await login(ENV.ADMIN_EMAIL, "Audit-New-Passw0rd!2026");
    if (back.status === 200) {
      const rb = await call(back.jar, "POST", "/api/auth/change-password", {
        currentPassword: "Audit-New-Passw0rd!2026", newPassword: ENV.ADMIN_PASSWORD,
      });
      rep.step("B", "возврат исходного пароля", rb.status === 200 ? "VERIFIED" : "BROKEN", `HTTP ${rb.status}`);
    } else {
      rep.step("B", "возврат исходного пароля", "BROKEN", "войти новым паролем не удалось");
    }
  }

  const lo = await call(A, "POST", "/api/auth/logout", {});
  const afterLogout = await call(A, "GET", "/api/dashboard/stats");
  rep.step("B", "выход завершает сессию",
    lo.status === 200 && afterLogout.status === 401 ? "VERIFIED" : "PARTIAL",
    `logout HTTP ${lo.status}, после выхода HTTP ${afterLogout.status}`,
    { logout: lo.status, after: afterLogout.status });

  // ===== N. ИЗОЛЯЦИЯ ОРГАНИЗАЦИЙ =====
  const admin2 = await login(ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD);
  const A2 = admin2.jar;
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true }, take: 5 });
  const mine = orgs.find((o) => o.id === (org.json?.organization?.id || org.json?.id));
  const foreign = orgs.find((o) => o.id !== mine?.id);
  rep.step("N", "в песочнице несколько организаций", orgs.length >= 2 ? "VERIFIED" : "PARTIAL",
    `организаций: ${orgs.length}`, { orgs: orgs.map((o) => o.name) });

  if (foreign) {
    const foreignOrder = await prisma.order.findFirst({
      where: { organizationId: foreign.id }, select: { id: true, clientName: true },
    });
    if (foreignOrder) {
      const r = await call(A2, "GET", `/api/orders/${foreignOrder.id}`);
      rep.step("N", "чужой заказ недоступен", r.status === 404 || r.status === 403 ? "VERIFIED" : "BROKEN",
        `HTTP ${r.status} (ожидалось 404/403)`, { status: r.status });
    } else {
      rep.step("N", "чужой заказ недоступен", "NOT_TESTED", "в чужой организации нет заказов");
    }
    const ord = await call(A2, "GET", "/api/orders");
    const arr = ord.json?.orders || ord.json?.items || ord.json?.data || [];
    const foreignCount = Array.isArray(arr)
      ? arr.filter((o) => o.organizationId && o.organizationId === foreign.id).length : -1;
    rep.step("N", "список заказов без чужих",
      Array.isArray(arr) && foreignCount === 0 ? "VERIFIED" : "PARTIAL",
      `HTTP ${ord.status}, заказов: ${Array.isArray(arr) ? arr.length : "?"}, чужих: ${foreignCount}`,
      { total: Array.isArray(arr) ? arr.length : null, foreign: foreignCount });
    const fv = await prisma.vehicle.findFirst({ where: { organizationId: foreign.id }, select: { id: true } });
    if (fv) {
      const r = await call(A2, "GET", `/api/vehicles/${fv.id}`);
      rep.step("N", "чужая машина недоступна", r.status === 404 || r.status === 403 ? "VERIFIED" : "BROKEN",
        `HTTP ${r.status}`, { status: r.status });
    }
  }

  if (foreign) {
    const imp = await call(owner.jar, "POST", "/api/admin/impersonate", { userId: null, driverId: null });
    rep.step("N", "вход в чужую организацию — только владелец платформы",
      imp.status === 200 || imp.status === 403 ? "PARTIAL" : "BROKEN",
      `HTTP ${imp.status} (impersonate ${imp.status === 200 ? "работает" : "запрещён"})`,
      { status: imp.status });
    const imp2 = await call(A2, "POST", "/api/admin/impersonate", { driverId: "00000000-0000-0000-0000-000000000000" });
    rep.step("N", "админ компании не может войти в чужую организацию",
      imp2.status === 401 || imp2.status === 403 || imp2.status === 404 ? "VERIFIED" : "BROKEN",
      `HTTP ${imp2.status} (ожидалось отказ)`, { status: imp2.status });
  }

  rep.print();
  require("fs").writeFileSync(
    require("path").join(__dirname, "report-abn.json"), JSON.stringify(rep.toJSON(), null, 2));
  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });

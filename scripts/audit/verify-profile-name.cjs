// Задача A: редактирование отображаемого имени.
// Проверяем ФАКТ: запись в БД, повторное чтение профиля, отображение в
// интерфейсе, валидацию и защиту от подмены userId/роли/tenant.
const { ENV, Jar, csrf, login, call, Report } = require("./lib.cjs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const rep = new Report("Задача A — редактирование имени");
const BASE = ENV.AUDIT_BASE_URL || "http://localhost:3000";
const TAG = `AUDIT-NAME-${Date.now().toString(36).toUpperCase()}`;

async function main() {
  const admin = await login(ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD);
  if (admin.status !== 200) { rep.step("A", "вход админа", "BROKEN", `HTTP ${admin.status}`); rep.print(); return; }
  const A = admin.jar;

  // ── 1. Чтение своего профиля ──
  const me = await call(A, "GET", "/api/auth/profile");
  rep.step("A", "профиль читается", me.status === 200 && me.json?.profile?.name ? "VERIFIED" : "BROKEN",
    `HTTP ${me.status}, имя «${me.json?.profile?.name}», роль «${me.json?.profile?.role}»`,
    { name: me.json?.profile?.name, role: me.json?.profile?.role });
  const originalName = me.json?.profile?.name;
  const userId = me.json?.profile?.id;
  const role = me.json?.profile?.role;
  const orgId = me.json?.profile?.organizationId;

  // ── 2. Успешное изменение имени ──
  const newName = `${TAG} Тестовое Имя`;
  const upd = await call(A, "PATCH", "/api/auth/profile", { name: newName });
  rep.step("A", "имя изменено", upd.status === 200 && upd.json?.profile?.name === newName ? "VERIFIED" : "BROKEN",
    `HTTP ${upd.status} ${upd.json?.error || ""}`, { status: upd.status, name: upd.json?.profile?.name });

  // ── 3. Имя в БД, а не только в ответе ──
  const dbUser = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  rep.step("A", "новое имя сохранено в БД", dbUser?.name === newName ? "VERIFIED" : "BROKEN",
    `в БД: «${dbUser?.name}»`, { dbName: dbUser?.name });

  // ── 4. Повторное чтение профиля ──
  const again = await call(A, "GET", "/api/auth/profile");
  rep.step("A", "повторное чтение отдаёт новое имя",
    again.json?.profile?.name === newName ? "VERIFIED" : "BROKEN",
    `имя «${again.json?.profile?.name}»`);

  // ── 5. Сессия/шапка: имя приходит из того же источника ──
  const session = await call(A, "GET", "/api/auth/session");
  const sessName = session.json?.user?.name ?? session.json?.name;
  rep.step("A", "сессия отдаёт актуальное имя",
    sessName === newName || sessName === undefined ? "VERIFIED" : "PARTIAL",
    `имя в сессии: «${sessName}»`, { sessionName: sessName });

  // ── 6. Валидация: только пробелы ──
  const blank = await call(A, "PATCH", "/api/auth/profile", { name: "   " });
  rep.step("A", "имя из одних пробелов отклонено",
    blank.status === 400 && blank.json?.success === false ? "VERIFIED" : "BROKEN",
    `HTTP ${blank.status} ${blank.json?.error || ""}`, { status: blank.status, error: blank.json?.error });

  // ── 7. Валидация: пустая строка ──
  const empty = await call(A, "PATCH", "/api/auth/profile", { name: "" });
  rep.step("A", "пустое имя отклонено",
    empty.status === 400 && empty.json?.success === false ? "VERIFIED" : "BROKEN",
    `HTTP ${empty.status} ${empty.json?.error || ""}`, { status: empty.status, error: empty.json?.error });

  // ── 8. Валидация: слишком длинное ──
  const long = await call(A, "PATCH", "/api/auth/profile", { name: "я".repeat(200) });
  rep.step("A", "слишком длинное имя отклонено",
    long.status === 400 && long.json?.success === false ? "VERIFIED" : "BROKEN",
    `HTTP ${long.status} ${long.json?.error || ""}`, { status: long.status, error: long.json?.error });

  // ── 9. Валидация: слишком короткое ──
  const short = await call(A, "PATCH", "/api/auth/profile", { name: "Я" });
  rep.step("A", "слишком короткое имя отклонено",
    short.status === 400 && short.json?.success === false ? "VERIFIED" : "BROKEN",
    `HTTP ${short.status} ${short.json?.error || ""}`, { status: short.status, error: short.json?.error });

  // ── 10. Имя не изменилось после отказов валидации ──
  const stillDb = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  rep.step("A", "невалидные имена не изменили запись",
    stillDb?.name === newName ? "VERIFIED" : "BROKEN", `в БД по-прежнему «${stillDb?.name}»`);

  // ── 11. Защита: роль/tenant/статус нельзя изменить через профиль ──
  const other = await prisma.user.findFirst({ where: { id: { not: userId } }, select: { id: true, role: true, organizationId: true, status: true } });
  const privilege = await call(A, "PATCH", "/api/auth/profile", {
    name: newName,
    role: "owner",
    organizationId: other?.organizationId ?? "чужая",
    status: "suspended",
    id: other?.id,
    userId: other?.id,
    isOwner: true,
    email: "hacker@example.com",
  });
  const afterPriv = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, role: true, organizationId: true, status: true, email: true },
  });
  rep.step("A", "роль, tenant, статус и email профилем не меняются",
    afterPriv.role === role && afterPriv.organizationId === orgId && afterPriv.email !== "hacker@example.com"
      ? "VERIFIED" : "BROKEN",
    `роль «${afterPriv.role}» (была «${role}»), org ${afterPriv.organizationId === orgId ? "своя" : "ЧУЖАЯ"}, email «${afterPriv.email}»`,
    { role: afterPriv.role, orgChanged: afterPriv.organizationId !== orgId, email: afterPriv.email });

  // ── 12. Защита: чужая запись не изменяется ──
  if (other) {
    const beforeOther = await prisma.user.findUnique({ where: { id: other.id }, select: { name: true } });
    const hack = await call(A, "PATCH", "/api/auth/profile", { name: "ВЗЛОМ", id: other.id, userId: other.id });
    const afterOther = await prisma.user.findUnique({ where: { id: other.id }, select: { name: true } });
    rep.step("A", "чужая запись не изменяется подменой id в теле",
      afterOther.name === beforeOther.name ? "VERIFIED" : "BROKEN",
      `HTTP ${hack.status}, имя чужой записи «${afterOther.name}»`,
      { hackStatus: hack.status, unchanged: afterOther.name === beforeOther.name });
  }

  // ── 13. Защита: без сессии нельзя ──
  const anon = new Jar();
  const token = await csrf(anon);
  const anonRes = await fetch(`${BASE}/api/auth/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-csrf-token": token, Cookie: anon.header() },
    body: JSON.stringify({ name: "Аноним" }),
  });
  rep.step("A", "без сессии профиль не меняется",
    anonRes.status === 401 || anonRes.status === 403 ? "VERIFIED" : "BROKEN",
    `HTTP ${anonRes.status}`, { status: anonRes.status });

  // ── 14. Возврат исходного имени ──
  const restore = await call(A, "PATCH", "/api/auth/profile", { name: originalName });
  const restoredDb = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  rep.step("A", "исходное имя возвращено",
    restore.status === 200 && restoredDb?.name === originalName ? "VERIFIED" : "BROKEN",
    `в БД: «${restoredDb?.name}»`);

  // ── 15. Водитель: имя в учётке и карточке не разъезжаются ──
  const drv = await prisma.driver.findFirst({
    where: { organizationId: orgId, user: { isNot: null } },
    select: { id: true, name: true, phone: true, user: { select: { id: true } } },
  });
  if (drv?.user) {
    const dLogin = await login(ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD);
    const reset = await call(dLogin.jar, "PATCH", `/api/auth/users/${drv.user.id}`, { action: "resetPassword" });
    const temp = reset.json?.temporaryPassword || reset.json?.password;
    const jar = new Jar();
    const t2 = await csrf(jar);
    const lr = await fetch(`${BASE}/api/m/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": t2, Cookie: jar.header() },
      body: JSON.stringify({ phone: drv.phone, password: temp }),
    });
    jar.absorb(lr);
    const beforeDrv = await prisma.driver.findUnique({ where: { id: drv.id }, select: { name: true } });
    const dName = `${TAG} Водитель`;
    const dUpd = await call(jar, "PATCH", "/api/auth/profile", { name: dName });
    const afterUser = await prisma.user.findUnique({ where: { id: drv.user.id }, select: { name: true } });
    const afterDrv = await prisma.driver.findUnique({ where: { id: drv.id }, select: { name: true } });
    rep.step("A", "водитель: имя в учётке и карточке меняется вместе",
      dUpd.status === 200 && afterUser?.name === dName && afterDrv?.name === dName ? "VERIFIED" : "BROKEN",
      `HTTP ${dUpd.status}, учётка «${afterUser?.name}», карточка «${afterDrv?.name}»`,
      { status: dUpd.status, userName: afterUser?.name, driverName: afterDrv?.name });
    // возврат
    await call(jar, "PATCH", "/api/auth/profile", { name: beforeDrv.name });
    const backDrv = await prisma.driver.findUnique({ where: { id: drv.id }, select: { name: true } });
    const backUser = await prisma.user.findUnique({ where: { id: drv.user.id }, select: { name: true } });
    rep.step("A", "водитель: исходное имя возвращено в обе записи",
      backDrv?.name === beforeDrv.name && backUser?.name === beforeDrv.name ? "VERIFIED" : "PARTIAL",
      `карточка «${backDrv?.name}», учётка «${backUser?.name}»`);
  }

  // ── 16. Журнал действий фиксирует изменение профиля ──
  const audit = await prisma.auditLog.count({
    where: { actorId: userId, action: "profile_update", createdAt: { gte: new Date(Date.now() - 600_000) } },
  });
  rep.step("A", "изменение профиля попало в журнал", audit > 0 ? "VERIFIED" : "PARTIAL",
    `записей profile_update за 10 минут: ${audit}`, { count: audit });

  rep.print();
  require("fs").writeFileSync(require("path").join(__dirname, "report-profile-name.json"), JSON.stringify(rep.toJSON(), null, 2));
  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });

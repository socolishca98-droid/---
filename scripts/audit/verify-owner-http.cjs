// Задача B (пульт владельца платформы), HTTP-часть.
//
// Проверяем РЕАЛЬНЫЕ сценарии, а не наличие файлов:
//   B1 вход владельца и отказ обычному пользователю;
//   B2 организации: все видны, поиск и фильтры, отсутствие смешения данных;
//   B3 подключение к компании и возврат, tenant isolation в режиме поддержки;
//   B4 журнал: реальные события, состав полей, отсутствие секретов;
//   B6 серверная безопасность всех /api/admin/*.
//
// Ничего не создаёт в базе, кроме штатных аудит-записей от самих действий.

const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const { ENV, BASE, Jar, csrf, login, call, Report, ROOT } = require("./lib.cjs");

const prisma = new PrismaClient();
const R = new Report("Пульт владельца платформы — HTTP");
const ORG_A = "cmv5l2v5l00007azufj22kezb"; // ИП Фролов
const ORG_B = "cmv66nfa000006vta1cnhvgsz"; // ООО С Согласием

// Черный список: то, чего не должно быть в ответах пульта
const SECRET_PATTERNS = [
  /passwordHash/i,
  /passwordSalt/i,
  /"password"\s*:/i,
  /resetToken/i,
  /Bearer\s+[A-Za-z0-9._-]{20,}/i,
  /sk-[A-Za-z0-9]{16,}/i,
];

function scanSecrets(label, json) {
  const text = typeof json === "string" ? json : JSON.stringify(json ?? "");
  const found = SECRET_PATTERNS.filter((re) => re.test(text));
  R.step("B6", `секреты не раскрываются: ${label}`, found.length === 0 ? "VERIFIED" : "BROKEN",
    found.length === 0 ? "шаблонов паролей/хэшей/токенов нет" : `найдено: ${found.join(", ")}`);
}

(async () => {
  // ─── Кто есть кто в песочнице ────────────────────────────────────────────
  const ownerEmail = ENV.OWNER_EMAIL;
  const adminA = await prisma.user.findFirst({ where: { email: ENV.ADMIN_EMAIL }, select: { id: true, name: true, email: true, organizationId: true, role: true } });
  const adminB = await prisma.user.findFirst({ where: { organizationId: ORG_B, role: "admin" }, select: { id: true, name: true, email: true, organizationId: true } });
  const driverA = await prisma.driver.findFirst({ where: { organizationId: ORG_A }, select: { id: true, name: true, organizationId: true } });
  R.step("B0", "тестовые данные найдены", adminA && adminB && driverA ? "VERIFIED" : "BROKEN",
    `владелец ${ownerEmail}; компания A: ${adminA?.name}; компания B: ${adminB?.name}; водитель A: ${driverA?.name}`);

  // ─── B1: вход владельца ─────────────────────────────────────────────────
  const owner = await login(ownerEmail, ENV.OWNER_PASSWORD);
  R.step("B1", "владелец входит своим паролем", owner.status === 200 ? "VERIFIED" : "BROKEN",
    `HTTP ${owner.status}, cookie: ${owner.jar.names().join(", ")}`);

  const ov = await call(owner.jar, "GET", "/api/admin/overview");
  R.step("B1", "владелец получает сводку платформы", ov.status === 200 && ov.json?.totals ? "VERIFIED" : "BROKEN",
    `HTTP ${ov.status}, компаний: ${ov.json?.totals?.organizations}, сотрудников: ${ov.json?.totals?.staff}, водителей: ${ov.json?.totals?.drivers}`);
  scanSecrets("GET /api/admin/overview", ov.json);

  // ─── B1: обычный пользователь не получает пульт ──────────────────────────
  const admin = await login(ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD);
  R.step("B1", "обычный администратор входит", admin.status === 200 ? "VERIFIED" : "BROKEN", `HTTP ${admin.status}`);

  for (const [name, method, url, body] of [
    ["overview", "GET", "/api/admin/overview", undefined],
    ["accounts", "GET", "/api/admin/accounts", undefined],
    ["journal", "GET", "/api/admin/journal", undefined],
    ["impersonate", "POST", "/api/admin/impersonate", { userId: adminB?.id }],
    ["accounts/[id]", "PATCH", `/api/admin/accounts/${encodeURIComponent(adminB?.id ?? "x")}`, { action: "suspend" }],
  ]) {
    const r = await call(admin.jar, method, url, body);
    R.step("B1", `обычный админ не проходит в /api/admin/${name}`, r.status === 403 ? "VERIFIED" : "BROKEN",
      `HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
  }

  // ─── B1: без сессии и с поддельными заголовками ─────────────────────────
  const noSession = new Jar();
  const r1 = await call(noSession, "GET", "/api/admin/overview");
  R.step("B1", "без сессии сводка недоступна", r1.status === 401 ? "VERIFIED" : "BROKEN", `HTTP ${r1.status}`);

  const forged = new Jar();
  await csrf(forged);
  const r2 = await call(forged, "GET", "/api/admin/overview", undefined, {
    headers: { "x-loginex-user-id": adminA.id, "x-loginex-role": "admin", "x-loginex-session-id": "fake" },
  });
  R.step("B1", "подделанные заголовки x-loginex-* не дают доступа", r2.status === 401 ? "VERIFIED" : "BROKEN",
    `HTTP ${r2.status} — ${JSON.stringify(r2.json).slice(0, 120)}`);

  const garbage = new Jar();
  garbage.map.set("loginex_staff_session", "loginex_staff_session=forged.token.value.aaaaaaaaaaaaaaaaaaaaaaaa");
  const r3 = await call(garbage, "GET", "/api/admin/overview");
  R.step("B1", "недействительный токен сессии не даёт доступа", r3.status === 401 ? "VERIFIED" : "BROKEN",
    `HTTP ${r3.status}`);

  // Сессия водителя
  const driver = new Jar();
  const dtok = await csrf(driver);
  const dlogin = await call(driver, "POST", "/api/m/login", { phone: "79161234502", password: ENV.DRIVER_DEFAULT_PASSWORD });
  R.step("B1", "водитель входит в мобильный контур", dlogin.status === 200 ? "VERIFIED" : "BROKEN", `HTTP ${dlogin.status}`);
  const r4 = await call(driver, "GET", "/api/admin/overview");
  R.step("B1", "сессия водителя не открывает пульт владельца", r4.status === 401 || r4.status === 403 ? "VERIFIED" : "BROKEN",
    `HTTP ${r4.status} ${JSON.stringify(r4.json).slice(0, 100)}`);

  // Метод, которого нет
  const r5 = await call(owner.jar, "DELETE", "/api/admin/overview", {});
  R.step("B6", "неописанный метод на /api/admin/overview не выполняется", r5.status === 405 ? "VERIFIED" : "PARTIAL",
    `HTTP ${r5.status} ${JSON.stringify(r5.json).slice(0, 100)}`);

  // ─── B2: организации ────────────────────────────────────────────────────
  const dbOrgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  const shownIds = (ov.json?.organizations ?? []).map((o) => o.id).sort();
  const dbIds = dbOrgs.map((o) => o.id).sort();
  R.step("B2", "владелец видит все компании", JSON.stringify(shownIds) === JSON.stringify(dbIds) ? "VERIFIED" : "BROKEN",
    `в ответе ${shownIds.length}, в базе ${dbIds.length}: ${(ov.json?.organizations ?? []).map((o) => o.name).join(" / ")}`);

  // Цифры по компании должны совпадать с базой (нет смешения данных)
  for (const org of dbOrgs) {
    const [staff, drivers, vehicles, routes, orders, clients] = await Promise.all([
      prisma.user.count({ where: { organizationId: org.id, role: { not: "driver" } } }),
      prisma.driver.count({ where: { organizationId: org.id } }),
      prisma.vehicle.count({ where: { organizationId: org.id } }),
      prisma.route.count({ where: { organizationId: org.id } }),
      prisma.order.count({ where: { organizationId: org.id } }),
      prisma.client.count({ where: { organizationId: org.id } }),
    ]);
    const shown = (ov.json?.organizations ?? []).find((o) => o.id === org.id);
    const same = shown && shown.staff === staff && shown.drivers === drivers && shown.vehicles === vehicles
      && shown.ordersDelivered + shown.ordersInWork === orders && shown.clients === clients;
    R.step("B2", `цифры компании «${org.name}» совпадают с базой`, same ? "VERIFIED" : "BROKEN",
      `показано staff=${shown?.staff} drivers=${shown?.drivers} vehicles=${shown?.vehicles} orders=${(shown?.ordersInWork ?? 0) + (shown?.ordersDelivered ?? 0)} clients=${shown?.clients}; в базе ${staff}/${drivers}/${vehicles}/${orders}/${clients}`);
  }

  // Поиск
  const acc = await call(owner.jar, "GET", "/api/admin/accounts");
  R.step("B2", "список аккаунтов отдаётся владельцу", acc.status === 200 && Array.isArray(acc.json?.organizations) ? "VERIFIED" : "BROKEN",
    `HTTP ${acc.status}, групп: ${acc.json?.organizations?.length}, итого: ${JSON.stringify(acc.json?.totals)}`);
  scanSecrets("GET /api/admin/accounts", acc.json);

  const searchName = "Кузнецов";
  const s1 = await call(owner.jar, "GET", `/api/admin/accounts?query=${encodeURIComponent(searchName)}`);
  const found = (s1.json?.organizations ?? []).flatMap((g) => [...g.users, ...g.drivers]).filter((x) => (x.name || "").includes(searchName));
  R.step("B2", `поиск по имени «${searchName}» находит водителя`, s1.status === 200 && found.length > 0 ? "VERIFIED" : "BROKEN",
    `HTTP ${s1.status}, найдено: ${found.map((f) => `${f.name} (${f.kind})`).join(", ") || "ничего"}`);

  const s2 = await call(owner.jar, "GET", `/api/admin/accounts?query=${encodeURIComponent(ENV.ADMIN_EMAIL)}`);
  const foundMail = (s2.json?.organizations ?? []).flatMap((g) => g.users).filter((x) => x.email === ENV.ADMIN_EMAIL);
  R.step("B2", "поиск по почте находит сотрудника", s2.status === 200 && foundMail.length === 1 ? "VERIFIED" : "BROKEN",
    `HTTP ${s2.status}, найдено: ${foundMail.map((f) => f.name).join(", ") || "ничего"}`);

  const s3 = await call(owner.jar, "GET", `/api/admin/accounts?query=${encodeURIComponent("9161234502")}`);
  const foundPhone = (s3.json?.organizations ?? []).flatMap((g) => g.drivers).filter((x) => (x.phone || "").includes("9161234502"));
  R.step("B2", "поиск по телефону находит водителя", s3.status === 200 && foundPhone.length > 0 ? "VERIFIED" : "BROKEN",
    `HTTP ${s3.status}, найдено: ${foundPhone.map((f) => f.name).join(", ") || "ничего"}`);

  const s4 = await call(owner.jar, "GET", "/api/admin/accounts?query=%D0%B8");
  const empty = (s4.json?.organizations ?? []).flatMap((g) => [...g.users, ...g.drivers]).length;
  R.step("B2", "однобуквенный поиск не вываливается ошибкой", s4.status === 200 ? "VERIFIED" : "PARTIAL", `HTTP ${s4.status}`);

  const s5 = await call(owner.jar, "GET", `/api/admin/accounts?query=${encodeURIComponent("зззззнетакого")}`);
  const none = (s5.json?.organizations ?? []).flatMap((g) => [...g.users, ...g.drivers]).length;
  R.step("B2", "поиск без результатов отдаёт пустой список, а не ошибку", s5.status === 200 && none === 0 ? "VERIFIED" : "BROKEN",
    `HTTP ${s5.status}, найдено: ${none}`);

  // Журнал: фильтр по компании не смешивает записи
  const jA = await call(owner.jar, "GET", `/api/admin/journal?organizationId=${ORG_A}&limit=200`);
  const jB = await call(owner.jar, "GET", `/api/admin/journal?organizationId=${ORG_B}&limit=200`);
  const onlyA = (jA.json?.items ?? []).every((i) => i.organizationId === ORG_A);
  const onlyB = (jB.json?.items ?? []).every((i) => i.organizationId === ORG_B);
  R.step("B2", "журнал по компании A содержит только её записи", jA.status === 200 && onlyA ? "VERIFIED" : "BROKEN",
    `HTTP ${jA.status}, записей: ${jA.json?.items?.length}, всего: ${jA.json?.total}`);
  R.step("B2", "журнал по компании B содержит только её записи", jB.status === 200 && onlyB ? "VERIFIED" : "BROKEN",
    `HTTP ${jB.status}, записей: ${jB.json?.items?.length}, всего: ${jB.json?.total}`);

  // Несуществующая компания
  const jNone = await call(owner.jar, "GET", "/api/admin/journal?organizationId=нет-такой&limit=5");
  R.step("B2", "журнал по несуществующей компании не падает", jNone.status === 200 && jNone.json?.total === 0 ? "VERIFIED" : "PARTIAL",
    `HTTP ${jNone.status}, всего: ${jNone.json?.total}`);

  // ─── B4: журнал ─────────────────────────────────────────────────────────
  const jAll = await call(owner.jar, "GET", "/api/admin/journal?limit=200");
  const items = jAll.json?.items ?? [];
  R.step("B4", "журнал отдаёт реальные записи", jAll.status === 200 && items.length > 0 ? "VERIFIED" : "BROKEN",
    `HTTP ${jAll.status}, записей: ${items.length}, всего: ${jAll.json?.total}`);
  const withAllFields = items.every((i) => i.createdAt && i.action && (i.targetType || i.targetEmail));
  R.step("B4", "в каждой записи есть время, действие и объект", withAllFields ? "VERIFIED" : "BROKEN",
    `проверено записей: ${items.length}`);
  const noActor = items.filter((i) => !i.actorEmail && !i.actorName && !i.actorPhone).length;
  R.step("B4", "субъект действия опознаётся в каждой записи", noActor === 0 ? "VERIFIED" : "BROKEN",
    noActor === 0
      ? `во всех записях есть исполнитель (у водителей подставляются имя и телефон: ${items.filter((i) => !i.actorEmail && i.actorName).length} записей)`
      : `в ${noActor} записях исполнитель неизвестен`);
  const withOrg = items.filter((i) => i.organizationName !== null || i.organizationId === null).length;
  R.step("B4", "запись привязана к компании (или помечена как вне компании)", withOrg === items.length ? "VERIFIED" : "PARTIAL",
    `с компаний: ${withOrg} из ${items.length}`);
  const withIp = items.filter((i) => i.ip).length;
  R.step("B4", "в записи есть IP (след запроса)", withIp === items.length ? "VERIFIED" : "PARTIAL",
    `с IP: ${withIp} из ${items.length}`);
  const withRequestId = items.filter((i) => i.requestId).length;
  const freshRows = items.slice(0, 20).filter((i) => i.requestId).length;
  R.step("B4", "в журнале есть request ID у новых действий", freshRows > 0 ? "VERIFIED" : "PARTIAL",
    `с request ID: ${withRequestId} из ${items.length}; среди 20 последних: ${freshRows}`);
  scanSecrets("GET /api/admin/journal", jAll.json);

  const actionCodes = [...new Set(items.map((i) => i.action))].sort();
  R.step("B4", "в журнале видны разные виды действий", actionCodes.length >= 3 ? "VERIFIED" : "PARTIAL",
    `действия: ${actionCodes.join(", ")}`);
  R.step("B4", "в журнале фиксируются входы", actionCodes.includes("login") ? "VERIFIED" : "BROKEN",
    actionCodes.includes("login") ? "действие login есть" : "действия login в журнале нет: входы не фиксируются");
  R.step("B4", "в журнале фиксируются подключение и завершение подключения",
    actionCodes.includes("impersonate") ? "VERIFIED" : "PARTIAL",
    actionCodes.includes("impersonate") ? "действие impersonate есть" : "impersonate пока не выполнялся в этом прогоне");

  // Фильтр по действию
  const jProfile = await call(owner.jar, "GET", "/api/admin/journal?action=profile_update&limit=5");
  const onlyProfile = (jProfile.json?.items ?? []).every((i) => i.action === "profile_update");
  R.step("B4", "фильтр журнала по действию работает", jProfile.status === 200 && onlyProfile && (jProfile.json?.items ?? []).length > 0 ? "VERIFIED" : "BROKEN",
    `HTTP ${jProfile.status}, записей: ${jProfile.json?.items?.length}`);

  // Ограничение limit
  const jBig = await call(owner.jar, "GET", "/api/admin/journal?limit=100000");
  R.step("B4", "журнал не отдаёт больше лимита за раз", jBig.status === 200 && (jBig.json?.items ?? []).length <= 200 ? "VERIFIED" : "PARTIAL",
    `запрошено 100000, отдано ${(jBig.json?.items ?? []).length}`);

  // ─── B3: подключение к компании ─────────────────────────────────────────
  // Внимание: после «входа как» cookie сотрудника в банке содержит ЧУЖУЮ
  // сессию — как в настоящем браузере. Поэтому каждый сценарий идёт своей
  // копией банки, а банка владельца остаётся нетронутой.
  const clone = (jar) => { const j = new Jar(); for (const [k, v] of jar.map) j.map.set(k, v); return j; };

  // Подключаемся к сотруднику компании B
  const impJar = clone(owner.jar);
  const imp = await call(impJar, "POST", "/api/admin/impersonate", { userId: adminB.id });
  R.step("B3", "владелец подключается к аккаунту компании B", imp.status === 200 && imp.json?.success ? "VERIFIED" : "BROKEN",
    `HTTP ${imp.status}, ${JSON.stringify(imp.json).slice(0, 200)}`);
  R.step("B3", "сервер указывает, куда открыть рабочее пространство", imp.json?.redirectTo ? "VERIFIED" : "BROKEN",
    `redirectTo: ${imp.json?.redirectTo}`);
  R.step("B3", "своя сессия владельца сохранена в отдельной cookie", impJar.names().includes("loginex_owner_session") ? "VERIFIED" : "BROKEN",
    `cookie: ${impJar.names().join(", ")}`);
  R.step("B3", "сессия выдана для целевого аккаунта", impJar.names().includes("loginex_staff_session") ? "VERIFIED" : "BROKEN",
    `cookie: ${impJar.names().join(", ")}`);
  R.step("B3", "в режиме поддержки действует сессия именно компании B",
    imp.json?.impersonating?.email === adminB.email ? "VERIFIED" : "BROKEN",
    `подключились к: ${imp.json?.impersonating?.name} (${imp.json?.impersonating?.email})`);

  // Подмена клиентского параметра не переносит в другую компанию
  const impForgedJar = clone(owner.jar);
  const impForged = await call(impForgedJar, "POST", "/api/admin/impersonate", { userId: adminB.id, organizationId: ORG_A, orgId: ORG_A, companyId: ORG_A });
  const forgedOk = impForged.status === 200 && impForged.json?.impersonating?.email === adminB.email;
  R.step("B3", "подмена organizationId в теле не переносит подключение в другую компанию", forgedOk ? "VERIFIED" : "BROKEN",
    `HTTP ${impForged.status}, подключились к: ${impForged.json?.impersonating?.name} (${impForged.json?.impersonating?.email}) — сервер берёт компанию из учётной записи`);

  // Контекст: чья сессия сейчас действует
  const sess = await call(impJar, "GET", "/api/auth/session");
  R.step("B3", "сессия показывает режим поддержки и владельца", sess.json?.impersonation?.email === ownerEmail ? "VERIFIED" : "BROKEN",
    `impersonation: ${JSON.stringify(sess.json?.impersonation)}, текущий пользователь: ${sess.json?.session?.user?.name}`);
  R.step("B3", "в режиме поддержки права владельца платформы не выдаются", sess.json?.isOwner === false ? "VERIFIED" : "BROKEN",
    `isOwner: ${sess.json?.isOwner}`);

  const ovAsB = await call(impJar, "GET", "/api/admin/overview");
  R.step("B3", "из режима компании нельзя открыть пульт владельца", ovAsB.status === 403 ? "VERIFIED" : "BROKEN",
    `HTTP ${ovAsB.status} ${JSON.stringify(ovAsB.json).slice(0, 120)}`);
  const accAsB = await call(impJar, "GET", "/api/admin/accounts");
  R.step("B3", "из режима компании нельзя получить список всех аккаунтов", accAsB.status === 403 ? "VERIFIED" : "BROKEN",
    `HTTP ${accAsB.status}`);
  const impAsB = await call(impJar, "POST", "/api/admin/impersonate", { userId: adminA.id });
  R.step("B3", "из режима компании нельзя подключиться к другому аккаунту", impAsB.status === 403 ? "VERIFIED" : "BROKEN",
    `HTTP ${impAsB.status}`);
  // Возврат возможен только с cookie владельца: тот, к кому подключились,
  // не может завершить подключение сам.
  const noOwnerCookieJar = clone(impJar);
  noOwnerCookieJar.map.delete("loginex_owner_session");
  const retAsB = await call(noOwnerCookieJar, "POST", "/api/admin/return", {});
  R.step("B3", "без cookie владельца подключение не завершается", retAsB.status === 401 ? "VERIFIED" : "BROKEN",
    `HTTP ${retAsB.status} ${JSON.stringify(retAsB.json).slice(0, 120)}`);

  // ─── B3: tenant isolation в режиме поддержки (данные компании A) ────────
  const impAJar = clone(owner.jar);
  const impA = await call(impAJar, "POST", "/api/admin/impersonate", { userId: adminA.id });
  R.step("B3", "владелец подключается к аккаунту компании A", impA.status === 200 && impA.json?.impersonating?.email === adminA.email ? "VERIFIED" : "BROKEN",
    `HTTP ${impA.status}, подключились к: ${impA.json?.impersonating?.name}`);

  const driversAsA = await call(impAJar, "GET", "/api/drivers");
  const dlist = Array.isArray(driversAsA.json?.drivers) ? driversAsA.json.drivers : (Array.isArray(driversAsA.json) ? driversAsA.json : []);
  const foreignDrivers = dlist.filter((d) => d.organizationId && d.organizationId !== ORG_A);
  const dbDriversA = await prisma.driver.count({ where: { organizationId: ORG_A } });
  R.step("B3", "режим поддержки не ломает tenant isolation: водители только своей компании",
    driversAsA.status === 200 && dlist.length === dbDriversA && foreignDrivers.length === 0 ? "VERIFIED" : "BROKEN",
    `HTTP ${driversAsA.status}, водителей: ${dlist.length} (в базе ${dbDriversA}), чужих: ${foreignDrivers.length}`);

  const ordersAsA = await call(impAJar, "GET", "/api/orders");
  const orders = Array.isArray(ordersAsA.json?.orders) ? ordersAsA.json.orders : [];
  const foreignOrders = orders.filter((o) => o.organizationId && o.organizationId !== ORG_A);
  const dbOrdersA = await prisma.order.count({ where: { organizationId: ORG_A } });
  R.step("B3", "режим поддержки не ломает tenant isolation: заказы только своей компании",
    ordersAsA.status === 200 && orders.length === dbOrdersA && foreignOrders.length === 0 ? "VERIFIED" : "BROKEN",
    `HTTP ${ordersAsA.status}, заказов: ${orders.length} (в базе ${dbOrdersA}), чужих: ${foreignOrders.length}`);

  const clientsAsA = await call(impAJar, "GET", "/api/clients");
  const clients = Array.isArray(clientsAsA.json?.clients) ? clientsAsA.json.clients : (Array.isArray(clientsAsA.json) ? clientsAsA.json : []);
  const foreignClients = clients.filter((c) => c.organizationId && c.organizationId !== ORG_A);
  const dbClientsA = await prisma.client.count({ where: { organizationId: ORG_A } });
  R.step("B3", "режим поддержки не ломает tenant isolation: клиенты только своей компании",
    clientsAsA.status === 200 && clients.length === dbClientsA && foreignClients.length === 0 ? "VERIFIED" : "BROKEN",
    `HTTP ${clientsAsA.status}, клиентов: ${clients.length} (в базе ${dbClientsA}), чужих: ${foreignClients.length}`);

  const usersAsA = await call(impAJar, "GET", "/api/auth/users");
  const users = Array.isArray(usersAsA.json?.users) ? usersAsA.json.users : (Array.isArray(usersAsA.json) ? usersAsA.json : []);
  const foreignUsers = users.filter((u) => u.organizationId && u.organizationId !== ORG_A);
  R.step("B3", "режим поддержки не ломает tenant isolation: сотрудники только своей компании",
    usersAsA.status === 200 && users.length > 0 && foreignUsers.length === 0 ? "VERIFIED" : "BROKEN",
    `HTTP ${usersAsA.status}, сотрудников: ${users.length}, чужих: ${foreignUsers.length}`);

  // ─── B3: возврат ────────────────────────────────────────────────────────
  const retJar = clone(impJar);
  const targetCookie = retJar.map.get("loginex_staff_session");
  const ret = await call(retJar, "POST", "/api/admin/return", {});
  R.step("B3", "возврат в пульт владельца работает", ret.status === 200 && ret.json?.success ? "VERIFIED" : "BROKEN",
    `HTTP ${ret.status}, redirectTo: ${ret.json?.redirectTo}`);
  R.step("B3", "после возврата cookie поддержки очищена", !retJar.names().includes("loginex_owner_session") ? "VERIFIED" : "BROKEN",
    `cookie после возврата: ${retJar.names().join(", ")}`);

  // Сессия чужого аккаунта отозвана
  const afterJar = new Jar();
  afterJar.map.set("loginex_staff_session", targetCookie);
  await csrf(afterJar);
  const afterRet = await call(afterJar, "GET", "/api/auth/session");
  const sessionGone = afterRet.status === 401 || !afterRet.json?.session;
  R.step("B3", "после возврата чужая сессия больше не действует", sessionGone ? "VERIFIED" : "BROKEN",
    `HTTP ${afterRet.status}, ${JSON.stringify(afterRet.json).slice(0, 160)}`);

  // Владелец снова у себя
  const sessBack = await call(retJar, "GET", "/api/auth/session");
  R.step("B3", "владелец вернулся к своей учётной записи", sessBack.json?.session?.user?.email === ownerEmail ? "VERIFIED" : "BROKEN",
    `пользователь: ${sessBack.json?.session?.user?.email}, impersonation: ${JSON.stringify(sessBack.json?.impersonation)}`);
  const ovBack = await call(retJar, "GET", "/api/admin/overview");
  R.step("B3", "после возврата пульт владельца снова доступен", ovBack.status === 200 ? "VERIFIED" : "BROKEN", `HTTP ${ovBack.status}`);

  // Возврат без сохранённой сессии владельца
  const noOwnerJar = new Jar();
  await csrf(noOwnerJar);
  const retNone = await call(noOwnerJar, "POST", "/api/admin/return", {});
  R.step("B3", "возврат без сессии владельца невозможен", retNone.status === 401 ? "VERIFIED" : "BROKEN",
    `HTTP ${retNone.status} ${JSON.stringify(retNone.json).slice(0, 120)}`);

  // ─── B3: вход как водитель ──────────────────────────────────────────────
  const impDrvJar = clone(owner.jar);
  const impDriver = await call(impDrvJar, "POST", "/api/admin/impersonate", { driverId: driverA.id });
  R.step("B3", "владелец подключается к водителю", impDriver.status === 200 && impDriver.json?.impersonating?.kind === "driver" ? "VERIFIED" : "BROKEN",
    `HTTP ${impDriver.status}, ${JSON.stringify(impDriver.json).slice(0, 200)}`);
  R.step("B3", "водителю выдана сессия водительского контура", impDrvJar.names().includes("loginex_driver_session") ? "VERIFIED" : "BROKEN",
    `cookie: ${impDrvJar.names().join(", ")}`);
  const mRoute = await call(impDrvJar, "GET", "/api/m/route");
  R.step("B3", "после подключения открывается мобильное пространство водителя", mRoute.status === 200 ? "VERIFIED" : "BROKEN",
    `HTTP ${mRoute.status}`);
  const driverOnlyJar = clone(impDrvJar);
  driverOnlyJar.map.delete("loginex_staff_session");
  driverOnlyJar.map.delete("loginex_owner_session");
  const ovAsDriver = await call(driverOnlyJar, "GET", "/api/admin/overview");
  R.step("B3", "из режима водителя нельзя открыть пульт владельца", ovAsDriver.status === 401 || ovAsDriver.status === 403 ? "VERIFIED" : "BROKEN",
    `HTTP ${ovAsDriver.status} ${JSON.stringify(ovAsDriver.json).slice(0, 100)}`);
  const accAsDriver = await call(driverOnlyJar, "GET", "/api/admin/accounts");
  R.step("B3", "из режима водителя нельзя получить список аккаунтов", accAsDriver.status === 401 || accAsDriver.status === 403 ? "VERIFIED" : "BROKEN",
    `HTTP ${accAsDriver.status}`);
  const impAsDriver = await call(driverOnlyJar, "POST", "/api/admin/impersonate", { userId: adminA.id });
  R.step("B3", "из режима водителя нельзя подключиться к другому аккаунту", impAsDriver.status === 401 || impAsDriver.status === 403 ? "VERIFIED" : "BROKEN",
    `HTTP ${impAsDriver.status}`);
  const retDriver = await call(impDrvJar, "POST", "/api/admin/return", {});
  R.step("B3", "возврат из режима водителя работает", retDriver.status === 200 ? "VERIFIED" : "BROKEN", `HTTP ${retDriver.status}`);
  const jEnd = await call(owner.jar, "GET", "/api/admin/journal?action=impersonation_end&limit=10");
  const endRows = (jEnd.json?.items ?? []).filter((i) => i.actorEmail === ownerEmail);
  R.step("B4", "завершение подключения записано в журнал", endRows.length > 0 ? "VERIFIED" : "BROKEN",
    endRows.length > 0 ? `записей impersonation_end: ${endRows.length}, последняя: ${endRows[0].organizationName ?? "вне компании"}, цель ${endRows[0].targetEmail ?? endRows[0].targetType}` : "записей о возврате нет");
  const driverCookieLeft = retDriver.jar === undefined ? retDriver : null;
  const driverCookieValue = impDrvJar.map.get("loginex_driver_session");
  R.step("B3", "после возврата водительская cookie очищена", !driverCookieValue ? "VERIFIED" : "BROKEN",
    driverCookieValue ? "cookie осталась" : "cookie очищена");

  // ─── B6: управление доступом ────────────────────────────────────────────
  // Самоотзыв и чужой владелец
  const selfAct = await call(owner.jar, "PATCH", `/api/admin/accounts/${encodeURIComponent(owner.json?.user?.id ?? "self")}`, { action: "suspend" });
  const selfId = await prisma.user.findFirst({ where: { email: ownerEmail }, select: { id: true } });
  const selfAct2 = await call(owner.jar, "PATCH", `/api/admin/accounts/${encodeURIComponent(selfId.id)}`, { action: "suspend" });
  R.step("B6", "владелец не может закрыть доступ самому себе", selfAct2.status === 400 ? "VERIFIED" : "BROKEN",
    `HTTP ${selfAct2.status} ${JSON.stringify(selfAct2.json).slice(0, 140)}`);

  const unknownAct = await call(owner.jar, "PATCH", `/api/admin/accounts/${encodeURIComponent(adminB.id)}`, { action: "deleteEverything" });
  R.step("B6", "неизвестное действие отклонено", unknownAct.status === 400 ? "VERIFIED" : "BROKEN",
    `HTTP ${unknownAct.status} ${JSON.stringify(unknownAct.json).slice(0, 140)}`);

  const missingAct = await call(owner.jar, "PATCH", `/api/admin/accounts/${encodeURIComponent(adminB.id)}`, {});
  R.step("B6", "действие без тела отклонено", missingAct.status === 400 ? "VERIFIED" : "BROKEN",
    `HTTP ${missingAct.status} ${JSON.stringify(missingAct.json).slice(0, 140)}`);

  const notFoundAct = await call(owner.jar, "PATCH", "/api/admin/accounts/нет-такого-id", { action: "suspend" });
  R.step("B6", "несуществующая учётная запись — 404, а не 500", notFoundAct.status === 404 ? "VERIFIED" : "BROKEN",
    `HTTP ${notFoundAct.status}`);

  // Завершение сессий без блокировки
  const revoke = await call(owner.jar, "PATCH", `/api/admin/accounts/${encodeURIComponent(adminB.id)}`, { action: "revokeSessions", reason: "АУДИТ-B проверка" });
  R.step("B6", "«Завершить сессии» работает и не закрывает доступ", revoke.status === 200 && revoke.json?.status === "active" ? "VERIFIED" : "BROKEN",
    `HTTP ${revoke.status}, статус: ${revoke.json?.status}, отозвано: ${revoke.json?.revokedSessions}`);
  const jRevoke = await call(owner.jar, "GET", "/api/admin/journal?action=sessions_revoked&limit=3");
  R.step("B6", "завершение сессий попало в журнал", (jRevoke.json?.items ?? []).some((i) => i.actorEmail === ownerEmail && i.organizationId === ORG_B) ? "VERIFIED" : "BROKEN",
    `записей: ${(jRevoke.json?.items ?? []).length}`);

  // Блокировка и разблокировка
  const suspend = await call(owner.jar, "PATCH", `/api/admin/accounts/${encodeURIComponent(adminB.id)}`, { action: "suspend", reason: "АУДИТ-B проверка доступа" });
  R.step("B6", "закрытие доступа работает", suspend.status === 200 && suspend.json?.status === "suspended" ? "VERIFIED" : "BROKEN",
    `HTTP ${suspend.status}, статус: ${suspend.json?.status}, сессий отозвано: ${suspend.json?.revokedSessions}`);
  const sessionsAfter = await prisma.session.count({ where: { userId: adminB.id, revokedAt: null } });
  R.step("B6", "после закрытия доступа живых сессий не осталось", sessionsAfter === 0 ? "VERIFIED" : "BROKEN",
    `живых сессий: ${sessionsAfter}`);
  const jSuspend = await call(owner.jar, "GET", "/api/admin/journal?action=deactivate&limit=3");
  R.step("B6", "закрытие доступа попало в журнал с компанией и владельцем",
    (jSuspend.json?.items ?? []).some((i) => i.actorEmail === ownerEmail && i.organizationId === ORG_B) ? "VERIFIED" : "BROKEN",
    `записей: ${(jSuspend.json?.items ?? []).length}`);

  const restore = await call(owner.jar, "PATCH", `/api/admin/accounts/${encodeURIComponent(adminB.id)}`, { action: "restore", reason: "АУДИТ-B возврат доступа" });
  R.step("B6", "открытие доступа работает", restore.status === 200 && restore.json?.status === "active" ? "VERIFIED" : "BROKEN",
    `HTTP ${restore.status}, статус: ${restore.json?.status}`);
  const dbStatus = await prisma.user.findUnique({ where: { id: adminB.id }, select: { status: true, suspendReason: true } });
  R.step("B6", "в базе доступ снова открыт, причина блокировки очищена", dbStatus?.status === "active" && dbStatus?.suspendReason === null ? "VERIFIED" : "BROKEN",
    `статус: ${dbStatus?.status}, причина: ${dbStatus?.suspendReason}`);

  const restoreAgain = await call(owner.jar, "PATCH", `/api/admin/accounts/${encodeURIComponent(adminB.id)}`, { action: "restore" });
  R.step("B6", "повторное открытие доступа не выполняется молча", restoreAgain.status === 400 ? "VERIFIED" : "PARTIAL",
    `HTTP ${restoreAgain.status} ${JSON.stringify(restoreAgain.json).slice(0, 120)}`);

  // Вход в закрытую учётную запись: сервер должен отказать, а не выдать
  // мёртвую сессию, после которой владелец выпадает на экран входа.
  const suspend2 = await call(owner.jar, "PATCH", `/api/admin/accounts/${encodeURIComponent(adminB.id)}`, { action: "suspend", reason: "АУДИТ-B проверка входа в закрытую учётку" });
  const impClosed = await call(owner.jar, "POST", "/api/admin/impersonate", { userId: adminB.id });
  R.step("B3", "войти в закрытую учётную запись нельзя", impClosed.status === 409 && !impClosed.json?.success ? "VERIFIED" : "BROKEN",
    `HTTP ${impClosed.status} ${JSON.stringify(impClosed.json).slice(0, 160)}`);

  // ─── B6: нет универсального API чтения/записи любых таблиц ──────────────
  const generic = [
    ["GET", "/api/admin/tables", undefined],
    ["GET", "/api/admin/db", undefined],
    ["POST", "/api/admin/query", { sql: "select 1" }],
    ["GET", "/api/admin/users", undefined],
    ["POST", "/api/admin/organizations", { name: "x" }],
  ];
  for (const [method, url, body] of generic) {
    const r = await call(owner.jar, method, url, body);
    R.step("B6", `универсального доступа к таблицам нет: ${method} ${url}`, r.status === 404 || r.status === 405 ? "VERIFIED" : "BROKEN",
      `HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 100)}`);
  }

  // ─── B5: ошибки отдаются понятно ────────────────────────────────────────
  const badJson = await call(owner.jar, "POST", "/api/admin/impersonate", {});
  R.step("B5", "запрос без тела отклоняется понятной ошибкой", badJson.status === 400 ? "VERIFIED" : "PARTIAL",
    `HTTP ${badJson.status} ${JSON.stringify(badJson.json).slice(0, 140)}`);
  const noTarget = await call(owner.jar, "POST", "/api/admin/impersonate", {});
  R.step("B5", "подключение без цели отклоняется понятной ошибкой", noTarget.status === 400 ? "VERIFIED" : "PARTIAL",
    `HTTP ${noTarget.status} ${JSON.stringify(noTarget.json).slice(0, 140)}`);
  const fakeTarget = await call(owner.jar, "POST", "/api/admin/impersonate", { userId: "нет-такого" });
  R.step("B5", "подключение к несуществующему аккаунту — 404, а не 500", fakeTarget.status === 404 ? "VERIFIED" : "BROKEN",
    `HTTP ${fakeTarget.status} ${JSON.stringify(fakeTarget.json).slice(0, 140)}`);

  // ─── Уборка: тестовая учётная запись компании B остаётся активной ────────
  const finalStatus = await prisma.user.findUnique({ where: { id: adminB.id }, select: { status: true } });
  if (finalStatus?.status !== "active") {
    const back = await call(owner.jar, "PATCH", `/api/admin/accounts/${encodeURIComponent(adminB.id)}`, { action: "restore", reason: "АУДИТ-B уборка" });
    R.step("B0", "после сценария доступ тестовой учётной записи открыт", back.status === 200 ? "VERIFIED" : "BROKEN",
      `HTTP ${back.status} ${JSON.stringify(back.json).slice(0, 100)}`);
  }

  await prisma.$disconnect();
  R.print();
  fs.writeFileSync(path.join(ROOT, "scripts/audit/report-owner-http.json"), JSON.stringify(R.toJSON(), null, 1));
  console.log("\nотчёт: scripts/audit/report-owner-http.json");
})().catch(async (e) => {
  console.error("СЦЕНАРИЙ УПАЛ:", e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});

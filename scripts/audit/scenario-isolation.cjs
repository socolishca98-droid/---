// N: изоляция организаций — попытка прочитать чужие данные каждой категорией.
const { ENV, Jar, csrf, login, call, Report } = require("./lib.cjs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const rep = new Report("N — изоляция организаций");

async function main() {
  const admin = await login(ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD);
  const A = admin.jar;
  const myOrg = (await call(A, "GET", "/api/organization")).json?.organization?.id;
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  const other = orgs.find((o) => o.id !== myOrg);
  if (!other) { rep.step("N", "есть вторая организация", "NOT_TESTED", "в песочнице одна организация"); rep.print(); return; }
  rep.step("N", "есть вторая организация", "VERIFIED", `«${other.name}»`);

  // Создаём во второй организации полный набор данных — иначе проверять нечего
  const seed = await call(A, "POST", "/api/auth/register", {
    name: "Аудит Вторая Орг", email: `audit-iso-${Date.now()}@loginex.local`,
    password: "Audit-Passw0rd!2026", organizationName: `Аудит-Изоляция ${Date.now()}`, acceptedTerms: true,
  });
  const newOrgId = (seed.json?.organization?.id) || (seed.json?.user?.organizationId);
  rep.step("N", "создана вторая организация для проверки", newOrgId ? "VERIFIED" : "PARTIAL",
    `HTTP ${seed.status}, организация: ${newOrgId ? "создана" : "не создана"}`);

  // Наполним её данными напрямую (это тестовая организация аудита)
  if (newOrgId) {
    const client = await prisma.client.create({
      data: {
        organizationId: newOrgId, name: "Аудит Чужой Клиент", nameKey: "аудит чужой клиент",
        phone: "+79001112233", inn: "7701000000",
      },
    });
    const order = await prisma.order.create({
      data: {
        organizationId: newOrgId, routeFrom: "Уфа, ул. Ленина, 1", routeTo: "Орёл, ул. Ленина, 2",
        clientId: client.id, clientName: "Аудит Чужой Клиент", price: 50000, distance: 400, weight: 5, cargoType: "Палеты", clientContact: "", status: "agreed", source: "manual", deadline: new Date(Date.now() + 86400000),
      },
    });
    const vehicle = await prisma.vehicle.create({
      data: { organizationId: newOrgId, plate: "А000АА777", brand: "Аудит", model: "Чужая", type: "truck", capacity: 5000 },
    });
    const driver = await prisma.driver.create({
      data: { organizationId: newOrgId, name: "Аудит Чужой Водитель", phone: "+79005556677", status: "available" },
    });

    const probes = [
      ["GET", `/api/orders/${order.id}`, "чужой заказ"],
      ["GET", `/api/orders/${order.id}/negotiation`, "переписка по чужому заказу"],
      ["GET", `/api/clients/${client.id}`, "чужой клиент"],
      ["GET", `/api/vehicles/${vehicle.id}`, "чужая машина"],
      ["GET", `/api/drivers/${driver.id}`, "чужой водитель"],
      ["GET", `/api/drivers/${driver.id}/location`, "геопозиция чужого водителя"],
      ["GET", `/api/drivers/${driver.id}/active-order`, "активный заказ чужого водителя"],
      ["GET", `/api/routes/${order.id}`, "чужой рейс (по id заказа)"],
      ["PATCH", `/api/orders/${order.id}`, "изменение чужого заказа"],
      ["PATCH", `/api/vehicles/${vehicle.id}`, "изменение чужой машины"],
      ["DELETE", `/api/clients/${client.id}`, "удаление чужого клиента"],
      ["GET", `/api/orders/${order.id}/negotiation`, "чужая переписка"],
      ["POST", `/api/orders/${order.id}/negotiation`, "запись в чужую переписку"],
      ["GET", `/api/photos/file?path=/uploads/${newOrgId}/2026/x.png`, "чужое фото по прямому пути"],
    ];
    for (const [method, url, label] of probes) {
      const r = await call(A, method, url, method === "GET" ? undefined : { price: 1 });
      const ok = r.status === 401 || r.status === 403 || r.status === 404;
      rep.step("N", label, ok ? "VERIFIED" : "BROKEN",
        `${method} ${url.split("?")[0]} → HTTP ${r.status} ${r.json?.error || ""}`.trim(),
        { status: r.status });
    }

    // Списочные ручки: чужих данных быть не должно
    for (const [url, label, key] of [
      ["/api/orders", "список заказов", "orders"],
      ["/api/clients", "список клиентов", "clients"],
      ["/api/vehicles", "список машин", "vehicles"],
      ["/api/drivers", "список водителей", "drivers"],
      ["/api/routes", "список рейсов", "routes"],
      ["/api/payments", "оплаты", "payments"],
      ["/api/reports", "отчёты", "report"],
    ]) {
      const r = await call(A, "GET", url);
      const arr = r.json?.[key];
      const leak = Array.isArray(arr) && arr.some((x) => x.organizationId && x.organizationId === newOrgId);
      const names = Array.isArray(arr) ? JSON.stringify(arr).includes("Аудит Чужой") : false;
      rep.step("N", `${label} без чужих записей`,
        Array.isArray(arr) && !leak && !names ? "VERIFIED" : Array.isArray(arr) ? "PARTIAL" : "NOT_TESTED",
        `HTTP ${r.status}, записей: ${arr?.length ?? "?"}, утечка по organizationId: ${leak}, по имени: ${names}`,
        { count: Array.isArray(arr) ? arr.length : null, leak, names });
    }

    // Владелец платформы видит всё — это его право
    const owner = await login(ENV.OWNER_EMAIL, ENV.OWNER_PASSWORD);
    const ov = await call(owner.jar, "GET", "/api/admin/overview");
    const orgCount = (ov.json?.organizations || ov.json?.orgs || []).length;
    rep.step("N", "владелец платформы видит все организации",
      ov.status === 200 && orgCount >= 2 ? "VERIFIED" : "PARTIAL",
      `HTTP ${ov.status}, организаций в обзоре: ${orgCount}`, { orgCount });

    // Уборка тестовой организации
    await prisma.order.deleteMany({ where: { organizationId: newOrgId } });
    await prisma.route.deleteMany({ where: { organizationId: newOrgId } });
    await prisma.driver.deleteMany({ where: { organizationId: newOrgId } });
    await prisma.vehicle.deleteMany({ where: { organizationId: newOrgId } });
    await prisma.client.deleteMany({ where: { organizationId: newOrgId } });
    await prisma.user.deleteMany({ where: { organizationId: newOrgId } });
    await prisma.organization.deleteMany({ where: { id: newOrgId } });
    rep.step("N", "уборка тестовой организации", "VERIFIED", "удалена");
  }

  rep.print();
  require("fs").writeFileSync(require("path").join(__dirname, "report-isolation.json"), JSON.stringify(rep.toJSON(), null, 2));
  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });

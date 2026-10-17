// Аудит: вход по ролям и получение сессионных cookie.
// Только чтение: ни одного POST, который меняет бизнес-данные.
const BASE = "http://localhost:3000";

async function absorb(res) { try { await res.arrayBuffer(); } catch {} return res; }

async function login(email, password) {
  const jar = new Map();
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const setC = csrfRes.headers.getSetCookie ? csrfRes.headers.getSetCookie() : [];
  for (const c of setC) jar.set(c.split(";")[0].split("=")[0], c);
  const csrfJson = await csrfRes.json().catch(() => ({}));
  const csrfToken = csrfJson.csrfToken;

  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": csrfToken || "",
      Cookie: [...jar.values()].join("; "),
    },
    body: JSON.stringify({ email, password }),
  });
  for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
    jar.set(c.split(";")[0].split("=")[0], c);
  }
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, jar };
}

async function main() {
  const out = {};
  // 1. Владелец компании (админ ИП Фролов)
  const admin = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  out.admin = { status: admin.status, ok: admin.json.success, role: admin.json.user?.role, name: admin.json.user?.name };
  console.log("ВХОД админ:", admin.status, JSON.stringify(out.admin));

  // 2. Владелец платформы
  const owner = await login(process.env.OWNER_EMAIL, process.env.OWNER_PASSWORD);
  out.owner = { status: owner.status, ok: owner.json.success, role: owner.json.user?.role, name: owner.json.user?.name };
  console.log("ВХОД владелец платформы:", owner.status, JSON.stringify(out.owner));

  // 3. Водитель (если есть пользователь-водитель)
  const { PrismaClient } = require("@prisma/client");
  const p = new PrismaClient();
  const drivers = await p.user.findMany({
    where: { role: "driver" },
    select: { email: true, name: true, status: true },
  });
  out.driverCount = drivers.length;
  console.log("Пользователи-водители:", drivers.length, drivers.map((d) => d.email).join(", "));
  await p.$disconnect();

  // 4. Неверный пароль (B: защита от перебора)
  const bad = await login(process.env.ADMIN_EMAIL, "wrong-password-" + Date.now());
  out.badPassword = { status: bad.status, code: bad.json.code, msg: bad.json.error };
  console.log("ВХОД неверный пароль:", bad.status, bad.json.code, "|", bad.json.error);

  // 5. Несуществующий пользователь
  const nobody = await login("no-such-user@example.invalid", "whatever12345");
  out.nobody = { status: nobody.status, code: nobody.json.code };
  console.log("ВХОД несуществующий:", nobody.status, nobody.json.code);

  console.log("\nJSON=" + JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });

// Проверка, что водительские учётки принимают DRIVER_DEFAULT_PASSWORD из .env.
// Браузерная приёмка задач 2–4 сбрасывала пароль водителя, поэтому после неё
// возвращаем значение и убеждаемся, что вход работает.
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "../..");
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (!m) continue;
  let v = m[2].trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  env[m[1]] = v;
}

(async () => {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  const drivers = await prisma.driver.findMany({
    where: { phone: { not: "" } },
    select: { id: true, name: true, phone: true, user: { select: { id: true } } },
    take: 2,
  });

  const base = env.AUDIT_BASE_URL || "http://localhost:3000";
  for (const d of drivers) {
    const csrf = await (await fetch(`${base}/api/auth/csrf`)).json();
    const res = await fetch(`${base}/api/m/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": csrf.csrfToken },
      body: JSON.stringify({ phone: d.phone, password: env.DRIVER_DEFAULT_PASSWORD }),
    });
    const json = await res.json().catch(() => ({}));
    console.log(`${d.name}: вход ${res.status} ${json.success ? "— ок" : JSON.stringify(json).slice(0, 90)}`);
  }
  await prisma.$disconnect();
})();

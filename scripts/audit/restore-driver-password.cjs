// Возврат пароля водителя к DRIVER_DEFAULT_PASSWORD из .env.
// Браузерная приёмка задач 2–4 сбрасывала пароль водителя через resetPassword,
// поэтому в песочнице остался временный. Сид seed:auth существующие пароли не
// перезаписывает, поэтому возвращаем значение явно.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const ROOT = path.resolve(__dirname, "../..");

const env = {};
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (!m) continue;
  let v = m[2].trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  env[m[1]] = v;
}

// Схема хранения: отдельные поля passwordHash и passwordSalt.
// scrypt — те же параметры, что в lib/auth/password.ts (N=16384, r=8, p=1).
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return { passwordHash: derived.toString("hex"), passwordSalt: salt.toString("hex") };
}

(async () => {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  const password = env.DRIVER_DEFAULT_PASSWORD;
  if (!password) {
    console.log("DRIVER_DEFAULT_PASSWORD не задан — нечего возвращать");
    await prisma.$disconnect();
    return;
  }
  const users = await prisma.user.findMany({
    where: { role: "driver" },
    select: { id: true, email: true, mustChangePassword: true },
  });
  for (const u of users) {
    await prisma.user.update({
      where: { id: u.id },
      data: { ...hashPassword(password), mustChangePassword: false },
    });
  }
  console.log(`пароль возвращён для ${users.length} водительских учёток`);
  await prisma.$disconnect();
})();

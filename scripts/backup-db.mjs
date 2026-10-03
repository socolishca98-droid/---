// scripts/backup-db.mjs
//
// Автобэкап базы данных с ротацией (пакет «Автобэкап БД»).
//
//   npm run backup:db                 — копия БД в backups/ + ротация
//   npm run backup:db -- --keep 30    — хранить 30 последних копий
//   npm run backup:db -- --dir D:\backups\loginex — своя папка назначения
//
// Как работает:
//   * SQLite (DATABASE_URL="file:./dev.db") — файл базы копируется в папку
//     backups/ под именем loginex-2026-10-02-213000-dev.db. Путь file:…
//     Prisma считает от папки prisma/, скрипт делает так же.
//   * PostgreSQL (DATABASE_URL="postgresql://…") — выгрузка через pg_dump
//     в формат custom (-Fc): loginex-2026-10-02-213000.dump. Восстановление:
//     pg_restore -d <база> --clean <файл>.
//   * Ротация: после копии удаляются самые старые файлы, сверх лимита --keep
//     (по умолчанию 14 — две недели ежедневных бэкапов).
//
// Настройка расписания (Windows): см. docs/backup-db.md — одна команда
// schtasks, бэкап каждый день в 03:00 без участия человека.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Аргументы и .env
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { keep: null, dir: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--keep" && argv[i + 1]) {
      const keep = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(keep) && keep > 0) args.keep = keep;
      i += 1;
    } else if (argv[i] === "--dir" && argv[i + 1]) {
      args.dir = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

/** DATABASE_URL из окружения или из .env (Next читает .env сам, node — нет). */
function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL.trim();
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return null;
  const text = fs.readFileSync(envPath, "utf8");
  const match = text.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?\s*$/m);
  return match ? match[1].trim() : null;
}

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

// ---------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------

function backupSqlite(url, backupDir, stamp) {
  // file:./dev.db → prisma/dev.db (Prisma хранит SQLite рядом со схемой)
  const relative = url.replace(/^file:/, "");
  const dbPath = path.isAbsolute(relative)
    ? relative
    : path.join(ROOT, "prisma", relative);

  if (!fs.existsSync(dbPath)) {
    console.error(`✗ Файл базы не найден: ${dbPath}`);
    console.error(
      "  Если база ещё не создавалась — запустите: npx prisma db push",
    );
    process.exit(1);
  }

  const name = `${path.basename(dbPath, ".db")}-${stamp}.db`;
  const target = path.join(backupDir, name);

  // Копируем файл целиком: приложением в этот момент лучше не писать в базу,
  // но для SQLite копия свежего файла — рабочая стратегия (журнал -journal,
  // если он есть, копируется рядом).
  fs.copyFileSync(dbPath, target);
  for (const suffix of ["-journal", "-wal", "-shm"]) {
    const side = `${dbPath}${suffix}`;
    if (fs.existsSync(side)) fs.copyFileSync(side, `${target}${suffix}`);
  }

  return target;
}

// ---------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------

function backupPostgres(url, backupDir, stamp) {
  const target = path.join(backupDir, `loginex-${stamp}.dump`);
  const result = spawnSync(
    "pg_dump",
    ["--format=custom", `--file=${target}`, url],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (result.error) {
    console.error(
      "✗ pg_dump не найден. Установите PostgreSQL-клиент и повторите.",
    );
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(
      `✗ pg_dump завершился с ошибкой: ${result.stderr?.toString().trim() || "неизвестно"}`,
    );
    process.exit(1);
  }

  return target;
}

// ---------------------------------------------------------------------------
// Ротация
// ---------------------------------------------------------------------------

function rotate(backupDir, keep) {
  const backups = fs
    .readdirSync(backupDir)
    .filter(
      (name) =>
        /^loginex-|^(dev|prod|test)\.db-/.test(name) ||
        /\.(db|dump)$/.test(name),
    )
    .map((name) => ({
      name,
      mtime: fs.statSync(path.join(backupDir, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  const removed = [];
  for (const old of backups.slice(keep)) {
    fs.rmSync(path.join(backupDir, old.name), { force: true });
    // у копии SQLite могут быть боковые файлы журнала — убираем и их
    for (const suffix of ["-journal", "-wal", "-shm"]) {
      fs.rmSync(path.join(backupDir, `${old.name}${suffix}`), { force: true });
    }
    removed.push(old.name);
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Точка входа
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const keep = args.keep ?? Number(process.env.BACKUP_KEEP ?? 14);

  const url = readDatabaseUrl();
  if (!url) {
    console.error(
      "✗ DATABASE_URL не задан: проверьте .env (пример — в .env.example)",
    );
    process.exit(1);
  }

  const backupDir = args.dir
    ? path.resolve(args.dir)
    : path.join(ROOT, "backups");
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = timestamp();
  let target;
  if (url.startsWith("postgresql://") || url.startsWith("postgres://")) {
    console.log("Бэкап PostgreSQL через pg_dump…");
    target = backupPostgres(url, backupDir, stamp);
  } else if (url.startsWith("file:")) {
    console.log("Бэкап SQLite: копирую файл базы…");
    target = backupSqlite(url, backupDir, stamp);
  } else {
    console.error(`✗ Непонятный DATABASE_URL: ${url.slice(0, 24)}…`);
    process.exit(1);
  }

  const sizeKb = Math.round(fs.statSync(target).size / 1024);
  const removed = rotate(backupDir, keep);

  console.log(`✓ Копия готова: ${target} (${sizeKb} КБ)`);
  console.log(`  Хранится последних копий: ${keep}`);
  if (removed.length > 0) {
    console.log(`  Удалены старые: ${removed.join(", ")}`);
  }
  console.log(
    "  Восстановление SQLite: скопируйте файл обратно в prisma/<имя>.db",
  );
}

main();

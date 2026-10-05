// scripts/restore-db.mjs
//
// Восстановление базы данных из бэкапа (пара к npm run backup:db).
//
//   npm run restore:db                    — восстановить из последней копии в backups/
//   npm run restore:db -- --list          — список доступных копий
//   npm run restore:db -- --file loginex-2026-10-02-213000-dev.db
//   npm run restore:db -- --yes           — без подтверждения (для скриптов)
//   npm run restore:db -- --dir D:\backups\loginex — своя папка бэкапов
//
// Как работает:
//   * SQLite (DATABASE_URL="file:./dev.db"): текущая база сначала сохраняется
//     как пре-рестор снапшот (dev.db.pre-restore-<метка>) — ошибочное
//     восстановление можно откатить. Устаревшие -journal/-wal/-shm удаляются:
//     они несовместимы с восстанавливаемым файлом и повредили бы базу.
//   * PostgreSQL (DATABASE_URL="postgresql://…"): pg_restore --clean --if-exists
//     (нужен клиент PostgreSQL, как и для бэкапа через pg_dump).
//   * Приложение во время восстановления не должно писать в базу —
//     остановите npm run dev до запуска скрипта.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Аргументы и .env
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { dir: null, file: null, list: false, yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir" && argv[i + 1]) {
      args.dir = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--file" && argv[i + 1]) {
      args.file = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--list") {
      args.list = true;
    } else if (argv[i] === "--yes" || argv[i] === "-y") {
      args.yes = true;
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

function backupsDir(args) {
  return args.dir ? path.resolve(args.dir) : path.join(ROOT, "backups");
}

/** Последняя копия подходящего типа: имена бэкапов сортируются хронологически. */
function findLatest(dir, isPostgres) {
  if (!fs.existsSync(dir)) return null;
  const ext = isPostgres ? ".dump" : ".db";
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(ext) && !name.includes(".pre-restore-"))
    .sort();
  return files.length > 0 ? path.join(dir, files[files.length - 1]) : null;
}

function confirm(question) {
  // Не интерактивный ввод (CI, планировщик): без --yes не восстанавливаем
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^(y|yes|да|д)$/i.test(answer.trim()));
    });
  });
}

// ---------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------

function dbPathFromUrl(url) {
  // file:./dev.db → prisma/dev.db (Prisma хранит SQLite рядом со схемой)
  const relative = url.replace(/^file:/, "");
  return path.isAbsolute(relative) ? relative : path.join(ROOT, "prisma", relative);
}

function restoreSqlite(url, backupFile) {
  const dbPath = dbPathFromUrl(url);

  if (fs.existsSync(dbPath)) {
    const snapshot = `${dbPath}.pre-restore-${timestamp()}`;
    fs.copyFileSync(dbPath, snapshot);
    console.log(`• Текущая база сохранена как пре-рестор снапшот: ${snapshot}`);
  }

  // Устаревшие журнал/WAL несовместимы с восстанавливаемым файлом — удаляем
  for (const suffix of ["-journal", "-wal", "-shm"]) {
    const side = `${dbPath}${suffix}`;
    if (fs.existsSync(side)) fs.rmSync(side);
  }

  fs.copyFileSync(backupFile, dbPath);

  // Если копия делалась вместе с журналом/WAL — возвращаем их рядом с базой
  for (const suffix of ["-journal", "-wal", "-shm"]) {
    const side = `${backupFile}${suffix}`;
    if (fs.existsSync(side)) fs.copyFileSync(side, `${dbPath}${suffix}`);
  }

  console.log(`✓ База восстановлена из копии: ${backupFile}`);
  console.log("  Если восстановление оказалось ошибочным — откатите снапшот .pre-restore-*.");
}

// ---------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------

function restorePostgres(url, backupFile) {
  const result = spawnSync(
    "pg_restore",
    ["--clean", "--if-exists", "-d", url, backupFile],
    { stdio: "inherit" },
  );

  if (result.error) {
    console.error("✗ pg_restore не найден. Установите PostgreSQL-клиент и повторите.");
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error("✗ pg_restore завершился с ошибкой.");
    process.exit(result.status ?? 1);
  }
  console.log(`✓ База восстановлена из копии: ${backupFile}`);
}

// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = readDatabaseUrl();
  if (!url) {
    console.error('✗ DATABASE_URL не задан (в окружении или в .env).');
    process.exit(1);
  }

  const isPostgres = url.startsWith("postgres");
  const dir = backupsDir(args);

  if (args.list) {
    if (!fs.existsSync(dir)) {
      console.log(`Папка бэкапов не найдена: ${dir}`);
      return;
    }
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".db") || name.endsWith(".dump"))
      .sort();
    if (files.length === 0) {
      console.log(`В папке ${dir} бэкапов нет.`);
      return;
    }
    console.log(`Бэкапы в ${dir}:`);
    for (const file of files) console.log(`  ${file}`);
    return;
  }

  const backupFile = args.file
    ? path.isAbsolute(args.file)
      ? args.file
      : path.join(dir, args.file)
    : findLatest(dir, isPostgres);

  if (!backupFile || !fs.existsSync(backupFile)) {
    console.error(
      `✗ Бэкап не найден${backupFile ? `: ${backupFile}` : ` в папке ${dir}`}`,
    );
    console.error("  Список копий: npm run restore:db -- --list");
    process.exit(1);
  }

  console.log(`Восстановление базы из: ${backupFile}`);
  console.log("Приложение во время восстановления не должно работать (остановите npm run dev).");

  if (!args.yes) {
    const ok = await confirm("Продолжить? (y/n) ");
    if (!ok) {
      console.log("Отменено.");
      return;
    }
  }

  if (isPostgres) restorePostgres(url, backupFile);
  else restoreSqlite(url, backupFile);
}

main().catch((error) => {
  console.error("✗", error?.message ?? error);
  process.exit(1);
});

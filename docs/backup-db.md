# Автобэкап базы данных

База — главный актив: заказы, клиенты, договорённости. Скрипт
`scripts/backup-db.mjs` делает копию и сам удаляет старые (ротация).

## Разовый бэкап

```powershell
npm run backup:db
```

Копия ложится в `backups/loginex-<дата>-dev.db` (SQLite) или
`loginex-<дата>.dump` (PostgreSQL через `pg_dump`). Папка `backups/`
в git не попадает.

## Параметры

```powershell
npm run backup:db -- --keep 30          # хранить 30 последних копий (по умолчанию 14)
npm run backup:db -- --dir D:\backups\loginex   # своя папка назначения (например, второй диск)
```

## Каждый день автоматически (Windows)

Одна команда в PowerShell — бэкап ежедневно в 03:00:

```powershell
schtasks /create /tn "Loginex Backup DB" /tr "cmd /c cd /d D:\logistics && npm run backup:db >> backups\backup.log 2>&1" /sc daily /st 03:00
```

Проверить, что задача создалась:

```powershell
schtasks /query /tn "Loginex Backup DB"
```

Удалить задачу:

```powershell
schtasks /delete /tn "Loginex Backup DB" /f
```

## Восстановление

**SQLite.** Остановите приложение (`Ctrl+C` в терминале с `npm run dev`),
скопируйте файл бэкапа обратно и запустите снова:

```powershell
Copy-Item D:\logistics\backups\dev-2026-10-02-030000.db D:\logistics\prisma\dev.db -Force
npm run dev
```

**PostgreSQL.** Восстановление из дампа формата custom:

```powershell
pg_restore -d "postgresql://loginex:ПАРОЛЬ@localhost:5432/loginex" --clean D:\logistics\backups\loginex-2026-10-02-030000.dump
```

## Что важно знать

- Перед копией SQLite лучше не писать в базу (ночью приложение обычно
  не работает — поэтому расписание на 03:00).
- Ротация хранит последние `--keep` копий: при ежедневном бэкапе и
  `--keep 14` в папке всегда две недели истории.
- Копию стоит периодически уносить с рабочей машины: внешний диск,
  облако, второй сервер. Бэкап на том же диске не спасёт от смерти диска.

## Восстановление

- `npm run restore:db` — восстановить из последней копии в `backups/`.
- `npm run restore:db -- --list` — список доступных копий.
- `npm run restore:db -- --file <имя>` — восстановить из конкретной копии.
- `npm run restore:db -- --yes` — без подтверждения (для скриптов).

Перед восстановлением SQLite текущая база сохраняется как пре-рестор снапшот
(`dev.db.pre-restore-<метка>`) — ошибочное восстановление можно откатить.
Приложение во время восстановления не должно работать (остановите `npm run dev`).
PostgreSQL восстанавливается через `pg_restore --clean --if-exists`.

#!/usr/bin/env bash
# scripts/push-branch.sh — пуш текущей ветки в GitHub.
#
# Зачем скрипт: снимок рабочей области не сохраняет .git/config, поэтому
# удалённый репозиторий (origin) периодически пропадает и push падает с
# «Could not read from remote repository». Скрипт добавляет origin обратно,
# если его нет, и пушит.
#
# Токен НЕ хранится в репозитории. Передаётся через переменную окружения:
#   GH_PAT=github_pat_xxx ./scripts/push-branch.sh [ветка]
#
# Без GH_PAT скрипт подскажет, что именно нужно передать.

set -euo pipefail

REMOTE_URL="https://github.com/socolishca98-droid/---.git"
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
USERNAME="socolishca98-droid"

cd "$(dirname "$0")/.."

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "origin пропал — добавляю $REMOTE_URL"
  git remote add origin "$REMOTE_URL"
fi

if [ -z "${GH_PAT:-}" ]; then
  echo "Нужен токен: GH_PAT=github_pat_... ./scripts/push-branch.sh $BRANCH" >&2
  exit 1
fi

git -c "credential.helper=!f() { echo \"username=$USERNAME\"; echo \"password=$GH_PAT\"; }; f" \
  push -u origin "$BRANCH"

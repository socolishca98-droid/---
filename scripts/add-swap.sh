#!/bin/bash
# scripts/add-swap.sh
#
# Добавляет файл подкачки, чтобы production-сборка Next.js не падала по
# памяти (код 137 = SIGKILL от ядра при нехватке ОЗУ).
#
# Зачем: в песочнице ~1.9 ГБ ОЗУ и НЕТ swap. Сборка Turbopack на пике требует
# больше, ядро убивает процесс мгновенно, и любой heap-limit бесполезен.
#
# Файл кладём в /var (реальный диск), НЕ в /tmp: /tmp здесь — tmpfs, то есть
# тот же ОЗУ, и swap в нём не дал бы ничего.
#
# Запуск: bash scripts/add-swap.sh [размер_МБ]

set -e

SIZE_MB="${1:-2048}"
SWAP_FILE="/var/swapfile"

if swapon --show 2>/dev/null | grep -q "$SWAP_FILE"; then
  echo "swap уже подключён:"
  swapon --show
  exit 0
fi

echo "Создаю swap-файл ${SIZE_MB} МБ в ${SWAP_FILE}..."
sudo -n dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$SIZE_MB" status=none
sudo -n chmod 600 "$SWAP_FILE"
sudo -n mkswap "$SWAP_FILE" > /dev/null
sudo -n swapon "$SWAP_FILE"

echo "Готово:"
free -m | head -3

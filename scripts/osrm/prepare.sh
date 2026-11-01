#!/usr/bin/env bash
# Подготовка данных OSRM: скачать карту и собрать граф.
#
#   ./prepare.sh russia              — вся Россия (~3,5 ГБ)
#   ./prepare.sh central-federal-district — ЦФО (быстро, для проверки)
#   ./prepare.sh russia --refresh    — перекачать свежий .pbf и пересобрать
#
# Скрипт идемпотентен: если граф уже собран и карта не обновилась, ничего не
# делает. Скачивание — с докачкой, чтобы обрыв на 3 ГБ не начинал заново.

set -euo pipefail

REGION="${1:-russia}"
REFRESH="${2:-}"
DATA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/deploy/osrm/data"

case "$REGION" in
  russia)
    URL="https://download.geofabrik.de/russia-latest.osm.pbf"
    ;;
  central-federal-district)
    URL="https://download.geofabrik.de/russia/central-fed-district-latest.osm.pbf"
    ;;
  *)
    echo "неизвестный регион: $REGION (есть russia, central-federal-district)" >&2
    exit 1
    ;;
esac

mkdir -p "$DATA_DIR"
cd "$DATA_DIR"

if [[ -f map.osrm && "$REFRESH" != "--refresh" ]]; then
  echo "граф уже собран: $(du -sh map.osrm | cut -f1). Для пересборки: $0 $REGION --refresh"
  exit 0
fi

echo "→ карта: $URL"
if [[ "$REFRESH" == "--refresh" ]]; then
  curl -L --fail --retry 5 --retry-delay 5 -C - -o map.osm.pbf.tmp "$URL"
  mv map.osm.pbf.tmp map.osm.pbf
elif [[ ! -f map.osm.pbf ]]; then
  curl -L --fail --retry 5 --retry-delay 5 -C - -o map.osm.pbf.tmp "$URL"
  mv map.osm.pbf.tmp map.osm.pbf
else
  echo "  файл уже есть: $(du -sh map.osm.pbf | cut -f1)"
fi

echo "→ сборка графа (это долго: 5–70 минут, зависит от региона и CPU)"
rm -f map.osrm*
docker compose -f "$(dirname "${BASH_SOURCE[0]}")/../../deploy/osrm/docker-compose.yml" \
  --profile prepare run --rm osrm-prepare

echo "→ готово. Запуск: docker compose -f deploy/osrm/docker-compose.yml up -d osrm"
echo "→ проверка: curl 'http://127.0.0.1:5000/route/v1/driving/37.7376,55.4207;37.6182,54.1961?overview=false'"

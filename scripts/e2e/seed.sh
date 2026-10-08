#!/usr/bin/env bash
# scripts/e2e/seed.sh — демо-мир для локального стенда.
#
# Зачем: живой прогон приложения (логист + водитель + заказы) требует данных,
# а база стенда пустая. Скрипт создаёт организацию, автопарк, водителя с
# паролем, клиента, базу ATI и пару заказов — ровно то, что видно в интерфейсе.
#
# Запуск:  BASE=http://127.0.0.1:3100 bash scripts/e2e/seed.sh
# Итог:    /tmp/e2e-ids.env со всеми идентификаторами для ручных проверок.
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:3100}"
STAFF_JAR=/tmp/e2e-staff.txt
DRIVER_JAR=/tmp/e2e-driver.txt
OUT=/tmp/e2e-ids.env
rm -f "$STAFF_JAR" "$DRIVER_JAR" "$OUT"

ADMIN_EMAIL="admin@e2e.test"
ADMIN_PASSWORD='Passw0rd!2345'
DRIVER_PHONE="+79990001122"
DRIVER_PASSWORD='DriverPass!2345'

csrf() {
  curl -s -c "$1" -b "$1" "$BASE/api/auth/csrf" | python3 -c 'import json,sys; print(json.load(sys.stdin)["csrfToken"])'
}

req() { # req METHOD PATH JSON [EXPECTED]
  local method="$1" path="$2" body="${3:-}" expected="${4:-200}"
  local args=(-s -b "$STAFF_JAR" -c "$STAFF_JAR" -X "$method" -H "X-CSRF-Token: $CSRF" -o /tmp/e2e-out.json -w '%{http_code}')
  [ -n "$body" ] && args+=(-H "Content-Type: application/json" -d "$body")
  local code
  code=$(curl "${args[@]}" "$BASE$path")
  if [ "$code" != "$expected" ]; then
    echo "✗ $method $path → $code (ждали $expected): $(head -c 300 /tmp/e2e-out.json)"
    exit 1
  fi
  echo "✓ $method $path"
}

field() { python3 -c "import json,sys;d=json.load(open('/tmp/e2e-out.json'));print(eval('d'+sys.argv[1]))" "$1"; }

# 1. Организация и администратор (первая регистрация становится владельцем)
CSRF=$(csrf "$STAFF_JAR")
req POST /api/auth/register "{\"name\":\"Админ Тестов\",\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\",\"organizationName\":\"ООО Тестовая Логистика\"}" 200
ORG_ID=$(field "['organization']['id']")

# Регистрация не входит в систему сама — входим отдельно (так же ведёт себя UI)
CSRF=$(csrf "$STAFF_JAR")
req POST /api/auth/login "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" 200
CSRF=$(csrf "$STAFF_JAR")

# 2. Автопарк: две машины
req POST /api/vehicles '{"plate":"А123ВС77","type":"Тент","brand":"КАМАЗ","model":"4308","capacity":20000}'
SMALL_VEHICLE_ID=$(field "['vehicle']['id']")
req POST /api/vehicles '{"plate":"В777АА50","type":"Фура","brand":"Volvo","model":"FH","capacity":40000}'
BIG_VEHICLE_ID=$(field "['vehicle']['id']")

# 3. Водитель: учётка создаётся вместе с карточкой, пароль меняет он сам
req POST /api/drivers "{\"name\":\"Иван Петров\",\"phone\":\"$DRIVER_PHONE\",\"vehicleId\":\"$BIG_VEHICLE_ID\"}"
DRIVER_ID=$(field "['driver']['id']")
TEMP_PASSWORD=$(field "['credentials']['temporaryPassword']")

CSRF=$(csrf "$DRIVER_JAR")
curl -s -b "$DRIVER_JAR" -c "$DRIVER_JAR" -X POST -H "Content-Type: application/json" \
  -d "{\"phone\":\"$DRIVER_PHONE\",\"password\":\"$TEMP_PASSWORD\"}" "$BASE/api/m/login" -o /dev/null
CSRF_DRIVER=$(csrf "$DRIVER_JAR")
curl -s -b "$DRIVER_JAR" -c "$DRIVER_JAR" -X POST -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF_DRIVER" \
  -d "{\"currentPassword\":\"$TEMP_PASSWORD\",\"newPassword\":\"$DRIVER_PASSWORD\"}" \
  "$BASE/api/auth/change-password" -o /dev/null

# 4. Клиент
CSRF=$(csrf "$STAFF_JAR")
req POST /api/clients '{"name":"ООО Ромашка","contactName":"Пётр Иванов","phone":"+79001234567","paymentType":"deferred","deferredDays":14}'
CLIENT_ID=$(field "['client']['id']")

# 5. База ATI (таблица кэша) — две груза, из которых собираются заказы
node "$(dirname "$0")/seed-cache.mjs" "${DATABASE_URL:-file:/tmp/e2e2/prisma/dev.db}"

req POST /api/orders/from-cache '{"cacheId":"seed-cache-1","fetchContacts":false}'
ORDER_1=$(field "['order']['id']")
req POST /api/orders/from-cache '{"cacheId":"seed-cache-2","fetchContacts":false}'
ORDER_2=$(field "['order']['id']")

cat > "$OUT" <<ENV
BASE=$BASE
ORG_ID=$ORG_ID
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
SMALL_VEHICLE_ID=$SMALL_VEHICLE_ID
BIG_VEHICLE_ID=$BIG_VEHICLE_ID
DRIVER_ID=$DRIVER_ID
DRIVER_PHONE=$DRIVER_PHONE
DRIVER_PASSWORD=$DRIVER_PASSWORD
CLIENT_ID=$CLIENT_ID
ORDER_1=$ORDER_1
ORDER_2=$ORDER_2
ENV

echo
echo "Демо-мир готов. Логист: $ADMIN_EMAIL / $ADMIN_PASSWORD, водитель: $DRIVER_PHONE / $DRIVER_PASSWORD"
echo "Идентификаторы: $OUT"

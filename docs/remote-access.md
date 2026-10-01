# Удалённый доступ к Loginex

Зачем: тестировать не только в своей сети — с телефонов водителей через
интернет, устанавливать мобильные контуры (`/s`, `/m`) как настоящие
приложения (PWA ставится только по https) и получать реальную геолокацию
(браузеры дают GPS только в защищённом контексте).

Приложение готово к работе «за доменом»: `npm start` слушает `0.0.0.0:3000`,
CSRF не привязан к имени хоста, cookie в production-режиме помечаются
`secure`. Ниже три пути — от «пять минут бесплатно» до постоянного сервера.

---

## Способ 1. Тоннель Cloudflare (бесплатно, 5 минут) — для тестов

Показывает ваш локальный `localhost:3000` в интернет по временному https-адресу.

```powershell
winget install --id Cloudflare.cloudflared
cd D:\logistics
npm run build
npm start
```

Вторым окном PowerShell:

```powershell
cloudflared tunnel --url http://localhost:3000
```

В консоли появится адрес вида `https://случайные-слова.trycloudflare.com` —
его и открывают тестировщики с любого телефона. Вход, PWA-установка и GPS
работают как на настоящем сайте.

Ограничения способа:

- адрес меняется при каждом перезапуске тоннеля;
- ваш компьютер должен быть включён и не спать
  (`Параметры → Система → Питание → Экран и спящий режим → Никогда`);
- это тестовый канал Cloudflare — для постоянной работы нужны способы 2–3.

Если подключаете АТИ: в `.env` укажите `APP_BASE_URL="https://<ваш-адрес-тоннеля>"`
и перезапустите `npm start` — на этот адрес АТИ будет возвращать после авторизации.

---

## Способ 2. Постоянный тоннель + свой домен (бесплатно, адрес не меняется)

Нужны: аккаунт Cloudflare и домен, добавленный в Cloudflare (достаточно
дешёвого домена за ~100 ₽/год).

```powershell
cloudflared tunnel login
cloudflared tunnel create loginex
cloudflared tunnel route dns loginex app.ваш-домен.ru
```

Создайте конфиг `C:\Users\<вы>\.cloudflared\config.yml`:

```yaml
tunnel: loginex
credentials-file: C:\Users\<вы>\.cloudflared\<id-тоннеля>.json

ingress:
  - hostname: app.ваш-домен.ru
    service: http://localhost:3000
  - service: http_status:404
```

Установить тоннель как службу Windows (стартует сам при включении ПК):

```powershell
cloudflared service install
```

Приложение держать запущенным: `npm start` (или поставьте его в автозапуск
планировщиком задач: `node_modules\.bin\pm2 start npm --name loginex -- start`).
В `.env`: `APP_BASE_URL="https://app.ваш-домен.ru"`.

---

## Способ 3. Сервер VPS (постоянная работа, ~400–600 ₽/мес)

Настоящий дом приложения: работает 24/7, не зависит от вашего компьютера.
Данных в программе пока нет — переносить нечего, разворачиваем с нуля.

Хостинг: любой VPS с Ubuntu 22.04/24.04 и 2 ГБ RAM (Hetzner, Timeweb, Aeza…).
Домен: A-запись `app.ваш-домен.ru` → IP сервера.

На сервере:

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# приложение
git clone https://github.com/socolishca98-droid/--- loginex
cd loginex && npm ci

# окружение
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"  # AUTH_SECRET
nano .env
#   DATABASE_URL="file:./prod.db"
#   AUTH_SECRET="<сгенерированный выше>"
#   APP_BASE_URL="https://app.ваш-домен.ru"
#   NEXT_PUBLIC_CARTO_API_KEY="<ключ ЦАРТО>"
#   PLATFORM_OWNER_EMAIL="<ваш email>"

# база и сборка
npx prisma db push
npm run build

# автозапуск
sudo npm i -g pm2
pm2 start npm --name loginex -- start
pm2 save && pm2 startup   # выполнить команду, которую выведет startup

# https одним файлом (Caddy сам получит и продлит сертификаты)
sudo apt-get install -y caddy
sudo nano /etc/caddy/Caddyfile
#   app.ваш-домен.ru {
#       reverse_proxy localhost:3000
#   }
sudo systemctl reload caddy

# firewall
sudo ufw allow 22,80,443/tcp && sudo ufw enable
```

Регистрация первого аккаунта — через `/register`, как обычно.

Резервная копия: вся база — один файл `prisma/prod.db` (плюс `.env`).
Достаточно периодически копировать его с сервера:

```bash
scp user@сервер:/home/user/loginex/prisma/prod.db ./backups/
```

---

## Чек-лист перед тем, как пускать посторонних

- [ ] `AUTH_SECRET` — длинный случайный (команда генерации выше), не из примеров;
- [ ] пароль администратора сменён на свой (первый вход заставляет сменить);
- [ ] `PLATFORM_OWNER_EMAIL` — ваш email, раздел «Владелец» виден только вам;
- [ ] приложение запущено через `npm run build && npm start`, а не `npm run dev`;
- [ ] для АТИ: `APP_BASE_URL` совпадает с публичным адресом, и этот же адрес
      указан в redirect URI приложения в кабинете АТИ;
- [ ] ключ ЦАРТО задан в `.env` (`NEXT_PUBLIC_CARTO_API_KEY`) — без него карта
      работает на запасной подложке.

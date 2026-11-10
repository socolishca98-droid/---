-- Дорожная геометрия нитки рейса для карты (и29: «маршрут по дорогам,
-- а не рядом»). Успешный ответ OSRM сохраняется навсегда: дороги
-- не меняются, а публичный маршрутизатор лимитирует по IP.
CREATE TABLE "RouteGeometryCache" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "coordinates" TEXT NOT NULL,
    "distanceKm" REAL NOT NULL,
    "durationMin" REAL NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

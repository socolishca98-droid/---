// scripts/register-path-alias.cjs
//
// ts-node компилирует TypeScript, но пути из tsconfig (`"@/*": ["./*"]`) не
// переписывает: в рантайме `require("@/lib/prisma")` падает с MODULE_NOT_FOUND.
// Поэтому сид-скрипты и миграции (npm run seed:auth, npm run db:migrate-*)
// подключают этот файл первым (`-r ./scripts/register-path-alias.cjs`) — он
// учит Node резолвить алиас `@/` от корня проекта.
//
// Заодно подменяет пакет `server-only`: он нужен сборке Next (защищает серверные
// модули от попадания в клиентский бандл), а в обычном Node-процессе только
// бросает исключение.

const path = require("node:path")
const Module = require("node:module")

const PROJECT_ROOT = path.resolve(__dirname, "..")
const EMPTY_MODULE = path.join(__dirname, "empty-module.cjs")

const originalResolve = Module._resolveFilename

Module._resolveFilename = function resolveWithAlias(request, ...rest) {
  if (typeof request === "string") {
    if (request.startsWith("@/")) {
      return originalResolve.call(this, path.join(PROJECT_ROOT, request.slice(2)), ...rest)
    }
    if (request === "server-only") return EMPTY_MODULE
  }
  return originalResolve.call(this, request, ...rest)
}

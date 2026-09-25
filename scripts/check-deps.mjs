// scripts/check-deps.mjs
//
// Ищет зависимости, которые больше не используются в коде.
//
// Зачем: после удаления мёртвых компонентов в package.json остаются пакеты
// (например, @radix-ui/react-toggle), которые тянут установку и обновления,
// но ни на что не влияют. Скрипт подсказывает, что можно убрать; решение
// принимает человек — пакет может быть нужен конфигурации или быть peer-ом.
//
// Запуск: node scripts/check-deps.mjs

import fs from "node:fs"
import path from "node:path"

const root = process.cwd()
const skipDirs = new Set(["node_modules", ".next", ".git", ".test-build", "public"])
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"))

const files = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(absolute)
      continue
    }
    if (!/\.(ts|tsx|mjs|js|css)$/.test(entry.name)) continue
    files.push(absolute)
  }
}
walk(root)

const sources = files.map((file) => fs.readFileSync(file, "utf-8")).join("\n")
/**
 * Пакеты, которые нужны сборке и среде выполнения, но не упоминаются в коде:
 * React DOM подключает Next, а @types/react-dom нужен типам JSX.
 */
const REQUIRED_BY_TOOLING = new Set([
  "react-dom",
  "@types/react-dom",
  "baseline-browser-mapping",
])

const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(
  (name) => !REQUIRED_BY_TOOLING.has(name),
)

const unused = declared.filter((name) => {
  // Пакеты со скоупом подключают целиком (@radix-ui/react-dialog) либо по
  // подпути (@radix-ui/react-dialog/…), поэтому ищем и полное имя, и короткое
  if (sources.includes(name)) return false
  if (name.startsWith("@")) {
    const short = name.split("/")[1]
    return !sources.includes(short)
  }
  return true
})

if (unused.length === 0) {
  console.log(`Зависимостей: ${declared.length}. Неиспользуемых не найдено.`)
} else {
  console.log(`Зависимостей: ${declared.length}. Похоже, не используются (${unused.length}):`)
  for (const name of unused.sort()) console.log("  " + name)
  console.log("\nУберите вручную: npm uninstall <пакет> — если только он не нужен сборке.")
}

// scripts/find-dead-code.mjs
//
// Поиск недостижимого кода: файлы, на которые никто не ссылается.
//
// Правило простое и намеренно осторожное: файл считается недостижимым, если
// его путь (без расширения) не встречается ни в одном другом файле проекта.
// Такой список — не приказ к удалению, а повод посмотреть: точные точки входа
// (Next подхватывает страницы и роуты сам) проверяются отдельно.
//
// Запуск: node scripts/find-dead-code.mjs

import fs from "node:fs"
import path from "node:path"

const root = process.cwd()
const searchDirs = ["app", "components", "lib", "hooks", "scripts", "tests", "__tests__"]
const skipDirs = new Set(["node_modules", ".next", ".test-build", ".git", "public"])

function collectFiles(dir) {
  const files = []
  if (!fs.existsSync(dir)) return files

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...collectFiles(absolute))
    else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) files.push(absolute)
  }
  return files
}

// Файлы в корне (proxy.ts, instrumentation.ts, next.config.mjs) тоже содержат
// импорты — без них проверка считала бы живые модули бесхозными
const rootFiles = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(ts|tsx|mjs|js)$/.test(entry.name))
  .map((entry) => path.join(root, entry.name))

// Корневые файлы — точки входа (их подхватывает Next, Vitest, сборщик):
// они участвуют как источники ссылок, но сами «бесхозными» не считаются
const projectFiles = searchDirs.flatMap((dir) => collectFiles(path.join(root, dir)))
const sources = new Map(
  [...projectFiles, ...rootFiles].map((file) => [file, fs.readFileSync(file, "utf-8")]),
)

/** Точки входа: их подхватывает Next или тесты — ссылок в коде у них не бывает */
function isEntryPoint(relative) {
  return (
    /^app\/.*\/(page|layout|route|loading|error|not-found|template|default)\.(ts|tsx)$/.test(relative) ||
    /^app\/(page|layout|route|global-error|not-found)\.(ts|tsx)$/.test(relative) ||
    /^app\/.*\.(ts|tsx)$/.test(relative) && relative.includes("/page.") ||
    /\.test\.(mjs|ts|tsx)$/.test(relative) ||
    relative.startsWith("scripts/") ||
    relative.startsWith("proxy.")
  )
}

const unreferenced = []

for (const file of projectFiles) {
  const relative = path.relative(root, file).split(path.sep).join("/")
  if (isEntryPoint(relative) || relative.endsWith(".d.ts")) continue

  const withoutExtension = relative.replace(/\.(tsx?|mjs|js)$/, "")
  const name = path.basename(withoutExtension)

  // Импорт каталога: `lib/eta/index.ts` подключают как "@/lib/eta"
  const directoryImport = name === "index" ? path.posix.dirname(withoutExtension) : null

  const referenced = [...sources.entries()].some(([otherFile, otherSource]) => {
    if (otherFile === file) return false
    const otherRelative = path.relative(root, otherFile).split(path.sep).join("/")
    return otherSource.includes(`/${withoutExtension}"`) ||
      otherSource.includes(`/${withoutExtension}'`) ||
      otherSource.includes(`@/${withoutExtension}"`) ||
      otherSource.includes(`@/${withoutExtension}'`) ||
      otherSource.includes(`/${name}"`) ||
      otherSource.includes(`/${name}'`) ||
      // относительные динамические импорты вида import("./lib/sentry")
      otherSource.includes(`"./${withoutExtension}"`) ||
      otherSource.includes(`'./${withoutExtension}'`) ||
      otherSource.includes(`"${name}"`) ||
      otherSource.includes(`'${name}'`) ||
      new RegExp(`[\"'/]${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\"']`).test(otherSource) ||
      new RegExp(`from\\s+[\"'][^\"']*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\"']`).test(otherSource) ||
      (directoryImport !== null &&
        (otherSource.includes(`/${directoryImport}"`) || otherSource.includes(`/${directoryImport}'`)))
  })

  if (!referenced) unreferenced.push(relative)
}

if (unreferenced.length === 0) {
  console.log(`Файлов проверено: ${projectFiles.length}. На бесхозные ничего не похоже.`)
} else {
  console.log(`Файлов проверено: ${projectFiles.length}. Без ссылок: ${unreferenced.length}`)
  for (const file of unreferenced.sort()) console.log("  " + file)
}

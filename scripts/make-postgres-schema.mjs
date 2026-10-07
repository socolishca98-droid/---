// scripts/make-postgres-schema.mjs — DEPRECATED
// Canonical schema is now `prisma/schema.prisma` (provider = postgresql).
// This script is kept for backward compatibility.

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const source = join(root, "prisma", "schema.prisma")
const target = join(root, "prisma", "schema.postgres.prisma")

console.log("DEPRECATED: Canonical schema moved to prisma/schema.prisma (provider = postgresql).")
console.log("This script is kept for backward compatibility only.")

const original = readFileSync(source, "utf8")

// Always generate from the canonical PostgreSQL schema (may be same file)
const postgres = original.includes('provider = "postgresql"')
  ? original
  : original.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"')

const banner = [
  "// prisma/schema.postgres.prisma — GENERATED FILE, deprecated.",
  "// Canonical schema: prisma/schema.prisma (provider = postgresql).",
  "",
].join("\n")

writeFileSync(target, banner + postgres, "utf8")

const models = (postgres.match(/^model\s+\w+/gm) || []).length
console.log(`✓ Generated: ${models} models (deprecated — use schema.prisma directly)`)

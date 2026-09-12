// scripts/clear-ati-cache.ts
import { prisma } from "../lib/prisma"

async function main() {
  const result = await prisma.atiCache.deleteMany({})
  console.log(`Deleted ${result.count} rows from AtiCache`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
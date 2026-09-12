// app/debug/page.tsx
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export default async function DebugPage() {
  try {
    // Читаем 50 последних записей напрямую из БД
    const items = await prisma.atiCache.findMany({
      take: 50,
      orderBy: { scannedAt: "desc" },
      select: {
        atiLoadId: true,
        routeFrom: true,
        routeFromId: true, // САМОЕ ВАЖНОЕ ПОЛЕ
        routeTo: true,
        routeToId: true,   // И ЭТО
        distance: true
      }
    })

    const count = await prisma.atiCache.count()

    return (
      <div className="p-8 font-mono text-xs bg-white text-black whitespace-pre-wrap">
        <h1>DEBUG DUMP (Total: {count})</h1>
        <hr className="my-4"/>
        {JSON.stringify(items, null, 2)}
      </div>
    )
  } catch (e: any) {
    return (
      <div className="p-8 text-red-600">
        <h1>ERROR:</h1>
        <pre>{e.message}</pre>
      </div>
    )
  }
}
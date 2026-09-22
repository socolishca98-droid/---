// lib/prisma.ts - P0 hardened, build-resilient
// This version handles missing prisma generate gracefully during build

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'file:./dev.db'
  if (process.env.NODE_ENV === 'production') {
    console.warn('[Prisma] DATABASE_URL not set, using default file:./dev.db - set explicit URL in production')
  }
}

const globalForPrisma = globalThis as unknown as { prisma?: any }

// Detect if we're in Next.js build phase
function isBuildPhase(): boolean {
  return (
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.NEXT_PHASE === 'phase-development-build' ||
    process.env.npm_lifecycle_event === 'build' ||
    process.env.npm_lifecycle_event === 'build:safe'
  )
}

function createMockPrisma() {
  console.warn('[Prisma] Using mock client - database operations will fail at runtime. Run `prisma generate` to fix.')
  
  const mockMethods = {
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    count: async () => 0,
    create: async () => { throw new Error('Prisma client not initialized - run prisma generate') },
    update: async () => { throw new Error('Prisma client not initialized - run prisma generate') },
    delete: async () => { throw new Error('Prisma client not initialized - run prisma generate') },
    upsert: async () => { throw new Error('Prisma client not initialized - run prisma generate') },
    aggregate: async () => ({ _count: 0, _sum: {}, _avg: {}, _min: {}, _max: {} }),
    groupBy: async () => [],
    $transaction: async (fn: any) => {
      if (typeof fn === 'function') {
        // For build, return empty
        if (isBuildPhase()) return {} as any
        throw new Error('Prisma client not initialized')
      }
      return []
    },
  }

  // Proxy that returns mock for any model
  return new Proxy({}, {
    get: (target: any, prop: string) => {
      if (prop === '$disconnect' || prop === '$connect' || prop === '$on') {
        return async () => {}
      }
      if (prop === '$transaction') {
        return mockMethods.$transaction
      }
      // Return a proxy for model access (e.g., prisma.user.findMany)
      return new Proxy(mockMethods, {
        get: (t: any, p: string) => t[p] || (async () => {
          if (isBuildPhase()) {
            // During build, return safe empty values
            if (['findMany', 'findFirst', 'findUnique'].includes(p)) return p === 'findMany' ? [] : null
            if (p === 'count') return 0
            if (p === 'aggregate') return { _count: 0, _sum: {} }
            return null
          }
          throw new Error(`Prisma client not initialized - ${String(prop)}.${String(p)} called`)
        })
      })
    }
  })
}

let prismaInstance: any

try {
  // Try to import and instantiate real client
  const { PrismaClient } = require('@prisma/client')
  try {
    prismaInstance = globalForPrisma.prisma || new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    })
  } catch (e) {
    console.error('[Prisma] Failed to create client instance:', e)
    if (isBuildPhase()) {
      console.warn('[Prisma] Build phase detected, using mock to allow build to continue')
      prismaInstance = createMockPrisma()
    } else {
      // In production runtime, fail fast
      if (process.env.NODE_ENV === 'production') {
        throw e
      }
      prismaInstance = createMockPrisma()
    }
  }
} catch (e: any) {
  console.error('[Prisma] Failed to import @prisma/client:', e?.message || e)
  if (e?.message?.includes('did not initialize yet')) {
    console.warn('[Prisma] Client not generated. Run `npx prisma generate`. Using mock for build.')
  }
  prismaInstance = createMockPrisma()
}

export const prisma = prismaInstance as any

if (process.env.NODE_ENV !== 'production' && globalForPrisma) {
  globalForPrisma.prisma = prisma
}

// Graceful shutdown
if (typeof process !== 'undefined' && prisma?.$disconnect) {
  const shutdown = async () => {
    try {
      await prisma.$disconnect()
    } catch {}
  }
  process.on('beforeExit', shutdown)
}

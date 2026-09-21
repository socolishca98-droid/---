// lib/prisma.ts

import { PrismaClient } from '@prisma/client'

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'file:./dev.db'
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

const noOp = {
  findMany: async () => [],
  findFirst: async () => null,
  findUnique: async () => null,
  count: async () => 0,
  create: async (d: any) => d?.data ?? {},
  update: async (d: any) => d?.data ?? {},
  delete: async () => ({}),
  upsert: async (d: any) => d?.create ?? {},
}

let prismaInstance: PrismaClient

try {
  prismaInstance = globalForPrisma.prisma || new PrismaClient()
} catch (e) {
  console.warn('[AI Studio] Database not connected — using mock', e)
  prismaInstance = new Proxy({}, {
    get: () => new Proxy(noOp, {
      get: (target: any, prop: string) => target[prop] || (async () => null),
    }),
  }) as unknown as PrismaClient
}

export const prisma = prismaInstance

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
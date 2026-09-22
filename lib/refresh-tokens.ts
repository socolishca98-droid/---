// lib/refresh-tokens.ts - In-memory refresh token store with rotation (P1-5)
import crypto from "node:crypto"

type RefreshEntry = {
  jti: string
  userId: string
  role: "admin" | "logist" | "driver"
  expiresAt: number // ms timestamp
  createdAt: number
  ip?: string
}

const store = new Map<string, RefreshEntry>() // jti -> entry
const byUser = new Map<string, Set<string>>() // userId -> set of jti

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000 // 1h
let cleanupTimer: NodeJS.Timeout | null = null

function ensureCleanupTimer() {
  if (cleanupTimer) return
  if (typeof setInterval === "undefined") return
  cleanupTimer = setInterval(() => {
    cleanupExpired()
  }, CLEANUP_INTERVAL_MS)
  // Don't block process exit
  if (cleanupTimer && typeof (cleanupTimer as any).unref === "function") {
    ;(cleanupTimer as any).unref()
  }
}

function cleanupExpired() {
  const now = Date.now()
  for (const [jti, entry] of store.entries()) {
    if (entry.expiresAt < now) {
      store.delete(jti)
      const set = byUser.get(entry.userId)
      if (set) {
        set.delete(jti)
        if (set.size === 0) byUser.delete(entry.userId)
      }
    }
  }
  // If too large, prune oldest
  if (store.size > 5000) {
    const entries = Array.from(store.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt)
    const toRemove = entries.slice(0, 1000)
    for (const [jti, entry] of toRemove) {
      store.delete(jti)
      const set = byUser.get(entry.userId)
      if (set) {
        set.delete(jti)
        if (set.size === 0) byUser.delete(entry.userId)
      }
    }
  }
}

export function generateJti(): string {
  return crypto.randomBytes(16).toString("hex")
}

export function createRefreshEntry(params: {
  jti: string
  userId: string
  role: "admin" | "logist" | "driver"
  expiresInMs: number
  ip?: string
}): RefreshEntry {
  ensureCleanupTimer()
  const now = Date.now()
  const entry: RefreshEntry = {
    jti: params.jti,
    userId: params.userId,
    role: params.role,
    expiresAt: now + params.expiresInMs,
    createdAt: now,
    ip: params.ip,
  }
  store.set(params.jti, entry)
  let set = byUser.get(params.userId)
  if (!set) {
    set = new Set()
    byUser.set(params.userId, set)
  }
  set.add(params.jti)

  // Limit to 5 active refresh tokens per user (for rotation)
  if (set.size > 5) {
    // Remove oldest
    const jtis = Array.from(set)
    const entries = jtis
      .map((j) => store.get(j))
      .filter(Boolean) as RefreshEntry[]
    entries.sort((a, b) => a.createdAt - b.createdAt)
    const oldest = entries[0]
    if (oldest) {
      store.delete(oldest.jti)
      set.delete(oldest.jti)
    }
  }

  return entry
}

export function getRefreshEntry(jti: string): RefreshEntry | null {
  const entry = store.get(jti) || null
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    // expired, clean up
    store.delete(jti)
    const set = byUser.get(entry.userId)
    if (set) {
      set.delete(jti)
      if (set.size === 0) byUser.delete(entry.userId)
    }
    return null
  }
  return entry
}

export function revokeRefreshToken(jti: string): void {
  const entry = store.get(jti)
  if (!entry) return
  store.delete(jti)
  const set = byUser.get(entry.userId)
  if (set) {
    set.delete(jti)
    if (set.size === 0) byUser.delete(entry.userId)
  }
}

export function revokeAllForUser(userId: string): void {
  const set = byUser.get(userId)
  if (!set) return
  for (const jti of set) {
    store.delete(jti)
  }
  byUser.delete(userId)
}

export function rotateRefreshToken(oldJti: string, newJti: string, newExpiresInMs: number): RefreshEntry | null {
  const oldEntry = getRefreshEntry(oldJti)
  if (!oldEntry) return null
  // Revoke old
  revokeRefreshToken(oldJti)
  // Create new with same userId/role
  return createRefreshEntry({
    jti: newJti,
    userId: oldEntry.userId,
    role: oldEntry.role,
    expiresInMs: newExpiresInMs,
    ip: oldEntry.ip,
  })
}

// For testing/debugging
export function _getStoreSize(): number {
  return store.size
}

export function _clearAll(): void {
  store.clear()
  byUser.clear()
}

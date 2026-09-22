// lib/jwt-edge.ts - P0 hardened
// Edge-compatible JWT verification using Web Crypto API

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/")
  while (base64.length % 4) {
    base64 += "="
  }
  return atob(base64)
}

export async function verifyJwtEdge<T = any>(token: string, secret: string): Promise<T | null> {
  try {
    if (!token || !secret) return null
    if (secret.length < 16) {
      console.warn('[JWT Edge] Secret too short')
      return null
    }
    const parts = token.split(".")
    if (parts.length !== 3) return null

    const [headerB64, payloadB64, signatureB64] = parts
    const data = `${headerB64}.${payloadB64}`

    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    )

    // Decode signature
    let sigBase64 = signatureB64.replace(/-/g, "+").replace(/_/g, "/")
    while (sigBase64.length % 4) {
      sigBase64 += "="
    }
    const sigBinary = atob(sigBase64)
    const sigBytes = new Uint8Array(sigBinary.length)
    for (let i = 0; i < sigBinary.length; i++) {
      sigBytes[i] = sigBinary.charCodeAt(i)
    }

    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      enc.encode(data)
    )

    if (!isValid) return null

    const payload = JSON.parse(base64UrlDecode(payloadB64))
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null
    }

    return payload as T
  } catch (e) {
    return null
  }
}

function isBuildPhaseEdge(): boolean {
  return (
    (process.env as any).NEXT_PHASE === 'phase-production-build' ||
    (process.env as any).NEXT_PHASE === 'phase-development-build' ||
    process.env.npm_lifecycle_event === 'build' ||
    process.env.npm_lifecycle_event === 'build:safe'
  )
}

export function getEdgeSecret(): string {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production' && !isBuildPhaseEdge()) {
      throw new Error('AUTH_SECRET required in production')
    }
    return "loginex_dev_secret_only_for_local_development_do_not_use_in_prod_k9x2m4p8"
  }
  return secret
}

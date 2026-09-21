// lib/jwt-edge.ts
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

// lib/csrf-client.ts - Client-side CSRF helper (P1-3)
export async function getCsrfToken(): Promise<string> {
  const res = await fetch("/api/auth/csrf", {
    method: "GET",
    credentials: "include",
  })
  if (!res.ok) {
    throw new Error("Failed to fetch CSRF token")
  }
  const data = await res.json()
  return data.csrfToken as string
}

export async function fetchWithCsrf(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  // Ensure we have a CSRF token (fetch it if needed)
  let csrfToken: string | null = null
  try {
    csrfToken = await getCsrfToken()
  } catch {
    // if fails, proceed without token - server will return 403
  }

  const headers = new Headers(init.headers || {})
  if (csrfToken) {
    headers.set("x-csrf-token", csrfToken)
  }
  // Ensure content-type if not set and body is present
  if (!headers.has("Content-Type") && init.body) {
    // keep existing if FormData, otherwise json
    if (!(init.body instanceof FormData)) {
      headers.set("Content-Type", "application/json")
    }
  }

  return fetch(input, {
    ...init,
    headers,
    credentials: "include",
  })
}

// __tests__/isolation/ati-scan-isolation.test.ts
// Concurrent ATI scan isolation test (Task 7: no global mutable state)

import { describe, it, expect } from "vitest"

describe("ATI scan isolation", () => {
  it("should not use global mutable state for deduplication", () => {
    // Verify the code does not reference module-level globalSeenIds
    const fs = require("node:fs")
    const clientCode = fs.readFileSync("lib/ati-client.ts", "utf8")

    // The old pattern should not exist
    expect(clientCode).not.toContain("let globalSeenIds")
    expect(clientCode).not.toContain("globalSeenIds = new Set()")

    // Each scan should create its own Set
    expect(clientCode).toContain("const seenIds: Set<string>")
    expect(clientCode).toContain("const manualSeenIds: Set<string>")
  })

  it("should pass seenIds explicitly to addIfNew", () => {
    const fs = require("node:fs")
    const clientCode = fs.readFileSync("lib/ati-client.ts", "utf8")

    // addIfNew should take seenIds as parameter
    const addIfNewPattern = /function addIfNew\([^,]+, [^,]+, ([^)]+)\)/
    expect(addIfNewPattern.test(clientCode)).toBe(true)
  })
})

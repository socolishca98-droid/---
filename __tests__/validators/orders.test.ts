import { describe, it, expect } from "vitest"
import { createOrderSchema, createDriverSchema, createVehicleSchema } from "@/lib/validators"

describe("domain validators P1-6", () => {
  it("createOrderSchema rejects empty", () => {
    const res = createOrderSchema.safeParse({})
    expect(res.success).toBe(false)
  })

  it("createOrderSchema accepts minimal valid", () => {
    const res = createOrderSchema.safeParse({
      routeFrom: "Moscow",
      routeTo: "SPb",
      distance: 700,
      weight: 1000,
      cargoType: "boxes",
      clientContact: "+7916",
    })
    expect(res.success).toBe(true)
  })

  it("createDriverSchema rejects missing name", () => {
    const res = createDriverSchema.safeParse({ phone: "+79161234567" })
    expect(res.success).toBe(false)
  })

  it("createDriverSchema accepts valid", () => {
    const res = createDriverSchema.safeParse({ name: "Ivan", phone: "+79161234567" })
    expect(res.success).toBe(true)
  })

  it("createVehicleSchema rejects missing plate", () => {
    const res = createVehicleSchema.safeParse({ type: "truck", capacity: 1000 })
    expect(res.success).toBe(false)
  })

  it("createVehicleSchema accepts valid", () => {
    const res = createVehicleSchema.safeParse({ plate: "A123BC", type: "truck", capacity: 5000 })
    expect(res.success).toBe(true)
  })

  it("createVehicleSchema transforms string capacity", () => {
    const res = createVehicleSchema.safeParse({ plate: "A123BC", type: "truck", capacity: "5000" })
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.capacity).toBe(5000)
    }
  })
})

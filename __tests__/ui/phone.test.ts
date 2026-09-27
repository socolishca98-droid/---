// __tests__/ui/phone.test.ts
//
// Номер водителя в базе канонический (только цифры, 8 → 7), а на экране человек
// должен видеть привычное написание и иметь рабочую ссылку tel:.
// Запуск: npm run test:vitest

import { describe, expect, it } from "vitest"

import { formatPhone, isRussianPhone, telHref } from "@/lib/ui/phone"

describe("formatPhone", () => {
  it("показывает один и тот же номер одинаково, в каком бы виде он ни лежал", () => {
    const expected = "+7 911 222-33-44"
    expect(formatPhone("79112223344")).toBe(expected)
    expect(formatPhone("+79112223344")).toBe(expected)
    expect(formatPhone("89112223344")).toBe(expected)
    expect(formatPhone("8 (911) 222-33-44")).toBe(expected)
  })

  it("не выдумывает формат там, где его быть не может", () => {
    // короткие/служебные номера и городские — как есть
    expect(formatPhone("112")).toBe("112")
    expect(formatPhone("+49 30 123456")).toBe("+49 30 123456")
    expect(formatPhone("уточняется")).toBe("уточняется")
  })

  it("пустое значение остаётся пустым, а не превращается в мусор", () => {
    expect(formatPhone("")).toBe("")
    expect(formatPhone("   ")).toBe("")
    expect(formatPhone(null)).toBe("")
    expect(formatPhone(undefined)).toBe("")
  })
})

describe("telHref", () => {
  it("для ссылки tel: отдаёт номер без пробелов и дефисов", () => {
    expect(telHref("8 (911) 222-33-44")).toBe("+79112223344")
    expect(telHref("79112223344")).toBe("+79112223344")
  })

  it("нероссийский номер остаётся набираемым, но без выдумок", () => {
    expect(telHref("+49 30 123456")).toBe("4930123456")
  })

  it("без номера ссылки нет", () => {
    expect(telHref("")).toBe("")
    expect(telHref(null)).toBe("")
  })
})

describe("isRussianPhone", () => {
  it("признаёт только 11 цифр с семёркой", () => {
    expect(isRussianPhone("89112223344")).toBe(true)
    expect(isRussianPhone("+7 911 222-33-44")).toBe(true)
    expect(isRussianPhone("9112223344")).toBe(false)
    expect(isRussianPhone("112")).toBe(false)
    expect(isRussianPhone("")).toBe(false)
  })
})

// Приветствие по времени суток: одна формулировка на экран входа, шапку и
// сплэш после логина. Проверяем границы частей суток, обращение по имени и
// формат даты — эти строки видит каждый пользователь при каждом входе.

import { describe, expect, it } from "vitest"

import {
  formatGreeting,
  formatHumanDate,
  getGreetingLabel,
  getGreetingPart,
} from "@/lib/ui/greeting"

/** Дата в локальной зоне песочницы (UTC) — час задаём напрямую. */
function at(hour: number, minute = 0): Date {
  const date = new Date(2026, 8, 26, hour, minute, 0, 0)
  return date
}

describe("getGreetingPart — границы частей суток", () => {
  it("утро: 5:00–11:59", () => {
    expect(getGreetingPart(at(5))).toBe("morning")
    expect(getGreetingPart(at(8, 30))).toBe("morning")
    expect(getGreetingPart(at(11, 59))).toBe("morning")
  })

  it("день: 12:00–17:59", () => {
    expect(getGreetingPart(at(12))).toBe("day")
    expect(getGreetingPart(at(15))).toBe("day")
    expect(getGreetingPart(at(17, 59))).toBe("day")
  })

  it("вечер: 18:00–22:59", () => {
    expect(getGreetingPart(at(18))).toBe("evening")
    expect(getGreetingPart(at(21))).toBe("evening")
    expect(getGreetingPart(at(22, 59))).toBe("evening")
  })

  it("ночь: 23:00–4:59", () => {
    expect(getGreetingPart(at(23))).toBe("night")
    expect(getGreetingPart(at(0))).toBe("night")
    expect(getGreetingPart(at(4, 59))).toBe("night")
  })
})

describe("getGreetingLabel — русские формулировки", () => {
  it("даёт согласованное приветствие для каждой части суток", () => {
    expect(getGreetingLabel(at(7))).toBe("Доброе утро")
    expect(getGreetingLabel(at(13))).toBe("Добрый день")
    expect(getGreetingLabel(at(19))).toBe("Добрый вечер")
    expect(getGreetingLabel(at(1))).toBe("Доброй ночи")
  })
})

describe("formatGreeting — обращение по имени", () => {
  it("берёт только имя из ФИО", () => {
    expect(formatGreeting("Фролов Иван Александрович", at(9))).toBe("Доброе утро, Фролов")
  })

  it("работает без имени и с пустой строкой", () => {
    expect(formatGreeting(null, at(9))).toBe("Доброе утро")
    expect(formatGreeting("   ", at(20))).toBe("Добрый вечер")
    expect(formatGreeting(undefined, at(20))).toBe("Добрый вечер")
  })
})

describe("formatHumanDate — человекочитаемая дата", () => {
  it("пишет день недели с маленькой буквы и месяц в родительном падеже", () => {
    // 26 сентября 2026 — суббота
    expect(formatHumanDate(new Date(2026, 8, 26, 10, 0))).toBe("суббота, 26 сентября")
  })

  it("корректно обрабатывает однозначные числа и другие месяцы", () => {
    expect(formatHumanDate(new Date(2026, 0, 5, 10, 0))).toBe("понедельник, 5 января")
    expect(formatHumanDate(new Date(2026, 11, 31, 10, 0))).toBe("четверг, 31 декабря")
  })
})

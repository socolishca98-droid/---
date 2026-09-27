// Приветствие по времени суток: одна формулировка на экран входа, шапку и
// сплэш после логина. Проверяем границы частей суток, обращение по имени и
// формат даты — эти строки видит каждый пользователь при каждом входе.

import { describe, expect, it } from "vitest"

import {
  formatGreeting,
  formatHumanDate,
  getGreetingLabel,
  getGreetingPart,
  givenName,
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

describe("givenName — из того, что лежит в карточке сотрудника", () => {
  it("ФИО через фамилию: обращается по имени, а не по фамилии", () => {
    expect(givenName("Фролов Иван Александрович")).toBe("Иван")
    expect(givenName("Иванов Сергей Петрович")).toBe("Сергей")
    expect(givenName("Смирнова Ольга Игоревна")).toBe("Ольга")
    expect(givenName("Кузнецкая Мария Петровна")).toBe("Мария")
  })

  it("имя первым — берёт его же", () => {
    expect(givenName("Иван Фролов")).toBe("Иван")
    expect(givenName("Сергей")).toBe("Сергей")
    expect(givenName("Anna Petrova")).toBe("Anna")
  })

  it("служебные учётки без имени — null (приветствуем без обращения)", () => {
    expect(givenName("Администратор")).toBeNull()
    expect(givenName("Логист")).toBeNull()
    expect(givenName("dispatcher")).toBeNull()
  })

  it("учётки двух ролей продукта приветствуются без имени", () => {
    // организаторы: администратор (ADMIN_NAME по умолчанию), логист, диспетчер
    expect(givenName("Администратор")).toBeNull()
    expect(givenName("Логист")).toBeNull()
    expect(givenName("Диспетчер")).toBeNull()
    // исполнители: водитель без имени в карточке
    expect(givenName("Водитель")).toBeNull()
  })

  it("инициалы вместо имени — не угадываем", () => {
    expect(givenName("И.И. Иванов")).toBeNull()
    expect(givenName("И. Фролов")).toBeNull()
    expect(givenName("Фролов И.")).toBeNull()
    expect(givenName("ИВАНОВ И.И.")).toBeNull()
  })

  it("аббревиатура капсом именем не считается", () => {
    expect(givenName("ООО")).toBeNull()
    expect(givenName("ИП Фролов Иван Александрович")).toBeNull()
    expect(givenName('ООО "Рассвет"')).toBeNull()
  })

  it("хвостовая пунктуация не попадает в обращение", () => {
    expect(givenName("Иван,")).toBe("Иван")
    expect(givenName("Фролов Иван.")).toBe("Иван")
    expect(givenName("Иван Фролов!")).toBe("Иван")
  })

  it("пусто и не строка — null", () => {
    expect(givenName(null)).toBeNull()
    expect(givenName(undefined)).toBeNull()
    expect(givenName("   ")).toBeNull()
    expect(givenName(42 as unknown as string)).toBeNull()
  })
})

describe("formatGreeting — обращение по имени вошедшего сотрудника", () => {
  it("подставляет имя из сессии, а не зашитое значение", () => {
    expect(formatGreeting("Фролов Иван Александрович", at(9))).toBe("Доброе утро, Иван")
    expect(formatGreeting("Петрова Мария Сергеевна", at(14))).toBe("Добрый день, Мария")
    expect(formatGreeting("Сергей Кузнецов", at(20))).toBe("Добрый вечер, Сергей")
  })

  it("работает без имени и с пустой строкой", () => {
    expect(formatGreeting(null, at(9))).toBe("Доброе утро")
    expect(formatGreeting("Администратор", at(9))).toBe("Доброе утро")
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

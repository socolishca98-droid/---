// lib/ui/greeting.ts — приветствие по времени суток.
//
// Система многопользовательская и мультитенантная: у каждой организации свои
// логисты, админы и водители. Поэтому НИКАКИХ имён здесь не зашито — имя
// приходит из проверенной сессии (GET /api/auth/session → lib/auth-context),
// а организация берётся из той же сессии (user.organization.name).
//
// Этот файл отвечает только за формулировки: одинаковое «Доброе утро» на
// экране входа, в шапке и в приветственном сплэше, и корректное обращение по
// имени — в карточке сотрудника может быть как «Иван Фролов», так и
// «Фролов Иван Александрович», а у служебной учётки — просто «Администратор».
//
// Функции принимают дату аргументом — так их можно честно проверить тестами,
// не подкручивая системные часы.

export type GreetingPart = "morning" | "day" | "evening" | "night"

/** Границы частей суток (часы, локальное время): утро 5–11, день 12–17, вечер 18–22, ночь 23–4. */
export function getGreetingPart(date: Date = new Date()): GreetingPart {
  const hour = date.getHours()
  if (hour >= 5 && hour < 12) return "morning"
  if (hour >= 12 && hour < 18) return "day"
  if (hour >= 18 && hour < 23) return "evening"
  return "night"
}

const PART_LABELS: Record<GreetingPart, string> = {
  morning: "Доброе утро",
  day: "Добрый день",
  evening: "Добрый вечер",
  night: "Доброй ночи",
}

/** Просто «Доброе утро» / «Добрый день» / … */
export function getGreetingLabel(date: Date = new Date()): string {
  return PART_LABELS[getGreetingPart(date)]
}

/**
 * Typical русские фамильные окончания: по ним отличаем «Фролов Иван» (сначала
 * фамилия) от «Иван Фролов». Список намеренно узкий — ложное срабатывание
 * дороже, чем обращение по первому слову.
 */
const SURNAME_ENDINGS = [
  "ов",
  "ев",
  "ёв",
  "ин",
  "ын",
  "ский",
  "цкий",
  "ова",
  "ева",
  "ёва",
  "ина",
  "ына",
  "ская",
  "цкая",
] as const

/**
 * Служебные имена, которыми подписывают технические учётки (ADMIN_NAME по
 * умолчанию, карточка «Логист» без имени). Обращаться «Доброе утро,
 * Администратор» — звучит как издевательство, поэтому в таких случаях
 * приветствуем без имени.
 */
const GENERIC_NAMES = new Set([
  "администратор",
  "админ",
  "логист",
  "логистка",
  "диспетчер",
  "водитель",
  "менеджер",
  "руководитель",
  "сотрудник",
  "пользователь",
  "оператор",
  "поддержка",
  "сервис",
  "служба",
  "система",
  "охрана",
  "склад",
  "парк",
  "компания",
  "организация",
  "флот",
  "бот",
  "admin",
  "administrator",
  "logist",
  "dispatcher",
  "driver",
  "manager",
  "user",
  "operator",
  "support",
  "service",
  "system",
  "company",
  "organization",
  "fleet",
  "bot",
  "test",
])

/**
 * Аббревиатуры правовых форм. Если строка начинается с такой — это название
 * юрлица («ИП Фролов Иван Александрович», «ООО Рассвет»), а не человека:
 * обращение по имени было бы выдумкой, поэтому приветствуем обезличенно.
 */
const LEGAL_FORMS = new Set([
  "ип",
  "ооо",
  "оао",
  "зао",
  "пао",
  "ао",
  "тсж",
  "жск",
  "гбу",
  "мку",
  "муп",
  "фгуп",
  "кфх",
  "llc",
  "ltd",
  "inc",
  "gmbh",
  "corp",
  "srl",
])

/** «И.» → «и», «Иван» → «иван»: сравниваем со списками только по буквам. */
function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^а-яёa-z]/g, "")
}

/** «И.», «И.И.», «И.И» — блок инициалов: настоящего имени за ним не видно. */
function isInitialBlock(word: string): boolean {
  return /^[А-ЯЁA-Z]{1,2}(\.[А-ЯЁA-Z]{0,2})?\.?$/.test(word.trim())
}

function looksLikeSurname(word: string): boolean {
  const lower = word.toLowerCase().replace(/[^а-яёa-z-]/g, "")
  if (lower.length < 4) return false
  return SURNAME_ENDINGS.some((ending) => lower.endsWith(ending))
}

/**
 * Имя для обращения из того, что лежит в карточке сотрудника.
 *
 * — «Фролов Иван Александрович» → «Иван» (первое слово — фамилия);
 * — «Иван Фролов» → «Иван»;
 * — «Мария» → «Мария»;
 * — «Администратор» → null (приветствуем без имени);
 * — «ИП Фролов Иван Александрович», «ООО Рассвет» → null (это организация);
 * — «И.И. Иванов», «Фролов И.» → null (имя скрыто инициалами — не угадываем);
 * — пусто / не строка → null.
 */
export function givenName(fullName?: string | null): string | null {
  if (typeof fullName !== "string") return null

  const tokens = fullName
    .replace(/[«»"]/g, " ")
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/[.,;:!?]+$/, ""))
    .filter(Boolean)

  if (tokens.length === 0) return null

  // Название юрлица, а не человек: «ИП Фролов…», «ООО Рассвет», «Loginex LLC».
  // Форму смотрим в любом слове — она бывает и в конце.
  if (tokens.some((token) => LEGAL_FORMS.has(normalizeWord(token)))) return null

  // Строка начинается с инициалов («И.И. Иванов», «И. Фролов»): настоящего имени
  // в ней нет, а обращаться по фамилии невежливо — приветствуем без имени
  if (tokens.length > 1 && (isInitialBlock(tokens[0]) || normalizeWord(tokens[0]).length <= 1)) {
    return null
  }

  const candidate =
    tokens.length > 1 && looksLikeSurname(tokens[0]) && !looksLikeSurname(tokens[1])
      ? tokens[1]
      : tokens[0]

  const normalized = normalizeWord(candidate)

  // Инициалы вместо имени: «Фролов И.», «ИВАНОВ И.И.»
  if (normalized.length < 2 || isInitialBlock(candidate)) return null

  // Аббревиатура капсом («ООО», «ФНС», «ИВАНОВ И.И.») — не имя
  if (/^[А-ЯЁA-Z]{2,}$/.test(candidate)) return null

  if (GENERIC_NAMES.has(normalized)) return null

  return candidate
}

/** «Доброе утро, Иван» — имя берётся из сессии вошедшего сотрудника. */
export function formatGreeting(fullName?: string | null, date: Date = new Date()): string {
  const label = getGreetingLabel(date)
  const name = givenName(fullName)
  return name ? `${label}, ${name}` : label
}

const WEEKDAYS = [
  "воскресенье",
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
] as const

const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const

/** «суббота, 26 сентября» — человекочитаемая дата для шапки и экрана входа. */
export function formatHumanDate(date: Date = new Date()): string {
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]}`
}

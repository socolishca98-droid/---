// lib/dispatcher/query.ts — разбор запроса «умного диспетчера».
//
// Логист пишет по-человечески: «Найди завтра из Ярославля тент 20 т,
// от 65 000 ₽ и не меньше 45 ₽/км» — а система обязана понять:
// дата=завтра, откуда=Ярославль, кузов=тент, вес≤20 т, цена≥65000, ₽/км≥45.
//
// Модуль намеренно чистый (без БД и Next) — парсер покрыт юнит-тестами,
// а поиск по разобранным фильтрам делает GET /api/dispatcher/search.
//
// Принципы разбора (v1 — честная эвристика, не NLP):
//  * города — после «из»/«в» с заглавной буквы (чтобы «в рейс» не стало городом),
//    сравнение с базой по основе первых 4 символов: «Ярославля» ≈ «Ярославль»;
//  * «от N т» — нижняя граница веса, «до N т» — верхняя, голое «N т» — верхняя
//    (диспетчер ищет груз ПОД машину на N тонн);
//  * «N ₽/км» забирается первым, чтобы «45 ₽/км» не превратилось в цену;
//  * «от N» без единиц (N ≥ 500) — минимальная цена; «N ₽» — тоже цена;
//  * даты: сегодня/завтра/послезавтра, «12.10», «12 октября» (год текущий,
//    если дата уже далеко позади — следующий).

export interface DispatcherQuery {
  cityFrom: string | null;
  cityTo: string | null;
  /** Начало дня загрузки (включительно) */
  dateFrom: Date | null;
  /** Конец дня загрузки (не включительно) */
  dateTo: Date | null;
  /** Человекочитаемая метка даты для интерфейса */
  dateLabel: string | null;
  /** Нормализованные типы кузова из словаря ниже */
  truckTypes: string[];
  weightMinT: number | null;
  weightMaxT: number | null;
  priceMinRub: number | null;
  rubPerKmMin: number | null;
}

/** Словарь кузовов: ключ → чем ищем в тексте. Ключ сравнивается с truckType
 *  груза по основе первых 4 символов («тент» найдёт «тентованный»). */
const TRUCK_TYPE_PATTERNS: Array<[string, RegExp]> = [
  ["тент", /тент/],
  ["рефрижератор", /реф(?:рижератор)?/],
  ["изотерм", /изотерм/],
  ["бортовой", /борт/],
  ["фургон", /фургон/],
  ["площадка", /площадк/],
  ["цистерна", /цистерн/],
  ["самосвал", /самосвал/],
  ["лесовоз", /лесовоз/],
  ["зерновоз", /зерновоз/],
  ["трал", /трал/],
  ["автовоз", /автовоз/],
  ["контейнеровоз", /контейнер/],
];

const MONTHS_GENITIVE: Record<string, number> = {
  января: 0, февраля: 1, марта: 2, апреля: 3, мая: 4, июня: 5,
  июля: 6, августа: 7, сентября: 8, октября: 9, ноября: 10, декабря: 11,
};

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[\s\u00a0]/g, "").replace(",", ".");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function stripTrailingDots(value: string): string {
  return value.replace(/[.\-,;:!?]+$/, "");
}

/**
 * Город из запроса совпадает с городом базы, если совпадают основы
 * (первые 4 символа): падежи русского языка этого обычно достаточно —
 * «из Ярославля» → «Ярославль», «в Москву» → «Москва».
 */
export function cityStemMatch(
  queryCity: string | null,
  candidateCity: string | null | undefined,
): boolean {
  if (!queryCity) return true;
  if (!candidateCity) return false;
  const q = queryCity.toLowerCase().replace(/[.\-]/g, "").trim();
  const c = candidateCity.toLowerCase().replace(/[.\-]/g, "").trim();
  if (!q || !c) return false;
  const qStem = q.slice(0, Math.min(4, q.length));
  const cStem = c.slice(0, Math.min(4, c.length));
  return c.startsWith(qStem) || q.startsWith(cStem);
}

export function parseDispatcherQuery(text: string, now: Date = new Date()): DispatcherQuery {
  const query: DispatcherQuery = {
    cityFrom: null,
    cityTo: null,
    dateFrom: null,
    dateTo: null,
    dateLabel: null,
    truckTypes: [],
    weightMinT: null,
    weightMaxT: null,
    priceMinRub: null,
    rubPerKmMin: null,
  };

  let rest = String(text ?? "").trim();
  if (!rest) return query;

  // 1) ₽/км — первым, чтобы «45 ₽/км» не стало ценой груза
  const perKm = rest.match(/(\d+(?:[.,]\d+)?)\s*(?:₽|руб\.?|рублей|р\.?)\s*\/\s*км/i);
  if (perKm) {
    const value = parseNumber(perKm[1]);
    if (value !== null && value > 0) query.rubPerKmMin = value;
    rest = rest.replace(perKm[0], " ");
  }

  // 2) Дата: слова или явная дата
  const startOfDay = (base: Date, offsetDays: number): Date =>
    new Date(base.getFullYear(), base.getMonth(), base.getDate() + offsetDays);
  const setDay = (offsetDays: number, label: string) => {
    query.dateFrom = startOfDay(now, offsetDays);
    query.dateTo = startOfDay(now, offsetDays + 1);
    query.dateLabel = label;
  };
  if (/(^|[\s,])послезавтра/i.test(rest)) {
    setDay(2, "послезавтра");
  } else if (/(^|[\s,])завтра/i.test(rest)) {
    setDay(1, "завтра");
  } else if (/(^|[\s,])сегодня/i.test(rest)) {
    setDay(0, "сегодня");
  } else {
    const numeric = rest.match(/(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?(?!\d)/);
    const named = rest.match(
      /(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/i,
    );
    let day: number | null = null;
    let month: number | null = null;
    let year: number | null = null;
    if (numeric) {
      day = Number(numeric[1]);
      month = Number(numeric[2]) - 1;
      year = numeric[3] ? (numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3])) : null;
    } else if (named) {
      day = Number(named[1]);
      month = MONTHS_GENITIVE[named[2].toLowerCase()] ?? null;
    }
    if (day !== null && month !== null && day >= 1 && day <= 31 && month >= 0 && month <= 11) {
      let candidateYear = year ?? now.getFullYear();
      if (year === null) {
        // Дата без года уже далеко позади — значит, имеется в виду следующий год
        const candidate = new Date(candidateYear, month, day);
        if (candidate.getTime() < now.getTime() - 7 * 86400000) candidateYear += 1;
      }
      query.dateFrom = new Date(candidateYear, month, day);
      query.dateTo = new Date(candidateYear, month, day + 1);
      query.dateLabel = `${String(day).padStart(2, "0")}.${String(month + 1).padStart(2, "0")}.${candidateYear}`;
    }
  }

  // 3) Вес: «от N т» — минимум, «до N т» — максимум, голое «N т» — максимум
  const weightMin = rest.match(/от\s+(\d+(?:[.,]\d+)?)\s*т(?:онн)?(?![а-яёa-z])/i);
  if (weightMin) {
    const value = parseNumber(weightMin[1]);
    if (value !== null && value > 0) query.weightMinT = value;
    rest = rest.replace(weightMin[0], " ");
  }
  const weightMax = rest.match(/до\s+(\d+(?:[.,]\d+)?)\s*т(?:онн)?(?![а-яёa-z])/i);
  if (weightMax) {
    const value = parseNumber(weightMax[1]);
    if (value !== null && value > 0) query.weightMaxT = value;
    rest = rest.replace(weightMax[0], " ");
  }
  if (query.weightMinT === null && query.weightMaxT === null) {
    const weightBare = rest.match(/(\d+(?:[.,]\d+)?)\s*т(?:онн)?(?![а-яёa-z])/i);
    if (weightBare) {
      const value = parseNumber(weightBare[1]);
      if (value !== null && value > 0) query.weightMaxT = value;
    }
  }

  // 4) Цена: «от N» (крупное число без единиц) или явное «N ₽»
  const priceFrom = rest.match(/от\s+(\d[\d\s\u00a0.,]*\d|\d)/i);
  if (priceFrom) {
    const value = parseNumber(priceFrom[1]);
    if (value !== null && value >= 500) {
      query.priceMinRub = Math.round(value);
      rest = rest.replace(priceFrom[0], " ");
    }
  }
  if (query.priceMinRub === null) {
    const priceRub = rest.match(/(\d[\d\s\u00a0.,]*\d|\d)\s*(?:₽|руб\.?|рублей)(?!\s*\/)/i);
    if (priceRub) {
      const value = parseNumber(priceRub[1]);
      if (value !== null && value >= 500) query.priceMinRub = Math.round(value);
    }
  }

  // 5) Города: заглавная буква обязательна — «в рейс» городом не станет
  const cityFrom = rest.match(/из\s+([А-ЯЁ][а-яёA-Za-z\-.]+)/);
  if (cityFrom) query.cityFrom = stripTrailingDots(cityFrom[1]);
  const cityTo = rest.match(/(?:^|[\s,])в\s+([А-ЯЁ][а-яёA-Za-z\-.]+)/);
  if (cityTo) query.cityTo = stripTrailingDots(cityTo[1]);

  // 6) Типы кузова — все упомянутые
  const lower = rest.toLowerCase();
  for (const [key, pattern] of TRUCK_TYPE_PATTERNS) {
    if (pattern.test(lower)) query.truckTypes.push(key);
  }

  return query;
}

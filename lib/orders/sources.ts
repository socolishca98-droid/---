// lib/orders/sources.ts — канонический реестр источников заказа.
//
// Воронка обработки (lib/orders/stages.ts) не зависит от того, откуда заказ
// пришёл. Разным бывает только первый шаг: биржа ATI, постоянный клиент,
// ручной ввод, заявка из текста. Здесь — единый справочник значений
// Order.source: канон, ярлыки, иконки и маппинг легас-значений, чтобы старые
// записи («ATI», «manual») читались правильно без миграции данных.
//
// Будущие источники (ERP, ЭДО, почта, телефон, кабинет клиента) добавляются
// одной строкой в ORDER_SOURCES — экраны подхватят их автоматически.

export const ORDER_SOURCES = {
  /** Заказ от постоянного клиента (карточка в клиентской базе). */
  client: {
    label: "от клиента",
    short: "клиент",
    /** Tailwind-классы бейджа: цвет текста и рамки. */
    tone: "text-emerald-400 border-emerald-500/30",
  },
  /** Своя накопленная база ATI (сканирование по расписанию). */
  ati_base: {
    label: "база ATI",
    short: "ATI",
    tone: "text-amber-400 border-amber-500/30",
  },
  /** Живой поиск по ATI.SU. */
  ati_live: {
    label: "поиск ATI",
    short: "ATI",
    tone: "text-amber-400 border-amber-500/30",
  },
  /** Вручную: форма, заявка из текста, телефонный звонок. */
  manual: {
    label: "вручную",
    short: "вручную",
    tone: "text-zinc-400 border-zinc-500/30",
  },
  /** Будущее: интеграция с ERP/учётной системой компании. */
  erp: {
    label: "из ERP",
    short: "ERP",
    tone: "text-cyan-400 border-cyan-500/30",
  },
  /** Будущее: личный кабинет клиента (заявка с портала). */
  portal: {
    label: "кабинет клиента",
    short: "портал",
    tone: "text-indigo-400 border-indigo-500/30",
  },
} as const;

export type OrderSource = keyof typeof ORDER_SOURCES;

/** Легас-значения Order.source → канон реестра. */
const LEGACY_SOURCE_MAP: Record<string, OrderSource> = {
  ATI: "ati_base",
  ati: "ati_base",
  "ATI Live": "ati_live",
  import: "manual",
  text: "manual",
};

/**
 * Привести любое сохранённое значение source к канону реестра.
 * Неизвестное значение остаётся manual-ом по смыслу, но ярлык сохраняет
 * исходный текст, чтобы не терять информацию.
 */
export function normalizeOrderSource(value: unknown): OrderSource {
  if (typeof value !== "string" || value.trim() === "") return "manual";
  const trimmed = value.trim();
  if (trimmed in ORDER_SOURCES) return trimmed as OrderSource;
  if (trimmed in LEGACY_SOURCE_MAP) return LEGACY_SOURCE_MAP[trimmed];
  return "manual";
}

/** Человекочитаемый ярлык источника для любого сохранённого значения. */
export function orderSourceLabel(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const source = normalizeOrderSource(raw);
  // Неизвестное значение из будущего/легаса — показываем как есть
  if (
    source === "manual" &&
    raw &&
    !(raw in ORDER_SOURCES) &&
    !(raw in LEGACY_SOURCE_MAP)
  ) {
    return raw;
  }
  return ORDER_SOURCES[source].label;
}

/** Tailwind-тон бейджа источника. */
export function orderSourceTone(value: unknown): string {
  return ORDER_SOURCES[normalizeOrderSource(value)].tone;
}

/** Является ли заказ ATI-заказом (любой из двух ATI-источников или легас). */
export function isAtiSource(value: unknown): boolean {
  const source = normalizeOrderSource(value);
  return source === "ati_base" || source === "ati_live";
}

// Реестр источников заказа (lib/orders/sources.ts): канон, легас-маппинг и
// ярлыки. От него зависит, что человек видит в карточке заказа — «база ATI»,
// «от клиента» или «вручную», — поэтому значения проверяем явно.

import { describe, expect, it } from "vitest";

import {
  isAtiSource,
  normalizeOrderSource,
  orderSourceLabel,
  orderSourceTone,
} from "@/lib/orders/sources";

describe("normalizeOrderSource", () => {
  it("канонические значения проходят без изменений", () => {
    expect(normalizeOrderSource("client")).toBe("client");
    expect(normalizeOrderSource("ati_base")).toBe("ati_base");
    expect(normalizeOrderSource("ati_live")).toBe("ati_live");
    expect(normalizeOrderSource("manual")).toBe("manual");
    expect(normalizeOrderSource("erp")).toBe("erp");
    expect(normalizeOrderSource("portal")).toBe("portal");
  });

  it("легас-значения приводятся к канону (миграция данных не нужна)", () => {
    expect(normalizeOrderSource("ATI")).toBe("ati_base");
    expect(normalizeOrderSource("ati")).toBe("ati_base");
    expect(normalizeOrderSource("ATI Live")).toBe("ati_live");
    expect(normalizeOrderSource("import")).toBe("manual");
    expect(normalizeOrderSource("text")).toBe("manual");
  });

  it("пустое и неизвестное значение — manual", () => {
    expect(normalizeOrderSource("")).toBe("manual");
    expect(normalizeOrderSource(null)).toBe("manual");
    expect(normalizeOrderSource(undefined)).toBe("manual");
    expect(normalizeOrderSource("что-то из будущего")).toBe("manual");
  });

  it("пробелы по краям не мешают", () => {
    expect(normalizeOrderSource("  client ")).toBe("client");
    expect(normalizeOrderSource(" ATI ")).toBe("ati_base");
  });
});

describe("orderSourceLabel", () => {
  it("ярлыки для канона и легас", () => {
    expect(orderSourceLabel("client")).toBe("от клиента");
    expect(orderSourceLabel("ATI")).toBe("база ATI");
    expect(orderSourceLabel("ati_live")).toBe("поиск ATI");
    expect(orderSourceLabel("manual")).toBe("вручную");
    expect(orderSourceLabel("")).toBe("вручную");
    expect(orderSourceLabel(null)).toBe("вручную");
  });

  it("неизвестное значение показывается как есть — информацию не теряем", () => {
    expect(orderSourceLabel("звонок")).toBe("звонок");
  });
});

describe("orderSourceTone и isAtiSource", () => {
  it("тон есть у каждого источника", () => {
    expect(orderSourceTone("client")).toContain("emerald");
    expect(orderSourceTone("ATI")).toContain("amber");
    expect(orderSourceTone("manual")).toContain("zinc");
  });

  it("ATI-источники определяются вместе с легас", () => {
    expect(isAtiSource("ATI")).toBe(true);
    expect(isAtiSource("ati_base")).toBe(true);
    expect(isAtiSource("ati_live")).toBe(true);
    expect(isAtiSource("client")).toBe(false);
    expect(isAtiSource("manual")).toBe(false);
    expect(isAtiSource(null)).toBe(false);
  });
});

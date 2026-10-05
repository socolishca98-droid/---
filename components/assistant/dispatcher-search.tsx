// components/assistant/dispatcher-search.tsx
//
// «Умный диспетчер» в планировщике: запрос словами — грузы с ожидаемой
// прибылью. Сервер (GET /api/dispatcher/search) разбирает фразу на фильтры
// и считает по каждому грузу ₽/км, оценку топлива, прибыль и маржу.
// «Взять в работу» — существующий поток POST /api/orders/from-cache:
// груз становится заказом, планировщик сразу пересобирается (onTaken).

"use client";

import { useState } from "react";
import { Loader2, MapPin, Search, Sparkles, Truck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface DispatcherCandidate {
  cacheId: string;
  routeFrom: string;
  routeTo: string;
  loadingDate: string | null;
  weightKg: number | null;
  distanceKm: number | null;
  price: number | null;
  truckType: string | null;
  firmName: string | null;
  rubPerKm: number | null;
  estimatedFuelRub: number | null;
  expectedProfitRub: number | null;
  marginPercent: number | null;
}

interface DispatcherParsed {
  cityFrom: string | null;
  cityTo: string | null;
  dateLabel: string | null;
  truckTypes: string[];
  weightMinT: number | null;
  weightMaxT: number | null;
  priceMinRub: number | null;
  rubPerKmMin: number | null;
}

interface DispatcherResult {
  parsed: DispatcherParsed;
  fuelPriceRubPerL: number | null;
  consumptionPer100: number;
  vehicle: { id: string; plate: string } | null;
  scanned: number;
  candidates: DispatcherCandidate[];
}

const EXAMPLE =
  "Найди завтра из Ярославля тент 20 т, от 65 000 ₽ и не меньше 45 ₽/км";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}

function money(value: number): string {
  return value.toLocaleString("ru-RU");
}

export function DispatcherSearch({
  vehicleId,
  onTaken,
}: {
  vehicleId: string | null;
  onTaken: () => void;
}) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [taking, setTaking] = useState<string | null>(null);
  const [result, setResult] = useState<DispatcherResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    const text = query.trim();
    if (!text || loading) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: text });
      if (vehicleId) params.set("vehicleId", vehicleId);
      const response = await fetch(`/api/dispatcher/search?${params.toString()}`);
      const payload = (await response.json().catch(() => null)) as
        | (DispatcherResult & { success?: boolean; error?: string })
        | null;
      if (!response.ok || !payload?.success) {
        setError(payload?.error ?? "Подбор не выполнен");
        setResult(null);
        return;
      }
      setResult(payload);
    } catch {
      setError("Сервер недоступен — попробуйте ещё раз");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  async function take(candidate: DispatcherCandidate) {
    if (taking) return;
    setTaking(candidate.cacheId);
    setError(null);
    try {
      const response = await fetch("/api/orders/from-cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cacheId: candidate.cacheId }),
      });
      const payload = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
      } | null;
      if (!response.ok || !payload?.success) {
        // Груз мог уже взять другой логист (409) — убираем из подборки
        setError(payload?.error ?? "Не удалось взять груз в работу");
        setResult((current) =>
          current
            ? {
                ...current,
                candidates: current.candidates.filter(
                  (item) => item.cacheId !== candidate.cacheId,
                ),
              }
            : current,
        );
        return;
      }
      setResult((current) =>
        current
          ? {
              ...current,
              candidates: current.candidates.filter(
                (item) => item.cacheId !== candidate.cacheId,
              ),
            }
          : current,
      );
      // Груз стал заказом — планировщику пора пересобрать варианты
      onTaken();
    } catch {
      setError("Сервер недоступен — попробуйте ещё раз");
    } finally {
      setTaking(null);
    }
  }

  const chips: string[] = [];
  if (result) {
    const parsed = result.parsed;
    if (parsed.dateLabel) chips.push(parsed.dateLabel);
    if (parsed.cityFrom) chips.push(`из: ${parsed.cityFrom}`);
    if (parsed.cityTo) chips.push(`в: ${parsed.cityTo}`);
    for (const truckType of parsed.truckTypes) chips.push(truckType);
    if (parsed.weightMinT !== null) chips.push(`от ${parsed.weightMinT} т`);
    if (parsed.weightMaxT !== null) chips.push(`до ${parsed.weightMaxT} т`);
    if (parsed.priceMinRub !== null) chips.push(`от ${money(parsed.priceMinRub)} ₽`);
    if (parsed.rubPerKmMin !== null) chips.push(`от ${parsed.rubPerKmMin} ₽/км`);
  }

  return (
    <div className="space-y-3 rounded-xl border border-orange-400/25 bg-orange-400/5 p-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-orange-400" />
          Умный диспетчер
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Опишите груз своими словами — система отфильтрует накопленную базу и
          покажет ожидаемую прибыль, а не просто список.
          {result?.vehicle ? ` Машина: ${result.vehicle.plate}.` : ""}
          {result && result.fuelPriceRubPerL !== null
            ? ` Топливо: ${result.fuelPriceRubPerL} ₽/л по последним чекам, расход ${result.consumptionPer100} л/100км.`
            : ""}
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void search();
          }}
          placeholder={EXAMPLE}
          className="flex-1"
          disabled={loading}
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={loading}
            onClick={() => setQuery(EXAMPLE)}
            title="Подставить пример запроса"
          >
            Пример
          </Button>
          <Button size="sm" onClick={() => void search()} disabled={loading || !query.trim()}>
            {loading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="mr-1.5 h-3.5 w-3.5" />
            )}
            Найти
          </Button>
        </div>
      </div>

      {error && <p className="text-xs text-rose-500">{error}</p>}

      {result && (
        <div className="space-y-2">
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-orange-400/30 bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  {chip}
                </span>
              ))}
              <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                просмотрено {result.scanned}
              </span>
            </div>
          )}

          {result.candidates.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Под запрос ничего не нашлось. Попробуйте ослабить условия: убрать
              дату, цену или ₽/км.
            </p>
          ) : (
            <ul className="space-y-2">
              {result.candidates.map((candidate) => (
                <li
                  key={candidate.cacheId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background/60 p-3"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      {candidate.routeFrom} → {candidate.routeTo}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                      {candidate.loadingDate && <span>{formatDate(candidate.loadingDate)}</span>}
                      {candidate.weightKg !== null && <span>{candidate.weightKg / 1000} т</span>}
                      {candidate.distanceKm !== null && <span>{candidate.distanceKm} км</span>}
                      {candidate.truckType && (
                        <span className="flex items-center gap-1">
                          <Truck className="h-3 w-3" />
                          {candidate.truckType}
                        </span>
                      )}
                      {candidate.firmName && <span>{candidate.firmName}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right text-xs">
                      {candidate.price !== null ? (
                        <p className="font-semibold">{money(candidate.price)} ₽</p>
                      ) : (
                        <p className="text-muted-foreground">цена договорная</p>
                      )}
                      {candidate.rubPerKm !== null && (
                        <p className="text-muted-foreground">{candidate.rubPerKm} ₽/км</p>
                      )}
                      {candidate.expectedProfitRub !== null && (
                        <p
                          className={
                            candidate.expectedProfitRub >= 0
                              ? "font-semibold text-emerald-500"
                              : "font-semibold text-rose-500"
                          }
                        >
                          {candidate.expectedProfitRub >= 0 ? "+" : ""}
                          {money(candidate.expectedProfitRub)} ₽
                          {candidate.marginPercent !== null &&
                            ` · маржа ${candidate.marginPercent}%`}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={taking !== null}
                      onClick={() => void take(candidate)}
                    >
                      {taking === candidate.cacheId ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      Взять в работу
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

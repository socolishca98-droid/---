// app/ati/page.tsx
//
// «Кабинет ATI.SU» — витрина аккаунта биржи внутри Loginex, по образцу
// личного кабинета ATI: что подключено, какая фирма, какие площадки видны,
// что накоплено и что сканируется по расписанию. Формат и состав — как там,
// оформление и анимации — наши. Управление подключением живёт в
// «Организации», здесь только картина и ссылки.

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AtiDisabledNotice } from "@/components/ati/ati-disabled-notice";
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  Database,
  ExternalLink,
  Gauge,
  Loader2,
  Plug,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface AccountData {
  connected: boolean;
  oauthAvailable: boolean;
  connection: {
    kind: string;
    status: string;
    firmId: string | null;
    firmName: string | null;
    contactId: string | null;
    lastCheckAt: string | null;
    lastError: string | null;
  } | null;
  boards: Array<{
    id: string;
    name: string;
    boardType: string | null;
    direction: string | null;
  }>;
  boardsError: string | null;
  profiles: Array<{
    id: string;
    name: string;
    cities: string;
    radius: number;
    autoScanInterval: number;
    isActive: boolean;
    lastScanAt: string | null;
  }>;
  stats: { total: number; new: number; imported: number; expired: number };
}

const STATUS_LABEL: Record<
  string,
  { text: string; variant: "default" | "secondary" | "destructive" }
> = {
  active: { text: "Подключено", variant: "default" },
  unverified: {
    text: "Токен сохранён, проверка не выполнена",
    variant: "secondary",
  },
  invalid: { text: "Токен не принят ATI", variant: "destructive" },
};

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function cityList(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed.join(", ");
  } catch {
    /* строка без JSON — покажем как есть */
  }
  return raw || "все площадки";
}

export default function AtiAccountPage() {
  const [data, setData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  // Организация выключила ATI в настройках — вместо кабинета показываем заглушку
  const [atiDisabled, setAtiDisabled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ati/account", { credentials: "include" });
      if (res.status === 403) {
        const json = await res.json().catch(() => null);
        if (json?.code === "ati_disabled") setAtiDisabled(true);
        return;
      }
      const json = await res.json();
      if (json?.success) setData(json);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (atiDisabled) {
    return <AtiDisabledNotice title="Кабинет ATI отключён" />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-3" />
        Загружаем кабинет ATI.SU…
      </div>
    );
  }

  if (!data?.connected) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Plug className="h-6 w-6 text-primary" />
            Кабинет ATI.SU
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Аккаунт вашей организации на бирже грузов: площадки, грузы,
            подписка.
          </p>
        </header>
        <Card>
          <CardContent className="p-8 text-center space-y-4">
            <ShieldAlert className="h-10 w-10 mx-auto text-amber-500" />
            <p className="font-semibold">
              Организация ещё не подключена к ATI.SU
            </p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              У каждой организации свой аккаунт биржи: свои площадки, грузы и
              лимиты. Подключите его один раз — и живой поиск, сканы по
              расписанию и контакты грузоотправителей заработают от вашего
              имени.
            </p>
            <Button asChild>
              <Link href="/settings">Подключить аккаунт</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const status =
    STATUS_LABEL[data.connection?.status ?? "unverified"] ??
    STATUS_LABEL.unverified;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Plug className="h-6 w-6 text-primary" />
            Кабинет ATI.SU
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Аккаунт биржи вашей организации: подключение, площадки и сканы.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Обновить
          </Button>
          <Button asChild size="sm">
            <Link href="/settings">
              Управление подключением
              <ExternalLink className="h-3.5 w-3.5 ml-2" />
            </Link>
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Подключение */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              Подключение
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Состояние</span>
              <Badge variant={status.variant}>{status.text}</Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Способ</span>
              <span className="font-medium">
                {data.connection?.kind === "oauth"
                  ? "OAuth 2.0 (вход через ATI)"
                  : "Постоянный токен"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Фирма в ATI</span>
              <span className="font-medium text-right">
                {data.connection?.firmName || "не определена"}
                {data.connection?.firmId ? ` · №${data.connection.firmId}` : ""}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Последняя проверка</span>
              <span>{formatWhen(data.connection?.lastCheckAt ?? null)}</span>
            </div>
            {data.connection?.lastError && (
              <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-red-600 dark:text-red-300">
                <TriangleAlert className="h-4 w-4 mt-0.5 flex-shrink-0" />
                {data.connection.lastError}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Накопленная база */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              Накопленная база грузов
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            {[
              { label: "новых", value: data.stats.new },
              { label: "в работе", value: data.stats.imported },
              { label: "истекло", value: data.stats.expired },
              { label: "всего", value: data.stats.total },
            ].map((tile) => (
              <div key={tile.label} className="rounded-xl bg-muted/50 p-3">
                <p className="text-2xl font-bold tabular-nums">{tile.value}</p>
                <p className="text-xs text-muted-foreground">{tile.label}</p>
              </div>
            ))}
            <p className="col-span-2 sm:col-span-4 text-xs text-muted-foreground">
              База наполняется сканами ваших площадок и живым поиском — смотрите
              вкладку «Своя база» в поиске грузов.
            </p>
          </CardContent>
        </Card>

        {/* Площадки */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              Площадки, где видны грузы
              <Badge variant="secondary">{data.boards.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.boardsError && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">
                {data.boardsError}
              </p>
            )}
            {data.boards.length === 0 && !data.boardsError && (
              <p className="text-muted-foreground">
                Видимых площадок нет. Вступите в открытую площадку на
                ati.su/boards/public, попросите грузовладельца добавить вашу
                фирму на свою или создайте свою площадку и пригласите
                контрагентов — после этого грузы появятся в поиске.
              </p>
            )}
            {data.boards.map((board) => (
              <div
                key={board.id}
                className="flex items-center justify-between gap-3 rounded-lg border p-2.5"
              >
                <span className="font-medium truncate">{board.name}</span>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {board.boardType === "loads"
                    ? "грузы"
                    : board.boardType || "площадка"}
                  {board.direction ? ` · ${board.direction}` : ""}
                </span>
              </div>
            ))}
            <p className="text-xs text-muted-foreground pt-1">
              Живой поиск и плановые сканы берут грузы только с этих площадок —
              так работает официальное API ATI.SU.
            </p>
          </CardContent>
        </Card>

        {/* Расписание сканов */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-primary" />
              Сканирование по расписанию
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.profiles.length === 0 && (
              <p className="text-muted-foreground">
                Профилей нет: каждый плановый скан проходит по всем видимым
                грузам ваших площадок без гео-фильтра.
              </p>
            )}
            {data.profiles.map((profile) => (
              <div
                key={profile.id}
                className="rounded-lg border p-2.5 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{profile.name}</span>
                  <Badge variant={profile.isActive ? "secondary" : "outline"}>
                    {profile.isActive
                      ? profile.autoScanInterval > 0
                        ? `каждые ${profile.autoScanInterval} мин`
                        : "только вручную"
                      : "выключен"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {cityList(profile.cities)} · радиус {profile.radius} км ·
                  последний скан {formatWhen(profile.lastScanAt)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Правила и лимиты */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Gauge className="h-4 w-4 text-primary" />
            Лимиты и правила ATI.SU
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>
            ATI ограничивает частоту: не более 10 запросов в секунду на контакт.
            Loginex держит темп ~8 запросов/сек и при ответе 429 автоматически
            повторяет запрос с растущей паузой.
          </p>
          <p>
            Программа только читает грузы и площадки вашего аккаунта: мы не
            публикуем грузы и не участвуем в торгах от имени организации,
            поэтому суточные лимиты на создание грузов не тратятся.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

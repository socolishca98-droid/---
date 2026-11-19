"use client"

/**
 * и58: страница-пересадка «Войти как …» (жалоба №11, вечер 18.11).
 *
 * Разбор вечера показал: сервер при нажатии «Войти как водитель» работал
 * безупречно — сессия выдана, кабинет открыт (журнал: /m с живым водителем,
 * сессии 200, сборка свежая, часы тикали). Но владелец видел форму входа:
 * на iPhone Safari поверх живой страницы висел ЗАМОРОЖЕННЫЙ слой прошлой
 * отрисовки (тот же феномен, что 16–17.11: «форма-призрак над живым
 * кабинетом»), а программная вкладка (window.open после похода на сервер)
 * могла быть и вовсе не показана. Единственное звено, которое журнал не
 * видит, — момент открытия вкладки.
 *
 * Лечение — вернуть решение браузеру и человеку:
 *   1) вкладку кабинета открывает НАСТОЯЩАЯ ссылка <a target="_blank"> —
 *      клик человека; блокировщики popup такие ссылки не трогают, iOS
 *      надёжно показывает новую вкладку;
 *   2) эта страница-пересадка — простые элементы без 3D и WebGL: в ней
 *      нечему «замерзать» в композиторе WebKit;
 *   3) кнопка продублирована на самой странице: что бы ни случилось с
 *      вкладками, у владельца всегда перед глазами живая кнопка «Открыть
 *      кабинет».
 *
 * Сессия цели выпускается ДО перехода сюда (см. components/owner/
 * enter-account.ts), поэтому кабинет открывается сразу, без мигания
 * формы входа.
 */

import { useEffect, useState } from "react"
import { Loader2, RefreshCw, Truck, UserCheck } from "lucide-react"

import { Button } from "@/components/ui/button"

type Phase = "waiting" | "ready" | "error"

type Handoff = {
  kind: "driver" | "staff"
  name: string | null
  at: number
}

const HANDOFF_KEY = "loginex_enter_account"

export default function OpenAccountPage() {
  const [phase, setPhase] = useState<Phase>("waiting")
  const [kind, setKind] = useState<"driver" | "staff">("driver")
  const [target, setTarget] = useState("/m")
  const [name, setName] = useState<string | null>(null)
  const [checkedAt, setCheckedAt] = useState<string>("")

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const qKind = params.get("kind") === "staff" ? "staff" : "driver"
    const qTo = params.get("to")
    setKind(qKind)
    setTarget(qTo || (qKind === "driver" ? "/m" : "/lm"))
    try {
      const raw = localStorage.getItem(HANDOFF_KEY)
      if (raw) {
        const handoff = JSON.parse(raw) as Partial<Handoff>
        // Заметке больше 10 минут верить нельзя: сессия могла смениться
        if (handoff.kind === qKind && Date.now() - (handoff.at ?? 0) < 10 * 60 * 1000) {
          setName(handoff.name ?? null)
        }
      }
    } catch {
      // localStorage недоступен — просто без имени
    }
  }, [])

  const check = async () => {
    setPhase("waiting")
    try {
      const res = await fetch(`/api/auth/session?kind=${kind}`, {
        cache: "no-store",
        credentials: "same-origin",
      })
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as {
        success?: boolean
        session?: { user?: { name?: string | null } | null } | null
      }
      const who = data.session?.user?.name ?? null
      if (data.success && data.session) {
        if (who) setName(who)
        setPhase("ready")
      } else {
        setPhase("error")
      }
    } catch {
      setPhase("error")
    } finally {
      setCheckedAt(new Date().toLocaleTimeString("ru-RU", { hour12: false }))
    }
  }

  useEffect(() => {
    void check()
    // Пока страница открыта — перепроверяем каждые 5 секунд: если сессия
    // цели по какой-то причине ещё не дошла, кнопка появится сама, без
    // ручного обновления страницы.
    const timer = setInterval(() => {
      void check()
    }, 5000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.32em] text-white/45">
        <Truck className="h-4 w-4 text-orange-400" />
        {kind === "driver" ? "Кабинет водителя" : "Кабинет сотрудника"}
      </div>

      {phase === "waiting" ? (
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
          <p className="text-sm">Готовим кабинет{name ? `: ${name}` : ""}…</p>
          <p className="text-xs text-slate-500">Обычно это меньше секунды</p>
        </div>
      ) : null}

      {phase === "ready" ? (
        <div className="flex w-full max-w-sm flex-col items-center gap-4">
          <div className="flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-center text-[13px] text-emerald-300">
            <UserCheck className="h-4 w-4 shrink-0" />
            Сессия готова{name ? `: ${name}` : ""}
          </div>
          {/* Настоящая ссылка, а не window.open: открывает НОВУЮ вкладку
              даже под блокировщиком popup — решение принимает браузер
              по прямому клику человека (и58, жалоба №11) */}
          <a
            href={target}
            target="_blank"
            rel="noopener"
            data-cab-open-link="1"
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/15 px-4 py-4 text-[16px] font-semibold text-emerald-200 transition active:scale-[0.98]"
          >
            <Truck className="h-5 w-5" />
            Открыть кабинет
          </a>
          <a
            href={target}
            data-cab-open-same="1"
            className="text-[13px] text-slate-400 underline decoration-slate-600"
          >
            открыть в этой вкладке
          </a>
          <p className="text-center text-xs leading-relaxed text-slate-500">
            Кабинет откроется новой вкладкой. Если вкладка не открылась —
            отключите блокировщик всплывающих окон для этого сайта и нажмите
            кнопку ещё раз.
          </p>
        </div>
      ) : null}

      {phase === "error" ? (
        <div className="flex w-full max-w-sm flex-col items-center gap-4">
          <p className="text-center text-sm leading-relaxed text-red-400">
            Сессия не найдена. Вернитесь в панель и нажмите «Войти как …»
            ещё раз.
          </p>
          <Button variant="outline" onClick={() => void check()}>
            <RefreshCw className="h-4 w-4" />
            Проверить снова
          </Button>
        </div>
      ) : null}

      <div className="flex items-center gap-3 text-[11px] text-slate-500">
        <span>проверка: {checkedAt || "—"}</span>
      </div>
    </div>
  )
}

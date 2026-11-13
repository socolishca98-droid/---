// components/driver-login-form.tsx
//
// Форма входа водителя (клиентская часть страницы /m/login).
// Перенесена из app/m/login/page.tsx в и33: страница стала серверным
// компонентом, чтобы увидеть httpOnly-cookie сохранённой сессии владельца
// и показать ему путь назад в панель, когда чужая водительская сессия
// умерла и он остался на этом экране (скриншоты владельца: email
// в поле «Телефон», «Неверный телефон или пароль» — и тупик).
//
// Дизайн не тронут: тот же 3D-мир «Ночной рейс» и та же форма-плита.
// Логика контракта не тронута: useDriverSession({requireAuth:false}),
// login(phone, password) → {ok, error?, mustChangePassword?},
// mustChangePassword → /m/profile?changePassword=1, иначе /m.

"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Phone, Loader2, ArrowRight, Lock, AlertCircle, Truck, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { LoginWorld } from "@/components/visual/login-world"
import { useDriverSession } from "@/hooks/use-driver-session"
import { apiSend } from "@/hooks/use-json-api"
import { DRIVER_KICK_REASON_KEY, PRODUCT_NAME } from "@/lib/auth/constants"
import { formatGreeting, formatHumanDate } from "@/lib/ui/greeting"

/**
 * Почему водительская сессия умерла (и31 reason, и34 — показываем).
 * Человек видит причину на входе, а не «просто выкинуло»; владелец
 * платформы по этой надписи разбирает инциденты на проде.
 */
const SESSION_REASON_TEXT: Record<string, string> = {
  token_invalid: "сессия повреждена — войдите заново",
  session_row_missing: "сессия не найдена на сервере — войдите заново",
  session_revoked: "сессия завершена (выход или «Завершить сессии»)",
  session_expired: "срок сессии истёк — войдите заново",
  user_missing: "учётная запись удалена",
  user_suspended: "доступ к учётной записи закрыт",
  user_inactive: "учётная запись не активна",
  role_rejected: "роль учётной записи изменилась",
  // и35: страница открыта без действующей cookie — защита на входе в раздел
  no_session_cookie:
    "страница запросилась без cookie сессии — обновите страницу или войдите заново",
  token_rejected: "cookie сессии не принята сервером (подпись или срок) — войдите заново",
  session_without_driver: "сессия ответила без данных водителя — войдите заново",
  not_authenticated: "страница открыта без активной сессии — войдите заново",
}

export interface DriverLoginOwner {
  /** Имя владельца — не используется в надписи, оставлено для будущих нужд */
  name: string | null
  /**
   * impersonation — владелец открыл чужой аккаунт, тот умер: возврат
   * идёт через /api/admin/return (отзывает чужую сессию, ставит свою).
   * own — владелец просто зашёл на вход водителя при живой своей сессии:
   * достаточно перейти в панель.
   */
  mode: "impersonation" | "own"
}

/**
 * и35: серверная диагностика для владельца — видит ли сервер cookie
 * водителя в запросе страницы входа. Разделяет «cookie не дошла до
 * сервера» (браузер, приложение, защита) и «cookie есть, но сессия
 * мертва» (база, отзыв, срок). Водителям не показывается.
 */
export interface DriverLoginDiagnostic {
  driverCookie: "present" | "none"
}

export function DriverLoginForm({
  owner,
  diagnostic,
}: {
  owner: DriverLoginOwner | null
  diagnostic?: DriverLoginDiagnostic
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { login, isAuthenticated, refresh } = useDriverSession({ requireAuth: false })

  const [phone, setPhone] = useState<string>("")
  const [password, setPassword] = useState<string>("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [isReturning, setIsReturning] = useState(false)

  // и34: с чем водителя только что выкинуло на этот экран.
  // и36: причина дублируется в sessionStorage — кнопка «назад» и кэш
  // браузера возвращают старый URL без ?reason, и заметка исчезала вместе
  // с параметром. Теперь последняя причина переживает любые возвраты.
  const reasonParam = searchParams.get("reason")
  const [storedReason, setStoredReason] = useState<string | null>(null)
  useEffect(() => {
    if (reasonParam) {
      try {
        sessionStorage.setItem(DRIVER_KICK_REASON_KEY, reasonParam)
      } catch {}
      return
    }
    try {
      setStoredReason(sessionStorage.getItem(DRIVER_KICK_REASON_KEY))
    } catch {}
  }, [reasonParam])
  const kickReason = reasonParam ?? storedReason
  const reasonNotice = kickReason
    ? `Сессия водителя недействительна: ${SESSION_REASON_TEXT[kickReason] ?? kickReason}.`
    : null

  // Сессия уже есть — незачем показывать форму
  useEffect(() => {
    if (isAuthenticated) router.replace("/m")
  }, [isAuthenticated, router])

  // и36: страница восстановлена из кэша браузера (bfcache) — это «замороженный»
  // снимок с прежним JavaScript: на нём могут быть старые надписи и старые
  // кнопки, которые врут. Честный выход — перерисоваться с сервера: он видит
  // cookie и базу и нарисует правду.
  useEffect(() => {
    const onPageshow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload()
    }
    window.addEventListener("pageshow", onPageshow)
    return () => window.removeEventListener("pageshow", onPageshow)
  }, [])

  // и34: вернулись на эту страницу (кнопка «назад», смена вкладки), а cookie
  // сессии могла уже прилететь — например, владелец нажал «Войти», ушёл
  // раньше ответа и вернулся. Перепроверяем без перезагрузки: если сессия
  // жива — эффект выше уведёт в кабинет.
  useEffect(() => {
    const recheck = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void refresh()
      }
    }
    document.addEventListener("visibilitychange", recheck)
    window.addEventListener("pageshow", recheck)
    window.addEventListener("focus", recheck)
    return () => {
      document.removeEventListener("visibilitychange", recheck)
      window.removeEventListener("pageshow", recheck)
      window.removeEventListener("focus", recheck)
    }
  }, [refresh])

  // и36: гонка «нажал "Войти как" и ушёл назад раньше ответа». Cookie
  // имперсонации прилетают в браузер, когда человек уже сидит на этом
  // экране, — и ни одно событие (focus/pageshow) при этом не срабатывает.
  // Пока человек ничего не печатает, тихо перепроверяем сессию.
  // и41: окно 32 секунды убрано. В телефоне владельца нашлась «окаменелая»
  // вкладка с этим экраном: сессия создаётся нажатием «Войти как водитель»
  // в ДРУГОЙ вкладке, а старая так и показывала вход (фон — прошлая версия
  // дизайна). Теперь экран входа перепроверяет сессию, пока открыт: как
  // только сессия появляется — он сам уводит в кабинет. Печать в полях
  // останавливает опрос, фоновая вкладка не опрашивается вовсе.
  useEffect(() => {
    if (isAuthenticated) return
    if (phone.trim() || password) return
    const poll = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void refresh()
      }
    }, 4000)
    return () => clearInterval(poll)
  }, [isAuthenticated, phone, password, refresh])

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!phone.trim() || !password) {
      setError("Укажите телефон и пароль")
      return
    }

    // и36: браузер владельца подставляет его почту в поле «Телефон» — и вход
    // отвечает «Неверный телефон или пароль», хотя человек ничего не путал.
    // Ловим до отправки и объясняем словами, куда какая учётная запись
    // входит (жалоба со скриншота: email в поле телефона).
    if (phone.trim().includes("@")) {
      setError(
        "Здесь вход водителя — по номеру телефона. Почта — для входа логиста или владельца: ссылка «Вход для логиста» под кнопкой",
      )
      return
    }

    setIsLoading(true)
    setError("")

    const result = await login(phone.trim(), password)
    setIsLoading(false)

    if (!result.ok) {
      setError(result.error || "Не удалось войти")
      return
    }

    // вошли — причина прошлого вылета больше не актуальна
    try {
      sessionStorage.removeItem(DRIVER_KICK_REASON_KEY)
    } catch {}

    // Успешный вход — рывок сквозь мир и только потом редирект
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
    window.dispatchEvent(new CustomEvent("login:warp"))
    if (!reduced) await new Promise((resolve) => setTimeout(resolve, 900))

    // Пароль выдан логистом и требует замены — сначала профиль
    if (result.mustChangePassword) {
      router.push("/m/profile?changePassword=1")
      return
    }

    router.push("/m")
  }

  /**
   * и33: путь назад в панель владельца. Раньше его не было: владелец
   * застревал на входе водителя — его почта в поле «Телефон» не работает,
   * а полоса «Вы вошли как» исчезает вместе с умершей сессией.
   */
  const returnToPanel = async () => {
    if (!owner) return
    setIsReturning(true)
    try {
      if (owner.mode === "impersonation") {
        const result = await apiSend<{ redirectTo?: string }>("/api/admin/return", "POST", {})
        if (!result.ok) {
          setIsReturning(false)
          toast.error(
            result.error || "Не удалось вернуться — войдите заново через «Вход для логиста»",
          )
          return
        }
        window.location.assign(result.data?.redirectTo ?? "/owner")
        return
      }
      window.location.assign("/owner")
    } catch {
      setIsReturning(false)
    }
  }

  const canSubmit = phone.trim().length > 0 && password.length > 0

  // Приветствие по времени суток считаем на клиенте: SSR и гидратация
  // не должны расходиться из-за часов — как на входе логиста
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => setNow(new Date()), [])
  const dateLabel = now ? formatHumanDate(now) : undefined

  return (
    <div className="relative min-h-dvh">
      <LoginWorld
        variant="driver"
        headline={
          <div>
            <p className="flex items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-[0.32em] text-white/45 lg:justify-start">
              <Truck className="h-4 w-4 text-orange-400" />
              {PRODUCT_NAME} · водитель
            </p>
            <h2 className="mt-3 text-[30px] font-extrabold leading-[1.06] tracking-tight text-white sm:text-[40px]">
              Доброй
              <br />
              дороги
            </h2>
            <p className="mt-3 text-[13px] leading-relaxed text-slate-400 sm:text-sm">
              Рейсы, маршрут и документы — с вами в дороге, без звонков
              диспетчеру.
            </p>
          </div>
        }
      >
        {reasonNotice ? (
          <div
            role="alert"
            className="login-shake mb-4 flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-[13px] leading-relaxed text-red-400"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{reasonNotice}</span>
          </div>
        ) : null}

        {owner ? (
          <button
            type="button"
            onClick={returnToPanel}
            disabled={isReturning}
            className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl border border-orange-400/30 bg-orange-400/10 px-4 py-2.5 text-[13px] font-medium text-orange-300 transition active:scale-[0.98] disabled:opacity-60"
          >
            {isReturning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Undo2 className="h-4 w-4" />
            )}
            {owner.mode === "impersonation"
              ? "Вы владелец — вернуться в панель"
              : "Вы владелец — открыть панель"}
          </button>
        ) : null}

        {owner ? (
          <p
            data-driver-cookie={diagnostic?.driverCookie ?? "unknown"}
            className="mb-4 text-center text-[11px] leading-relaxed text-slate-500"
          >
            Диагностика: cookie водителя{" "}
            {diagnostic?.driverCookie === "present"
              ? "есть в этом запросе"
              : diagnostic?.driverCookie === "none"
                ? "нет в этом запросе"
                : "не проверена"}
            {reasonParam ? ` · код: ${reasonParam}` : ""}
          </p>
        ) : null}

        <div className="mb-4 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-orange-400">
            {now ? formatGreeting(undefined, now) : "Вход"}
            {dateLabel ? ` · ${dateLabel}` : ""}
          </p>
          <h1 className="mt-1 text-[17px] font-bold tracking-tight text-white sm:text-xl">
            Вход в приложение
          </h1>
          <p className="mt-1 hidden text-xs leading-relaxed text-slate-400 sm:block">
            Рейсы, маршрут и документы — без звонков диспетчеру
          </p>
        </div>
        <form onSubmit={handleLogin} className="w-full space-y-3 sm:space-y-4">
          <div>
            <label htmlFor="driver-phone" className="mb-1.5 block text-[13px] text-slate-400">
              Телефон
            </label>
            <div className="relative">
              <Phone className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
              <input
                id="driver-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+7 (999) 123-45-67"
                className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.05] pl-12 pr-4 text-[16px] text-white placeholder:text-slate-500 caret-orange-400 transition-colors focus-visible:border-orange-400/60 focus-visible:bg-white/[0.08] focus-visible:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="driver-password" className="mb-1.5 block text-[13px] text-slate-400">
              Пароль
            </label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
              <input
                id="driver-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="выдал логист"
                className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.05] pl-12 pr-4 text-[16px] text-white placeholder:text-slate-500 caret-orange-400 transition-colors focus-visible:border-orange-400/60 focus-visible:bg-white/[0.08] focus-visible:outline-none"
              />
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="login-shake flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-[13px] text-red-400"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !canSubmit}
            className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-400 text-[15px] font-bold text-white shadow-[0_12px_40px_-10px_rgba(251,146,60,0.65)] transition active:scale-[0.98] active:brightness-95 disabled:from-slate-700 disabled:to-slate-800 disabled:text-slate-500 disabled:shadow-none"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                В путь
                <ArrowRight className="h-5 w-5" />
              </>
            )}
          </button>
        </form>

        <Link
          href="/login"
          className="mt-3.5 block text-center text-[13px] text-slate-400 transition-colors hover:text-orange-400"
        >
          Вход для логиста
        </Link>

        <p className="mt-2.5 text-center text-[11px] leading-relaxed text-slate-500">
          Телефон и пароль выдаёт логист. Забыли — он сбросит их в разделе
          «Сотрудники и доступ»
        </p>
      </LoginWorld>
    </div>
  )
}

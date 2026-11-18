// Вход в любой аккаунт от имени владельца (тот же механизм, что был на /owner).
// Сервер выпускает сессию сам: пароли сотрудников и водителей не нужны.

import { toast } from "sonner"

import { apiSend } from "@/hooks/use-json-api"

export interface EnterAccountResult {
  ok: boolean
  /** Человекочитаемая причина неудачи — для постоянного блока на странице */
  error?: string
}

// и57: последняя открытая вкладка кабинета. Храним, чтобы следующее
// «Войти как …» закрывала её, а не копило вкладки (и45: четыре вкладки с
// тяжёлыми картами валили Safari). Ссылка живёт, пока жива страница
// управления — с и56/и57 она больше никуда не уходит.
let lastCabTab: Window | null = null

/** Закрыть прежнюю вкладку кабинета — но только нашу и только кабинет. */
function closeStaleCabTab() {
  const tab = lastCabTab
  lastCabTab = null
  if (!tab || tab === window) return
  try {
    if (tab.closed) return
    const sameOrigin = tab.location.origin === window.location.origin
    const cabinetPath = /^\/(m|lm)(\/|$)/.test(tab.location.pathname)
    if (sameOrigin && cabinetPath) tab.close()
  } catch {
    // вкладка ушла на другой источник или уже мертва — не трогаем
  }
}

/**
 * и57: страховка на случай, когда телефон открыл вкладку кабинета, но не
 * показал её человеку. Полоса СВЕРХУ — единственное место, которое точно
 * читаемо даже над застывшим кадром (жалобы №8–№9: верх страницы оставался
 * живым — баннер и часы читались). Говорим прямо, где кабинет.
 */
function showCabHint(name: string) {
  if (typeof document === "undefined" || !document.body) return
  if (document.getElementById("loginex-cab-hint")) return
  const bar = document.createElement("div")
  bar.id = "loginex-cab-hint"
  bar.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    "right:0",
    "z-index:2147483647",
    "background:#16a34a",
    "color:#fff",
    "font:600 15px/1.4 system-ui,-apple-system,sans-serif",
    "padding:calc(10px + env(safe-area-inset-top)) 44px 10px 14px",
    "box-shadow:0 6px 24px rgba(0,0,0,.35)",
  ].join(";")
  const text = document.createElement("span")
  text.textContent = `Кабинет (${name}) открыт в НОВОЙ вкладке — переключитесь на неё: кнопка вкладок внизу справа.`
  const close = document.createElement("button")
  close.type = "button"
  close.textContent = "×"
  close.setAttribute("aria-label", "Закрыть подсказку")
  close.style.cssText =
    "position:absolute;right:4px;top:2px;background:none;border:0;color:#fff;font-size:22px;line-height:1;padding:8px 12px;cursor:pointer"
  close.addEventListener("click", () => bar.remove())
  bar.append(text, close)
  document.body.appendChild(bar)
  setTimeout(() => bar.remove(), 20000)
}

export async function enterAccount(account: {
  kind: "staff" | "driver"
  id: string
  name: string
  fallbackHref?: string
}): Promise<EnterAccountResult> {
  // и57: вкладка кабинета открывается В МОМЕНТ НАЖАТИЯ и ВСЕГДА НОВАЯ.
  // История вопроса, коротко:
  //   и42 — кабинет в новой вкладке: свежая вкладка «заморозиться» не может;
  //   и47 — на телефоне вернули переход в ту же вкладку: window.open после
  //         пары запросов к серверу уже не считается нажатием, Safari молча
  //         открывал вкладку в фоне;
  //   и56 — вкладку открыли синхронно с нажатием (жест), но ПО ИМЕНИ
  //         «loginex-cab» (наследие и45). Жалоба №10 (18.11 22:33, журнал
  //         19:33 UTC): и это не сработало — «опять не смог попасть».
  //         Причина найдена: вкладка владельца, в которой он жмёт кнопку,
  //         САМА носит имя «loginex-cab» (родом из и42-эпохи, когда кабинет
  //         открывался в именованную вкладку). window.open("", "loginex-cab")
  //         возвращает ЕЁ ЖЕ — «новой» вкладкой оказывается та же отравленная:
  //         кабинет честно грузится (журнал: /m документом, сессии 200), но
  //         поверх него тот же застывший кадр, и человек опять «не попал».
  //   и57 — три защиты разом:
  //         (1) всегда _blank: никакие имена не ищем, вкладка создаётся
  //             с нуля — застрявшему кадру в ней взяться неоткуда;
  //         (2) самозащита: если window.open почему-то вернул текущее окно —
  //             считаем, что вкладки нет, и идём запасным путём;
  //         (3) прежняя вкладка кабинета закрывается перед открытием новой —
  //             вкладки не копятся (страх и45), страница управления остаётся
  //             на месте и живёт своей жизнью.
  const standalone =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches === true ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true)
  const phone =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(pointer: coarse)").matches === true ||
      /iPhone|iPad|Android/i.test(window.navigator.userAgent))

  let cabTab: Window | null = null
  if (!standalone && phone) {
    closeStaleCabTab()
    try {
      cabTab = window.open("", "_blank")
    } catch {
      cabTab = null
    }
    if (cabTab === window) {
      // самоссылка — «новой» объявили ту же вкладку; cabinet туда не пойдёт
      cabTab = null
    }
    if (cabTab) {
      lastCabTab = cabTab
      try {
        // Заставка на время выпуска сессии: вкладка не мигает пустой
        cabTab.document.write(
          '<!doctype html><html><head><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width, initial-scale=1">' +
            "<title>Открываю кабинет…</title></head>" +
            '<body style="margin:0;background:#09090b;color:#e4e4e7;' +
            "font-family:system-ui,-apple-system,sans-serif;display:flex;" +
            'align-items:center;justify-content:center;min-height:100vh">' +
            '<div style="text-align:center">' +
            '<div style="font-size:18px">Открываю кабинет…</div>' +
            '<div style="margin-top:8px;font-size:13px;opacity:.6">секунду</div>' +
            "</div></body></html>",
        )
        cabTab.document.close()
      } catch {
        // вкладка открыта, заставка не нарисовалась — не критично
      }
    }
  }
  // Любая неудача ниже обязана закрыть вкладку-обещание: человек не должен
  // остаться перед пустой вкладкой «Открываю кабинет…», которая ничего не открыла
  const closeCabTab = () => {
    if (!cabTab) return
    try {
      cabTab.close()
    } catch {
      // уже закрыта — не важно
    }
    if (lastCabTab === cabTab) lastCabTab = null
    cabTab = null
  }

  const body = account.kind === "driver" ? { driverId: account.id } : { userId: account.id }
  const result = await apiSend<{ redirectTo?: string; warning?: string }>(
    "/api/admin/impersonate",
    "POST",
    body,
  )
  if (!result.ok) {
    closeCabTab()
    // Например, доступ к учётной записи закрыт: сессия всё равно не заработала
    // бы, и владелец уехал бы в чужой кабинет чтобы сразу выпасть на вход.
    toast.error(result.error || "Не удалось войти в аккаунт")
    return { ok: false, error: result.error || "Не удалось войти в аккаунт" }
  }
  // Вход выполнен, но запись в журнал не сохранилась — сказать об этом вслух.
  if (result.data?.warning) toast.warning(result.data.warning)

  // и31: до перехода проверяем, что выданная сессия действительно действует.
  // Раньше молчаливый редирект уносил владельца в чужой кабинет, где его
  // встречал экран входа — «нажимаю на профиль, и меня выкидывает». Теперь
  // причина показывается здесь, на месте.
  const check = await fetch(`/api/auth/session?kind=${account.kind === "driver" ? "driver" : "staff"}`, {
    cache: "no-store",
  })
  // Пароль хостинга (Vercel Deployment Protection) перехватил запрос:
  // скажем прямо, что это настройка хостинга, а не сломанный вход
  if (check.status === 401 && check.headers.get("www-authenticate")) {
    const hostingError =
      "сайт требует пароль хостинга (Vercel Protection) — введите его при открытии сайта и повторите, либо отключите: Vercel → проект → Settings → Deployment Protection → Disable"
    closeCabTab()
    toast.error(hostingError, { duration: 12000 })
    return { ok: false, error: hostingError }
  }
  if (!check.ok) {
    const failure = (await check.json().catch(() => ({}))) as { error?: string; reason?: string }
    console.warn("[enter-account] сессия цели не действует:", failure?.reason ?? check.status)
    closeCabTab()
    toast.error(failure?.error || "Аккаунт открылся, но его сессия не действует")
    return {
      ok: false,
      error: `${failure?.error || "аккаунт открылся, но его сессия не действует"}${failure?.reason ? ` (причина: ${failure.reason})` : ""}`,
    }
  }

  const target = (result.data as { redirectTo?: string } | null)?.redirectTo ?? account.fallbackHref ?? "/lm"

  // и57: кабинет — во вкладке, открытой в момент нажатия. Она свежая:
  // застывший кадр старой вкладки оказаться в ней не может
  if (cabTab) {
    const tab = cabTab
    cabTab = null // вкладка отдана кабинету — закрывать её больше не нужно
    let navigated = false
    try {
      tab.location.assign(target)
      navigated = true
    } catch {
      try {
        tab.location.href = target
        navigated = true
      } catch {
        // вкладка есть, адрес в неё не пишется — остаётся запасной путь
      }
    }
    if (navigated) {
      try {
        tab.focus()
      } catch {
        // Safari может не дать фокус — вкладка всё равно открыта и видна
      }
      toast.success(`Кабинет открыт в новой вкладке: ${account.name}`)
      // и57: если через секунду МЫ всё ещё активная вкладка — телефон
      // открыл кабинет, но не показал его. Говорим прямо, где искать
      setTimeout(() => {
        try {
          if (document.visibilityState === "visible" && document.hasFocus()) {
            showCabHint(account.name)
          }
        } catch {
          // проверка не имеет права мешать
        }
      }, 1200)
      return { ok: true }
    }
    window.location.assign(target)
    return { ok: true }
  }

  toast.success(`Открываю аккаунт: ${account.name}`)

  // и43: но в «отдельной программе» (PWA, с иконки на рабочем столе) новых
  // вкладок нет: window.open там открывает невидимое окно или чужой браузер,
  // и человек остаётся смотреть на старый экран. В программе — переход
  // в ЭТОМ ЖЕ окне: куда нажал — там и оказался, без двусмысленности.
  // Сюда же попадает телефон, которому не дали вкладку (блокировщик).
  if (standalone || phone) {
    window.location.assign(target)
    return { ok: true }
  }
  // и45: вкладка с ИМЕНЕМ, а не «_blank». Каждое «Войти как …» открывало
  // НОВУЮ вкладку — на телефоне их накапливалось по четыре, каждая с
  // тяжёлой картой, и Safari в итоге падал: «на странице повторно возникла
  // проблема». Именованная вкладка переиспользуется: сколько бы входов
  // ни было — вкладка кабинета всегда одна. «Замороженный снимок» ей не
  // страшен: вкладка самовосстанавливается (и40/и41). На компьютере
  // застывших кадров не бывает — речи о них не было ни разу.
  const opened = window.open(target, "loginex-cab")
  if (opened) {
    // и46: вкладка кабинета — на передний план. Человек нажал «Войти как» —
    // кабинет должен оказаться перед глазами, а не открыться где-то среди
    // других вкладок (особенно когда их много и вкладка уже была открыта).
    try {
      opened.focus()
    } catch {
      /* браузер может не дать фокус — не критично, вкладка всё равно открыта */
    }
  } else {
    // Полная перезагрузка: cookie сессии меняется, клиентские контексты читают её заново
    window.location.assign(target)
  }
  return { ok: true }
}

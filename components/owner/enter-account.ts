// Вход в любой аккаунт от имени владельца (тот же механизм, что был на /owner).
// Сервер выпускает сессию сам: пароли сотрудников и водителей не нужны.

import { toast } from "sonner"

import { apiSend } from "@/hooks/use-json-api"

export interface EnterAccountResult {
  ok: boolean
  /** Человекочитаемая причина неудачи — для постоянного блока на странице */
  error?: string
}

/**
 * и58: живая полоса-страховка. Показывается в верхней части страницы —
 * единственном месте, которое точно читаемо даже над застывшим кадром
 * (жалобы №8–№11: верх страницы оставался живым — баннер и часы читались).
 * Внутри — НАСТОЯЩАЯ ссылка <a target="_blank">: клик человека открывает
 * вкладку кабинета даже под блокировщиком popup.
 */
function showCabHint(name: string, target: string) {
  if (typeof document === "undefined" || !document.body) return
  document.getElementById("loginex-cab-hint")?.remove()
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
    "display:flex",
    "align-items:center",
    "gap:10px",
    "flex-wrap:wrap",
  ].join(";")
  const text = document.createElement("span")
  text.textContent = `Кабинет (${name}) готов:`
  const open = document.createElement("a")
  open.href = target
  open.target = "_blank"
  open.rel = "noopener"
  open.setAttribute("data-cab-open-link", "1")
  open.textContent = "Открыть кабинет →"
  open.style.cssText = [
    "display:inline-block",
    "background:#fff",
    "color:#14532d",
    "font:700 14px/1 system-ui,-apple-system,sans-serif",
    "padding:9px 14px",
    "border-radius:10px",
    "text-decoration:none",
  ].join(";")
  const close = document.createElement("button")
  close.type = "button"
  close.textContent = "×"
  close.setAttribute("aria-label", "Закрыть подсказку")
  close.style.cssText =
    "position:absolute;right:4px;top:2px;background:none;border:0;color:#fff;font-size:22px;line-height:1;padding:8px 12px;cursor:pointer"
  close.addEventListener("click", () => bar.remove())
  bar.append(text, open, close)
  document.body.appendChild(bar)
  // Полоса живёт долго: она не мешает, а человеку всегда виден путь в кабинет
  setTimeout(() => bar.remove(), 15 * 60 * 1000)
}

export async function enterAccount(account: {
  kind: "staff" | "driver"
  id: string
  name: string
  fallbackHref?: string
}): Promise<EnterAccountResult> {
  // и58: вкладку кабинета БОЛЬШЕ НЕ ОТКРЫВАЕМ СКРИПТОМ. История вопроса:
  //   и42 — кабинет в новой вкладке: свежая вкладка «заморозиться» не может;
  //   и47 — на телефоне вернули переход в ту же вкладку: window.open после
  //         пары запросов к серверу уже не считается нажатием, Safari молча
  //         открывал вкладку в фоне;
  //   и56 — вкладку открыли синхронно с нажатием, но ПО ИМЕНИ «loginex-cab»
  //         (жалоба №10): window.open(«», имя) возвращал ту же отравленную
  //         вкладку владельца;
  //   и57 — всегда _blank + заставка. Жалоба №11 (18.11 23:16, журнал
  //         20:16 UTC): сервер безупречен — сессия выдана, /m открыт,
  //         сессии 200, сборка свежая, часы тикали, — но владелец снова
  //         видел форму входа. Вывод: единственное звено, которое журнал
  //         не видит, — сам момент открытия вкладки. На iPhone Safari
  //         программная вкладка (window.open после похода на сервер) может
  //         не показаться, а поверх живой страницы висит замороженный слой
  //         прошлой отрисовки (тот же феномен «форма-призрак над живым
  //         кабинетом», что 16–17.11).
  //   и58 — решение возвращено браузеру и человеку:
  //         (1) после выпуска сессии телефон переходит на страницу-
  //             пересадку /owner/open-account — простой экран без 3D,
  //             в композиторе WebKit нечему «замерзать»;
  //         (2) вкладку кабинета открывает НАСТОЯЩАЯ ссылка <a target=
  //             "_blank"> — клик человека; блокировщики popup такие ссылки
  //             не трогают, iOS надёжно показывает новую вкладку;
  //         (3) зелёная полоса с такой же живой кнопкой остаётся на
  //             странице-пересадке до перехода — путь в кабинет виден
  //             всегда, что бы ни случилось с вкладками.
  const standalone =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches === true ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true)
  const phone =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(pointer: coarse)").matches === true ||
      /iPhone|iPad|Android/i.test(window.navigator.userAgent))

  const body = account.kind === "driver" ? { driverId: account.id } : { userId: account.id }
  const result = await apiSend<{ redirectTo?: string; warning?: string }>(
    "/api/admin/impersonate",
    "POST",
    body,
  )
  if (!result.ok) {
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
    toast.error(hostingError, { duration: 12000 })
    return { ok: false, error: hostingError }
  }
  if (!check.ok) {
    const failure = (await check.json().catch(() => ({}))) as { error?: string; reason?: string }
    console.warn("[enter-account] сессия цели не действует:", failure?.reason ?? check.status)
    toast.error(failure?.error || "Аккаунт открылся, но его сессия не действует")
    return {
      ok: false,
      error: `${failure?.error || "аккаунт открылся, но его сессия не действует"}${failure?.reason ? ` (причина: ${failure.reason})` : ""}`,
    }
  }

  const target = (result.data as { redirectTo?: string } | null)?.redirectTo ?? account.fallbackHref ?? "/lm"

  // и58: телефон (обычный мобильный браузер) — через страницу-пересадку.
  // Никаких программных вкладок: человек сам откроет кабинет настоящей
  // ссылкой — и вкладка обязательно окажется перед глазами.
  if (!standalone && phone) {
    try {
      localStorage.setItem(
        "loginex_enter_account",
        JSON.stringify({ kind: account.kind, name: account.name, at: Date.now() }),
      )
    } catch {
      // localStorage недоступен — страница-пересадка справится и без имени
    }
    showCabHint(account.name, target)
    window.location.assign(
      `/owner/open-account?kind=${account.kind === "driver" ? "driver" : "staff"}&to=${encodeURIComponent(target)}`,
    )
    return { ok: true }
  }

  toast.success(`Открываю аккаунт: ${account.name}`)

  // и43: но в «отдельной программе» (PWA, с иконки на рабочем столе) новых
  // вкладок нет: window.open там открывает невидимое окно или чужой браузер,
  // и человек остаётся смотреть на старый экран. В программе — переход
  // в ЭТОМ ЖЕ окне: куда нажал — там и оказался, без двусмысленности.
  if (standalone) {
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

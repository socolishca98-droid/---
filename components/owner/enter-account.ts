// Вход в любой аккаунт от имени владельца (тот же механизм, что был на /owner).
// Сервер выпускает сессию сам: пароли сотрудников и водителей не нужны.

import { toast } from "sonner"

import { apiSend } from "@/hooks/use-json-api"

export interface EnterAccountResult {
  ok: boolean
  /** Человекочитаемая причина неудачи — для постоянного блока на странице */
  error?: string
}

export async function enterAccount(account: {
  kind: "staff" | "driver"
  id: string
  name: string
  fallbackHref?: string
}): Promise<EnterAccountResult> {
  // и56: вкладка кабинета открывается В МОМЕНТ НАЖАТИЯ — до всех запросов.
  // История вопроса, коротко:
  //   и42 — кабинет в новой вкладке: свежая вкладка «заморозиться» не может;
  //   и47 — на телефоне вернули переход в ту же вкладку: window.open после
  //         пары запросов к серверу уже не считается нажатием, Safari молча
  //         открывал вкладку в фоне, и человек смотрел на прежний экран;
  //   жалобы 16–18.11 показали обратную сторону того же телефона: в «своей»
  //         вкладке WebKit держит застывший кадр старой формы входа ПОВЕРХ
  //         живого кабинета — кадр переживает и полные загрузки кабинета
  //         (журнал: /m отдан документом, сессии 200, часы в углу тикают),
  //         и «встряхивание» композитора (и55), и даже перезапуск программы
  //         (18.11, жалоба №9: «закрываю, открываю — всегда этот экран»).
  //         Владелец жмёт «Войти как водитель» — сервер честно открывает
  //         кабинет, а человек смотрит на старую форму и делает вывод, что
  //         без логина и пароля водителя в аккаунт не попасть.
  // Решение и56: вкладку кабинета открываем СИНХРОННО с нажатием кнопки —
  // в этом случае iOS признаёт жест и показывает вкладку на переднем плане
  // (проблема и47 исчезает: не «фоновой» вкладки) — а адрес записываем в неё
  // уже после выпуска и проверки сессии. Вкладка создаётся с нуля, и застывшему
  // кадру в ней взяться неоткуда. Если браузер не дал вкладку (блокировщик,
  // редкие режимы) — прежний путь: переход в той же вкладке. В «программе»
  // с иконки (PWA, и43) вкладок нет — переход в том же окне, как и раньше.
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
    try {
      cabTab = window.open("", "loginex-cab")
    } catch {
      cabTab = null
    }
    if (cabTab) {
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

  // и56: кабинет — во вкладке, открытой в момент нажатия. Она свежая:
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
  // страшен: вкладка самовосстанавливается (и40/и41).
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

"use client"

// components/visual/page-transition.tsx
//
// Переходы между разделами (задача 9).
//
// App Router меняет содержимое страницы без «исчезновения» старой, поэтому
// ощущение плавности даёт не анимация ухода, а аккуратный вход: контент
// поднимается на 12 пикселей и проявляется за 320 мс по той же кривой, что у
// дорогих инструментов (быстрый старт, мягкое торможение).
//
// Ключ — текущий путь без query-параметров: фильтры и поиск, которые живут в
// строке запроса, не пересоздают страницу и не мигают анимацией.
//
// Сверху на время перехода появляется тонкая полоса: она честно показывает,
// что переход начался, и гаснет, когда новый путь отрисован. Полоса — CSS,
// никакой библиотеки прогресса и никаких таймеров на каждый кадр.

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"

interface PageTransitionProps {
  children: React.ReactNode
}

export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname() || "/"
  const [isNavigating, setIsNavigating] = useState(false)

  // Переход начинается с клика по внутренней ссылке: ловим на документе,
  // чтобы не трогать компоненты ссылок по всему приложению
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }

      const target = event.target as HTMLElement | null
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null
      if (!anchor || anchor.hasAttribute("download")) return
      if (anchor.target && anchor.target !== "_self") return

      const href = anchor.getAttribute("href") || ""
      if (!href.startsWith("/")) return

      const [path] = href.split(/[?#]/)
      if (!path || path === pathname) return

      setIsNavigating(true)
    }

    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [pathname])

  // Путь изменился (или страница не успела ответить) — полоса гаснет,
  // чтобы не «висеть» на экране
  useEffect(() => {
    if (!isNavigating) return

    const stop = window.setTimeout(() => setIsNavigating(false), 420)
    return () => window.clearTimeout(stop)
  }, [pathname, isNavigating])

  // Страховка: долгий переход (медленная сеть) не оставляет полосу навсегда
  useEffect(() => {
    if (!isNavigating) return

    const guard = window.setTimeout(() => setIsNavigating(false), 8000)
    return () => window.clearTimeout(guard)
  }, [isNavigating])

  return (
    <>
      <div className="nav-progress" data-active={isNavigating ? "true" : "false"}>
        <div className="nav-progress__bar" />
      </div>

      <div key={pathname} className="page-transition">
        {children}
      </div>
    </>
  )
}

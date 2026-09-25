// components/ui/skeletons.tsx
//
// Заготовки «скелетонов» для списков, таблиц и карточек.
//
// Зачем: пока данные едут, вместо спиннера показываем структуру страницы —
// список уже нарисован контуром и не «прыгает», когда приходят данные.
// Это заметно спокойнее для глаза, чем пустой экран с крутящимся колесом,
// особенно на медленной сети.

import { cn } from "@/lib/utils"

/** Одна мерцающая полоска. */
export function Shimmer({ className }: { className?: string }) {
  return <div className={cn("skeleton-shimmer rounded-md", className)} aria-hidden />
}

/** Несколько строк текста — для абзацев и плиток описания. */
export function LinesSkeleton({
  rows = 3,
  className,
}: {
  rows?: number
  className?: string
}) {
  return (
    <div className={cn("space-y-2", className)} role="status" aria-label="Загружаем данные">
      {Array.from({ length: rows }).map((_, index) => (
        <Shimmer
          key={index}
          className={cn("h-4", index === rows - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  )
}

/** Таблица: шапка и строки заданной высоты. */
export function TableSkeleton({
  rows = 6,
  columns = 5,
  className,
}: {
  rows?: number
  columns?: number
  className?: string
}) {
  return (
    <div
      className={cn("overflow-hidden rounded-lg border border-border/60", className)}
      role="status"
      aria-label="Загружаем список"
    >
      <div className="flex gap-4 border-b border-border/60 bg-muted/40 px-3 py-2.5">
        {Array.from({ length: columns }).map((_, index) => (
          <Shimmer key={index} className="h-3 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-border/40">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="flex items-center gap-4 px-3 py-3">
            {Array.from({ length: columns }).map((_, colIndex) => (
              <Shimmer
                key={colIndex}
                className={cn("h-4 flex-1", colIndex === 0 && "max-w-[38%]")}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Сетка карточек (автопарк, клиенты, рейсы, галерея фото). */
export function CardsSkeleton({
  count = 6,
  className,
  cardClassName,
}: {
  count?: number
  className?: string
  cardClassName?: string
}) {
  return (
    <div
      className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-3", className)}
      role="status"
      aria-label="Загружаем карточки"
    >
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className={cn("space-y-3 rounded-xl border border-border/60 p-4", cardClassName)}
        >
          <div className="flex items-center gap-3">
            <Shimmer className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Shimmer className="h-4 w-1/2" />
              <Shimmer className="h-3 w-1/3" />
            </div>
          </div>
          <Shimmer className="h-3 w-full" />
          <Shimmer className="h-3 w-4/5" />
          <div className="flex gap-2 pt-1">
            <Shimmer className="h-7 w-24 rounded-full" />
            <Shimmer className="h-7 w-16 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Полоса показателей (KPI) — четыре плитки сверху страницы. */
export function KpiSkeleton({
  count = 4,
  className,
}: {
  count?: number
  className?: string
}) {
  return (
    <div
      className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}
      role="status"
      aria-label="Загружаем показатели"
    >
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-xl border border-border/60 p-4">
          <Shimmer className="h-9 w-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Shimmer className="h-5 w-20" />
            <Shimmer className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Галерея фотографий — плитки с соотношением 4:3. */
export function PhotoGridSkeleton({
  count = 9,
  className,
}: {
  count?: number
  className?: string
}) {
  return (
    <div
      className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}
      role="status"
      aria-label="Загружаем фотографии"
    >
      {Array.from({ length: count }).map((_, index) => (
        <Shimmer key={index} className="aspect-[4/3] w-full rounded-xl" />
      ))}
    </div>
  )
}

/** Строки ленты (переписка, история рейса). */
export function FeedSkeleton({
  rows = 5,
  className,
  align = "left",
}: {
  rows?: number
  className?: string
  align?: "left" | "right"
}) {
  return (
    <div className={cn("space-y-3", className)} role="status" aria-label="Загружаем ленту">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className={cn("flex", align === "right" ? "justify-end" : "justify-start")}
        >
          <Shimmer
            className={cn("h-12 rounded-2xl", index % 3 === 0 ? "w-3/5" : "w-2/5")}
          />
        </div>
      ))}
    </div>
  )
}

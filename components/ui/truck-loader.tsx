"use client"

// components/ui/truck-loader.tsx
//
// Загрузочная анимация вместо спиннера: коробка складывается, перелетает
// в кузов грузовика, и грузовик уезжает. Сцена и тайминги — в globals.css
// (классы tl-box / tl-truck / tl-wheel), здесь только разметка.
//
// Цвет наследуется через currentColor: на страницах организатора задавайте
// text-primary, в мобильном приложении водителя — text-orange-500.
//
// Пример:
//   <div className="flex min-h-screen items-center justify-center">
//     <TruckLoader className="text-primary" />
//   </div>

import { cn } from "@/lib/utils"

export interface TruckLoaderProps {
  /** Высота сцены в пикселях (ширина пропорциональна). По умолчанию 56. */
  size?: number
  /** Подпись под анимацией (например, «Загружаем…»). */
  label?: string
  className?: string
}

export function TruckLoader({ size = 56, label, className }: TruckLoaderProps) {
  const width = Math.round(size * 2.5)

  return (
    <div
      role="status"
      aria-label={label ?? "Загрузка"}
      className={cn("truck-loader flex flex-col items-center gap-2", className)}
    >
      <svg
        width={width}
        height={size}
        viewBox="0 0 160 64"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        {/* Дорога */}
        <line
          x1="2"
          y1="62"
          x2="158"
          y2="62"
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="2"
          strokeLinecap="round"
        />

        {/* Коробка: складывается слева и улетает в кузов */}
        <g className="tl-box">
          <rect
            x="12"
            y="36"
            width="18"
            height="16"
            rx="2"
            fill="currentColor"
            fillOpacity="0.85"
          />
          {/* Скотч: крест на коробке */}
          <line
            x1="21"
            y1="36"
            x2="21"
            y2="52"
            stroke="#fff"
            strokeOpacity="0.85"
            strokeWidth="2"
          />
          <line
            x1="12"
            y1="44"
            x2="30"
            y2="44"
            stroke="#fff"
            strokeOpacity="0.5"
            strokeWidth="1.5"
          />
        </g>

        {/* Грузовик: ждёт коробку и уезжает */}
        <g className="tl-truck">
          {/* Кузов */}
          <rect
            x="74"
            y="26"
            width="52"
            height="26"
            rx="2"
            stroke="currentColor"
            strokeWidth="2.5"
            fill="none"
          />
          {/* Кабина */}
          <path
            d="M126 34h12l8 8v10h-20V34z"
            stroke="currentColor"
            strokeWidth="2.5"
            fill="none"
            strokeLinejoin="round"
          />
          {/* Окно кабины */}
          <rect x="130" y="38" width="7" height="6" rx="1" fill="currentColor" fillOpacity="0.35" />
          {/* Шасси */}
          <line x1="74" y1="52" x2="146" y2="52" stroke="currentColor" strokeWidth="2.5" />
          {/* Колёса */}
          <g className="tl-wheel">
            <circle cx="88" cy="56" r="6" stroke="currentColor" strokeWidth="2.5" fill="none" />
            <line x1="88" y1="51" x2="88" y2="61" stroke="currentColor" strokeWidth="1.5" />
            <line x1="83" y1="56" x2="93" y2="56" stroke="currentColor" strokeWidth="1.5" />
          </g>
          <g className="tl-wheel">
            <circle cx="132" cy="56" r="6" stroke="currentColor" strokeWidth="2.5" fill="none" />
            <line x1="132" y1="51" x2="132" y2="61" stroke="currentColor" strokeWidth="1.5" />
            <line x1="127" y1="56" x2="137" y2="56" stroke="currentColor" strokeWidth="1.5" />
          </g>
        </g>
      </svg>
      {label ? <span className="text-xs text-muted-foreground">{label}</span> : null}
    </div>
  )
}

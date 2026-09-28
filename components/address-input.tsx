"use client"

// components/address-input.tsx
//
// Помощник адреса: пока человек печатает, предлагаем варианты места
// (Nominatim/OSM) и по выбору возвращаем адрес и координаты. Раньше адрес
// приходилось угадывать или сразу вбивать координаты — теперь подсказки
// видны прямо в поле, а ручной ввод никто не отменял.

import { useEffect, useRef, useState } from "react"
import { MapPin, Search } from "lucide-react"
import { searchPlaces, type GeoItem } from "@/lib/geo/nominatim"
import { cn } from "@/lib/utils"

interface AddressInputProps {
  value: string
  onChange: (value: string) => void
  /** Вызывается, когда человек выбрал подсказку: отдаём адрес и координаты */
  onPick?: (item: GeoItem) => void
  placeholder?: string
  id?: string
  className?: string
}

export function AddressInput({
  value,
  onChange,
  onPick,
  placeholder = "Адрес или название места",
  id,
  className,
}: AddressInputProps) {
  const [items, setItems] = useState<GeoItem[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  // Подсказки ищем с задержкой: не стучим в геокодер на каждый символ
  useEffect(() => {
    const query = value.trim()
    if (query.length < 3) {
      setItems([])
      setOpen(false)
      return
    }
    let alive = true
    setLoading(true)
    const timer = setTimeout(async () => {
      const found = await searchPlaces(query, 5)
      if (!alive) return
      setItems(found)
      setActive(0)
      setOpen(true)
      setLoading(false)
    }, 500)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [value])

  // Клик мимо списка закрывает подсказки
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [])

  const pick = (item: GeoItem) => {
    onChange(item.label)
    onPick?.(item)
    setOpen(false)
    setItems([])
  }

  const showList = open && items.length > 0

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
        <input
          id={id}
          type="text"
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
            setOpen(true)
          }}
          onFocus={() => items.length > 0 && setOpen(true)}
          onKeyDown={(event) => {
            if (!showList) return
            if (event.key === "ArrowDown") {
              event.preventDefault()
              setActive((prev) => Math.min(prev + 1, items.length - 1))
            } else if (event.key === "ArrowUp") {
              event.preventDefault()
              setActive((prev) => Math.max(prev - 1, 0))
            } else if (event.key === "Enter") {
              event.preventDefault()
              pick(items[active])
            } else if (event.key === "Escape") {
              setOpen(false)
            }
          }}
          placeholder={placeholder}
          className="flex h-10 w-full rounded-lg border border-input bg-background/60 pl-9 pr-3 text-sm transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        />
      </div>

      {showList && (
        <ul className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-border/70 bg-popover shadow-xl">
          {items.map((item, index) => (
            <li key={`${item.lat}-${item.lng}-${index}`}>
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault()
                  pick(item)
                }}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors",
                  index === active
                    ? "bg-accent text-accent-foreground"
                    : "text-popover-foreground",
                )}
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <span className="line-clamp-2">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && loading && value.trim().length >= 3 && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
          ищем…
        </div>
      )}
    </div>
  )
}

"use client"

// components/dashboard/map/map-search.tsx
//
// Поиск на карте для логиста: кнопка-лупа в командной панели раскрывается
// в строку поиска с подсказками (Nominatim/OSM). Выбор места плавно
// переносит карту и ставит временную метку с названием. Полэкрана не
// занимает: строка живёт поверх карты и закрывается по Esc и клику мимо.

import { useEffect, useRef, useState } from "react"
import type { Map as LeafletMap } from "leaflet"
import L from "leaflet"
import { Search, X } from "lucide-react"
import { searchPlaces, type GeoItem } from "@/lib/geo/nominatim"

interface MapSearchProps {
  map: LeafletMap | null
}

export function MapSearch({ map }: MapSearchProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [items, setItems] = useState<GeoItem[]>([])
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const markerRef = useRef<L.Marker | null>(null)

  useEffect(() => {
    const text = query.trim()
    if (text.length < 3) {
      setItems([])
      return
    }
    let alive = true
    const timer = setTimeout(async () => {
      const found = await searchPlaces(text, 6)
      if (!alive) return
      setItems(found)
      setActive(0)
    }, 450)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [query])

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [])

  // Временная метка живёт до следующего поиска или закрытия
  useEffect(() => {
    return () => {
      markerRef.current?.remove()
      markerRef.current = null
    }
  }, [])

  const goTo = (item: GeoItem) => {
    if (!map) return
    markerRef.current?.remove()
    markerRef.current = L.marker([item.lat, item.lng], {
      title: item.short,
      keyboard: false,
    })
      .addTo(map)
      .bindPopup(`<div style="font:12px/1.4 system-ui">${item.label}</div>`)
    map.flyTo([item.lat, item.lng], Math.max(map.getZoom(), 13), { duration: 0.9 })
    markerRef.current.openPopup()
    setQuery(item.short)
    setItems([])
    setOpen(false)
  }

  const close = () => {
    setOpen(false)
    markerRef.current?.remove()
    markerRef.current = null
  }

  return (
    <div ref={boxRef} className="relative pointer-events-auto">
      {open ? (
        <div className="flex items-center gap-1 rounded-2xl border border-white/10 bg-[#111319]/95 px-2 py-1.5 shadow-xl backdrop-blur-xl">
          <Search className="ml-1 h-4 w-4 flex-shrink-0 text-gray-400" />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setItems([])
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                close()
              } else if (event.key === "ArrowDown" && items.length > 0) {
                event.preventDefault()
                setActive((prev) => Math.min(prev + 1, items.length - 1))
              } else if (event.key === "ArrowUp" && items.length > 0) {
                event.preventDefault()
                setActive((prev) => Math.max(prev - 1, 0))
              } else if (event.key === "Enter" && items[active]) {
                goTo(items[active])
              }
            }}
            placeholder="Адрес, город, объект…"
            className="w-56 bg-transparent text-sm text-white placeholder:text-gray-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={close}
            title="Закрыть поиск"
            className="rounded-lg p-1 text-gray-400 transition-colors hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Поиск на карте: адрес, город, объект"
          className="p-2.5 backdrop-blur-xl border rounded-2xl shadow-xl transition-all cursor-pointer bg-[#111319]/90 border-white/[0.08] text-gray-400 hover:text-white hover:border-white/20"
        >
          <Search className="h-4 w-4" />
        </button>
      )}

      {open && items.length > 0 && (
        <ul className="absolute top-full left-0 z-[1100] mt-2 w-80 overflow-hidden rounded-2xl border border-white/10 bg-[#12141c]/98 p-1.5 shadow-2xl backdrop-blur-2xl">
          {items.map((item, index) => (
            <li key={`${item.lat}-${item.lng}-${index}`}>
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault()
                  goTo(item)
                }}
                onMouseEnter={() => setActive(index)}
                className={`w-full rounded-xl px-3 py-2 text-left text-xs leading-snug transition-colors ${
                  index === active ? "bg-white/10 text-white" : "text-gray-300 hover:bg-white/5"
                }`}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

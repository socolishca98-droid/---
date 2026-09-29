"use client"

// app/m/nearby/page.tsx
//
// «Рядом» для водителя: ближайшие АЗС, зоны отдыха и отели от текущей
// позиции (или от базы, пока позиции нет). Данные OpenStreetMap/Overpass,
// список отсортирован по расстоянию, каждая точка открывается в навигаторе.

import { useCallback, useEffect, useState } from "react"
import { Coffee, Fuel, BedDouble, Loader2, MapPin, Navigation } from "lucide-react"
import { BottomNav } from "@/components/driver-mobile/bottom-nav"
import { SosButton } from "@/components/driver-mobile/sos-button"
import { useDriverSession } from "@/hooks/use-driver-session"
import {
  formatMeters,
  searchNearby,
  type NearbyKind,
  type NearbyPlace,
} from "@/lib/geo/overpass"

const CATEGORIES: Array<{ kind: NearbyKind; label: string; icon: any }> = [
  { kind: "fuel", label: "АЗС", icon: Fuel },
  { kind: "rest", label: "Отдых", icon: Coffee },
  { kind: "hotel", label: "Отели", icon: BedDouble },
]

export default function NearbyPage() {
  const { driver } = useDriverSession()
  const [kind, setKind] = useState<NearbyKind>("fuel")
  const [places, setPlaces] = useState<NearbyPlace[]>([])
  const [loading, setLoading] = useState(false)
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null)
  const [positionNote, setPositionNote] = useState("")

  // Позиция водителя: сначала живые координаты устройства, затем отметка GPS
  // из серверной сессии (useDriverSession — единый источник для всего /m)
  useEffect(() => {
    let alive = true
    const useFallback = () => {
      if (!alive) return
      const lat = Number(driver?.latitude)
      const lng = Number(driver?.longitude)
      if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
        setPosition({ lat, lng })
        setPositionNote("Позиция по последней отметке GPS")
      } else {
        setPositionNote("Нет координат: включите геолокацию или отправьте точку из рейса")
      }
    }

    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!alive) return
          setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude })
          setPositionNote("Текущая позиция телефона")
        },
        useFallback,
        { timeout: 6000, maximumAge: 60000 },
      )
    } else {
      useFallback()
    }
    return () => {
      alive = false
    }
  }, [driver])

  const load = useCallback(async () => {
    if (!position) return
    setLoading(true)
    const found = await searchNearby(position.lat, position.lng, kind)
    setPlaces(found)
    setLoading(false)
  }, [position, kind])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="min-h-screen bg-[#09090b] text-white m-nav-pad">
      <header className="sticky top-0 z-10 border-b border-gray-800/50 bg-[#09090b]/95 backdrop-blur-lg">
        <div className="px-4 py-3">
          <h1 className="text-lg font-bold">Рядом с вами</h1>
          <p className="text-xs text-gray-500">{positionNote || "Определяем позицию…"}</p>
        </div>
      </header>

      <div className="space-y-3 p-4">
        <div className="grid grid-cols-3 gap-2">
          {CATEGORIES.map((category) => (
            <button
              key={category.kind}
              onClick={() => setKind(category.kind)}
              className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-xs font-semibold transition-colors ${
                kind === category.kind
                  ? "border-orange-500/60 bg-orange-500/15 text-orange-300"
                  : "border-gray-800 bg-[#101013] text-gray-400"
              }`}
            >
              <category.icon className="h-5 w-5" />
              {category.label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Ищем поблизости…
          </div>
        )}

        {!loading && position && places.length === 0 && (
          <p className="py-10 text-center text-sm text-gray-500">
            В радиусе 7 км ничего не нашлось. Попробуйте другую категорию или
            подъедьте ближе к трассе.
          </p>
        )}

        {!loading && !position && (
          <p className="py-10 text-center text-sm text-gray-500">
          Нет позиции: разрешите геолокацию или отметьте точку в рейсе.
          </p>
        )}

        <ul className="space-y-2">
          {places.map((place, index) => (
            <li
              key={`${place.lat}-${place.lng}-${index}`}
              className="flex items-center gap-3 rounded-xl border border-gray-800 bg-[#101013] p-3"
            >
              <MapPin className="h-4 w-4 flex-shrink-0 text-orange-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{place.name}</p>
                <p className="text-xs text-gray-500">
                  {place.tag} · {formatMeters(place.distanceM)}
                </p>
              </div>
              <a
                href={`https://yandex.ru/maps/?pt=${place.lng},${place.lat}&z=16&l=map`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-2 text-xs font-semibold text-gray-200"
              >
                <Navigation className="h-3.5 w-3.5" />
                Маршрут
              </a>
            </li>
          ))}
        </ul>

        {position && (
          <button
            onClick={() => void load()}
            className="w-full rounded-xl border border-gray-800 bg-[#101013] py-2.5 text-sm font-semibold text-gray-300"
          >
            Обновить список
          </button>
        )}
      </div>

      <BottomNav />
      <SosButton />
    </div>
  )
}

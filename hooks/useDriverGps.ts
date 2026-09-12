'use client'

import { useEffect, useRef, useState } from 'react'

type Coords = {
  lat: number
  lon: number
  speed?: number | null
}

export function useDriverGps(driverId: string | null) {
  const [lastCoords, setLastCoords] = useState<Coords | null>(null)
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'ok' | 'error'>('idle')

  const watchIdRef = useRef<number | null>(null)
  const lastSendRef = useRef<number>(0)

  useEffect(() => {
    if (!driverId) return
    if (!('geolocation' in navigator)) {
      setGpsStatus('error')
      return
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lon = pos.coords.longitude
        const speed = pos.coords.speed

        // защита от телепортаций (>100 км)
        if (
          lastCoords &&
          (Math.abs(lat - lastCoords.lat) > 1 ||
            Math.abs(lon - lastCoords.lon) > 1)
        ) {
          return
        }

        setGpsStatus('ok')
        setLastCoords({ lat, lon, speed })

        const now = Date.now()
        if (now - lastSendRef.current < 5000) return // троттлинг 5 сек
        lastSendRef.current = now

        fetch('/api/m/location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            driverId,
            latitude: lat,
            longitude: lon,
            speed,
          }),
        })
      },
      () => {
        setGpsStatus('error')
        // НИЧЕГО не отправляем при ошибке
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 10000,
      }
    )

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
    }
  }, [driverId, lastCoords])

  return { lastCoords, gpsStatus }
}

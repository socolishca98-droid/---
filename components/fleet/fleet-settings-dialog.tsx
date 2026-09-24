// components/fleet/fleet-settings-dialog.tsx

"use client"

import { useState, useEffect, useRef } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, MapPin, AlertTriangle, CheckCircle, Search } from "lucide-react"
import { toast } from "sonner"

interface FleetSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentSettings: any
  onSuccess: () => void
}

export function FleetSettingsDialog({ open, onOpenChange, currentSettings, onSuccess }: FleetSettingsDialogProps) {
  const [loading, setLoading] = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  const [name, setName] = useState("")
  const [address, setAddress] = useState("")
  const [lat, setLat] = useState("")
  const [lng, setLng] = useState("")
  const [geocodeStatus, setGeocodeStatus] = useState<'none' | 'success' | 'error'>('none')
  const [geocodeMessage, setGeocodeMessage] = useState("")

  // Реквизиты перевозчика для печатных документов (задача 3, пункт 3).
  // Свои у каждой организации — печатаются в ТТН, путевом листе и заявке.
  const [requisites, setRequisites] = useState({
    legalName: "",
    inn: "",
    kpp: "",
    ogrn: "",
    legalAddress: "",
    phone: "",
    email: "",
    bankName: "",
    bankBic: "",
    bankAccount: "",
    signerName: "",
    signerPosition: "",
  })

  useEffect(() => {
    if (open && currentSettings) {
      setName(currentSettings.parkName || "")
      setAddress(currentSettings.baseAddress || "")
      setLat(currentSettings.baseLat?.toString() || "")
      setLng(currentSettings.baseLng?.toString() || "")
      setGeocodeStatus(currentSettings.baseLat ? 'success' : 'none')
      setGeocodeMessage("")
      setRequisites((prev) => {
        const next = { ...prev }
        for (const key of Object.keys(prev) as (keyof typeof prev)[]) {
          next[key] = currentSettings[key] ?? ""
        }
        return next
      })
    }
  }, [open, currentSettings])

  // Тестовый геокодинг адреса
  const testGeocode = async () => {
    if (!address.trim()) {
      toast.error("Введите адрес")
      return
    }
    
    setGeocoding(true)
    setGeocodeStatus('none')
    
    try {
      const queries = [
        address,
        `${address}, Россия`,
      ]
      
      for (const query of queries) {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`
        
        const response = await fetch(url, {
          headers: { 'User-Agent': 'TMS-AI-Logistics/1.0' }
        })
        
        if (response.ok) {
          const data = await response.json()
          
          if (data.length > 0) {
            const foundLat = parseFloat(data[0].lat)
            const foundLng = parseFloat(data[0].lon)
            
            setLat(foundLat.toFixed(6))
            setLng(foundLng.toFixed(6))
            setGeocodeStatus('success')
            setGeocodeMessage(`Найдено: ${data[0].display_name.slice(0, 80)}...`)
            
            toast.success("Координаты определены!")
            return
          }
        }
        
        await new Promise(r => setTimeout(r, 1000))
      }
      
      setGeocodeStatus('error')
      setGeocodeMessage("Адрес не найден. Введите координаты вручную или уточните адрес.")
      toast.error("Не удалось найти адрес")
      
    } catch (error) {
      console.error('Geocode error:', error)
      setGeocodeStatus('error')
      setGeocodeMessage("Ошибка геокодинга. Введите координаты вручную.")
      toast.error("Ошибка при поиске адреса")
    } finally {
      setGeocoding(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    const parsedLat = parseFloat(lat)
    const parsedLng = parseFloat(lng)
    
    // Проверяем что координаты валидные
    if (address && (!lat || !lng || isNaN(parsedLat) || isNaN(parsedLng))) {
      toast.error("Укажите координаты или найдите адрес")
      return
    }
    
    setLoading(true)

    try {
      const res = await fetch("/api/fleet/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          parkName: name, 
          baseAddress: address,
          baseLat: lat ? parsedLat : null,
          baseLng: lng ? parsedLng : null,
          // реквизиты уходят как есть; пустая строка означает «очистить поле»
          ...requisites,
        }),
      })

      const data = await res.json()
      
      if (!res.ok) throw new Error(data.error || "Ошибка сохранения")

      toast.success("Настройки сохранены")
      
      if (data.geocodeResult) {
        console.log('[Settings] Geocode result:', data.geocodeResult)
      }
      
      onSuccess()
      onOpenChange(false)
    } catch (error: any) {
      toast.error(error.message || "Не удалось сохранить настройки")
    } finally {
      setLoading(false)
    }
  }

  // Открыть координаты в Google Maps для проверки
  const openInMaps = () => {
    if (lat && lng) {
      window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Настройки автопарка</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Название */}
          <div className="space-y-2">
            <Label>Название парка</Label>
            <Input 
              value={name} 
              onChange={(e) => setName(e.target.value)} 
              placeholder="Мой Автопарк" 
            />
          </div>
          
          {/* Адрес с кнопкой поиска */}
          <div className="space-y-2">
            <Label>Адрес базы</Label>
            <div className="flex gap-2">
              <Input 
                value={address} 
                onChange={(e) => {
                  setAddress(e.target.value)
                  setGeocodeStatus('none')
                }} 
                placeholder="г. Ярославль, ул. Промышленная 5" 
                className="flex-1"
              />
              <Button 
                type="button" 
                variant="outline" 
                onClick={testGeocode}
                disabled={geocoding || !address.trim()}
              >
                {geocoding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Введите полный адрес и нажмите поиск, или укажите координаты вручную
            </p>
          </div>
          
          {/* Статус геокодинга */}
          {geocodeStatus !== 'none' && (
            <div className={`p-3 rounded-lg text-sm flex items-start gap-2 ${
              geocodeStatus === 'success' 
                ? 'bg-green-500/10 border border-green-500/20 text-green-400' 
                : 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
            }`}>
              {geocodeStatus === 'success' 
                ? <CheckCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                : <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              }
              <span>{geocodeMessage}</span>
            </div>
          )}
          
          {/* Координаты */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Координаты</Label>
              {lat && lng && (
                <button 
                  type="button"
                  onClick={openInMaps}
                  className="text-xs text-blue-400 hover:underline flex items-center gap-1"
                >
                  <MapPin className="h-3 w-3" />
                  Проверить на карте
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Широта (lat)</Label>
                <Input 
                  value={lat} 
                  onChange={(e) => setLat(e.target.value)} 
                  placeholder="57.6261" 
                  type="text"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Долгота (lng)</Label>
                <Input 
                  value={lng} 
                  onChange={(e) => setLng(e.target.value)} 
                  placeholder="39.8845" 
                  type="text"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Координаты можно найти на{' '}
              <a 
                href="https://www.google.com/maps" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                Google Maps
              </a>
              {' '}(правый клик → "Что здесь?")
            </p>
          </div>
          
          {/* Примеры координат */}
          <div className="p-3 bg-secondary/50 rounded-lg">
            <p className="text-xs text-muted-foreground mb-2">Примеры координат:</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button 
                type="button"
                onClick={() => { setLat("55.7558"); setLng("37.6173"); setGeocodeStatus('success'); }}
                className="text-left hover:text-primary"
              >
                📍 Москва: 55.7558, 37.6173
              </button>
              <button 
                type="button"
                onClick={() => { setLat("57.6261"); setLng("39.8845"); setGeocodeStatus('success'); }}
                className="text-left hover:text-primary"
              >
                📍 Ярославль: 57.6261, 39.8845
              </button>
              <button 
                type="button"
                onClick={() => { setLat("59.9343"); setLng("30.3351"); setGeocodeStatus('success'); }}
                className="text-left hover:text-primary"
              >
                📍 СПб: 59.9343, 30.3351
              </button>
              <button 
                type="button"
                onClick={() => { setLat("55.7887"); setLng("49.1221"); setGeocodeStatus('success'); }}
                className="text-left hover:text-primary"
              >
                📍 Казань: 55.7887, 49.1221
              </button>
            </div>
          </div>

          {/* Реквизиты для печатных документов */}
          <div className="space-y-3 border-t pt-4">
            <div>
              <Label>Реквизиты для документов</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Печатаются в транспортной накладной, путевом листе и договоре-заявке
                от имени вашей организации. Незаполненные поля в бланке остаются
                пустыми строками для заполнения от руки.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Наименование (как в документах)</Label>
              <Input
                value={requisites.legalName}
                onChange={(e) => setRequisites((prev) => ({ ...prev, legalName: e.target.value }))}
                placeholder="ИП Фролов Иван Александрович"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">ИНН</Label>
                <Input
                  value={requisites.inn}
                  onChange={(e) => setRequisites((prev) => ({ ...prev, inn: e.target.value }))}
                  placeholder="770000000000"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">ОГРН / ОГРНИП</Label>
                <Input
                  value={requisites.ogrn}
                  onChange={(e) => setRequisites((prev) => ({ ...prev, ogrn: e.target.value }))}
                  placeholder="320000000000000"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Юридический адрес</Label>
              <Input
                value={requisites.legalAddress}
                onChange={(e) => setRequisites((prev) => ({ ...prev, legalAddress: e.target.value }))}
                placeholder="150000, г. Ярославль, ул. Промышленная, д. 5"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Телефон</Label>
                <Input
                  value={requisites.phone}
                  onChange={(e) => setRequisites((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="+7 900 000-00-00"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">E-mail</Label>
                <Input
                  value={requisites.email}
                  onChange={(e) => setRequisites((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="mail@example.ru"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Банк</Label>
              <Input
                value={requisites.bankName}
                onChange={(e) => setRequisites((prev) => ({ ...prev, bankName: e.target.value }))}
                placeholder="Отделение банка, г. Ярославль"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">БИК</Label>
                <Input
                  value={requisites.bankBic}
                  onChange={(e) => setRequisites((prev) => ({ ...prev, bankBic: e.target.value }))}
                  placeholder="047888777"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Расчётный счёт</Label>
                <Input
                  value={requisites.bankAccount}
                  onChange={(e) => setRequisites((prev) => ({ ...prev, bankAccount: e.target.value }))}
                  placeholder="40802810000000000001"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Подписант (ФИО)</Label>
                <Input
                  value={requisites.signerName}
                  onChange={(e) => setRequisites((prev) => ({ ...prev, signerName: e.target.value }))}
                  placeholder="Фролов И. А."
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Должность подписанта</Label>
                <Input
                  value={requisites.signerPosition}
                  onChange={(e) => setRequisites((prev) => ({ ...prev, signerPosition: e.target.value }))}
                  placeholder="Индивидуальный предприниматель"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Сохранить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
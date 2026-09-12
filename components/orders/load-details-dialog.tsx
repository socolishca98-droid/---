"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { MapPin, Truck, Phone, Star, Shield, Navigation, CreditCard, Calendar, ArrowRight, User } from "lucide-react"

interface LoadDetailsProps {
  isOpen: boolean
  onClose: () => void
  load: any
  onImport: () => void
}

export function LoadDetailsDialog({ isOpen, onClose, load, onImport }: LoadDetailsProps) {
  if (!load) return null

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-bold">
              Груз {load.routeFrom} — {load.routeTo}
            </DialogTitle>
            <div className="text-sm text-muted-foreground mr-8">
              ID: {load.atiLoadId || load.id}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* 1. Маршрут и Основное */}
          <div className="bg-secondary/20 p-4 rounded-lg border border-border">
            <div className="flex flex-col md:flex-row gap-6 justify-between items-start">
              
              <div className="space-y-4 flex-1">
                {/* Откуда */}
                <div className="flex gap-3">
                  <div className="mt-1">
                    <div className="h-3 w-3 rounded-full bg-green-500 ring-4 ring-green-500/20" />
                    <div className="h-full w-0.5 bg-border mx-auto my-1" />
                  </div>
                  <div>
                    <div className="font-bold text-lg">{load.routeFrom}</div>
                    <div className="text-sm text-muted-foreground flex items-center gap-2">
                      <Calendar className="h-3 w-3" />
                      {load.loadingDate ? new Date(load.loadingDate).toLocaleDateString() : 'Готов к загрузке'}
                    </div>
                  </div>
                </div>

                {/* Куда */}
                <div className="flex gap-3">
                  <div className="mt-1">
                    <div className="h-3 w-3 rounded-full bg-red-500 ring-4 ring-red-500/20" />
                  </div>
                  <div>
                    <div className="font-bold text-lg">{load.routeTo}</div>
                    <div className="text-sm text-muted-foreground">{load.distance} км</div>
                  </div>
                </div>
              </div>

              {/* Ставка */}
              <div className="bg-card p-4 rounded-lg border shadow-sm min-w-[200px] text-right">
                <div className="text-sm text-muted-foreground mb-1">Ставка</div>
                <div className="text-2xl font-bold text-primary">
                  {load.price ? `${load.price.toLocaleString()} ₽` : 'Договорная'}
                </div>
                <div className="text-xs text-muted-foreground mt-1 flex items-center justify-end gap-1">
                  <CreditCard className="h-3 w-3" />
                  {load.paymentType === 'bank_transfer' ? 'Безнал' : 'Наличные'}
                  {load.vatIncluded && ' (с НДС)'}
                </div>
              </div>
            </div>
          </div>

          {/* 2. Груз и Транспорт */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 border rounded-lg space-y-2">
              <h3 className="font-semibold flex items-center gap-2">
                <Truck className="h-4 w-4 text-blue-500" /> Транспорт
              </h3>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{load.truckType || 'Любой'}</Badge>
                {load.loadingType && <Badge variant="outline">{load.loadingType} загр.</Badge>}
              </div>
            </div>
            
            <div className="p-4 border rounded-lg space-y-2">
              <h3 className="font-semibold flex items-center gap-2">
                <User className="h-4 w-4 text-orange-500" /> Заказчик
              </h3>
              <div>
                <div className="font-medium">{load.firmName}</div>
                <div className="flex items-center gap-1 text-yellow-500 text-sm mt-1">
                  <Star className="h-3 w-3 fill-current" /> 
                  <span className="text-foreground">4.8</span>
                  <span className="text-muted-foreground ml-2">(ATI код: {load.firmId || '—'})</span>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Карта (Заглушка визуальная) */}
          <div className="relative h-48 bg-muted rounded-lg flex items-center justify-center overflow-hidden border">
            <div className="absolute inset-0 bg-[url('https://api.mapbox.com/styles/v1/mapbox/light-v10/static/pin-s-a+9ed4bd(37.617,55.755),pin-s-b+000(30.335,59.934)/auto/600x300?access_token=YOUR_TOKEN')] opacity-20 bg-cover bg-center" />
            <div className="text-center z-10">
              <Navigation className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground font-medium">Интерактивная карта маршрута</p>
              <p className="text-xs text-muted-foreground">{load.distance} км · ~{(load.distance / 70).toFixed(0)} ч в пути</p>
            </div>
          </div>

          <Separator />

          {/* 4. Контакты */}
          <div className="flex items-center justify-between bg-green-50 dark:bg-green-950/20 p-4 rounded-lg border border-green-100 dark:border-green-900/50">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center text-green-700 dark:text-green-400">
                <Phone className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Контакты</div>
                <div className="font-mono font-medium text-lg">
                  {load.contactPhone || 'Телефон скрыт'}
                </div>
              </div>
            </div>
            
            <Button onClick={onImport} className="bg-blue-600 hover:bg-blue-700">
              Взять в работу <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  )
}
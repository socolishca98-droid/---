// components/driver-mobile/current-order-card.tsx

"use client"

import { 
  MapPin, Phone, Navigation, Package, 
  ArrowRight, CheckCircle, FileText 
} from "lucide-react"
import Link from "next/link"

interface CurrentOrderCardProps {
  order: any
  onStatusChange: (status: string) => void
}

export function CurrentOrderCard({ order, onStatusChange }: CurrentOrderCardProps) {
  if (!order) return null

  const openNavigator = () => {
    // Открываем Яндекс.Навигатор или Карты
    window.open(`https://yandex.ru/maps/?rtext=~${encodeURIComponent(order.routeTo)}&rtt=auto`, '_blank')
  }

  return (
    <div className="bg-[#1a1a1f] rounded-2xl p-5 border border-gray-800 shadow-xl animate-in slide-in-from-bottom-5">
      {/* Заголовок */}
      <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-orange-500/10 rounded-lg">
            <Package className="h-5 w-5 text-orange-500" />
          </div>
          <div>
            <h3 className="font-bold text-lg">Текущий рейс</h3>
            <p className="text-xs text-gray-500">#{order.id.slice(-6)}</p>
          </div>
        </div>
        <div className="px-3 py-1 bg-blue-500/20 text-blue-400 text-xs font-bold rounded-full uppercase">
          {order.status === 'in_transit' ? 'В пути' : 'Назначен'}
        </div>
      </div>

      {/* Маршрут */}
      <div className="space-y-6 mb-6 relative">
        {/* Линия маршрута */}
        <div className="absolute left-[11px] top-3 bottom-3 w-0.5 bg-gray-800" />

        {/* Откуда */}
        <div className="relative pl-8">
          <div className="absolute left-0 top-1 w-6 h-6 bg-[#1a1a1f] border-2 border-green-500 rounded-full flex items-center justify-center z-10">
            <div className="w-2 h-2 bg-green-500 rounded-full" />
          </div>
          <div className="text-xs text-gray-500 mb-1">Погрузка</div>
          <div className="font-medium text-base leading-tight">{order.routeFrom}</div>
        </div>

        {/* Куда */}
        <div className="relative pl-8">
          <div className="absolute left-0 top-1 w-6 h-6 bg-[#1a1a1f] border-2 border-red-500 rounded-full flex items-center justify-center z-10">
            <div className="w-2 h-2 bg-red-500 rounded-full" />
          </div>
          <div className="text-xs text-gray-500 mb-1">Выгрузка</div>
          <div className="font-medium text-base leading-tight">{order.routeTo}</div>
        </div>
      </div>

      {/* Инфо о грузе */}
      <div className="flex gap-4 mb-6 bg-gray-800/30 p-3 rounded-xl">
        <div>
          <div className="text-xs text-gray-500">Груз</div>
          <div className="font-medium">{order.cargoType}</div>
        </div>
        <div className="w-px bg-gray-700" />
        <div>
          <div className="text-xs text-gray-500">Вес</div>
          <div className="font-medium">{(order.weight / 1000).toFixed(1)} т</div>
        </div>
        <div className="w-px bg-gray-700" />
        <div>
          <div className="text-xs text-gray-500">Оплата</div>
          <div className="font-medium text-green-500">{order.price?.toLocaleString()} ₽</div>
        </div>
      </div>

      {/* Кнопки действий */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <button 
          onClick={openNavigator}
          className="py-3 bg-blue-600 hover:bg-blue-700 active:scale-95 transition-all rounded-xl font-semibold flex items-center justify-center gap-2"
        >
          <Navigation className="h-5 w-5" />
          Маршрут
        </button>
        <a 
          href={`tel:${order.clientContact}`}
          className="py-3 bg-gray-800 hover:bg-gray-700 active:scale-95 transition-all rounded-xl font-semibold flex items-center justify-center gap-2"
        >
          <Phone className="h-5 w-5" />
          Клиент
        </a>
      </div>

      {/* Кнопка статуса рейса */}
      {order.status !== 'in_transit' ? (
        <button 
          onClick={() => onStatusChange('in_transit')}
          className="w-full py-4 bg-green-600 hover:bg-green-700 active:scale-95 transition-all rounded-xl font-bold text-lg flex items-center justify-center gap-2 shadow-lg shadow-green-900/20"
        >
          <ArrowRight className="h-6 w-6" />
          Поехали!
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-3">
           <Link href={`/m/orders/${order.id}`} className="w-full">
            <button className="w-full py-3 bg-gray-800 rounded-xl font-medium flex items-center justify-center gap-2">
              <FileText className="h-5 w-5" />
              Детали
            </button>
           </Link>
           <button 
            onClick={() => onStatusChange('delivered')}
            className="w-full py-3 bg-green-600 rounded-xl font-medium flex items-center justify-center gap-2"
           >
             <CheckCircle className="h-5 w-5" />
             Завершить
           </button>
        </div>
      )}
    </div>
  )
}
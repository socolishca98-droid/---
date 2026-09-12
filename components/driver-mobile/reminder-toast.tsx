// components/driver-mobile/reminder-toast.tsx

"use client"

import { useState, useEffect, useCallback } from "react"
import { X, Clock, Camera, Coffee, Fuel, MessageSquare, AlertTriangle } from "lucide-react"
import Link from "next/link"

interface Reminder {
  id: string
  type: 'driving' | 'photo' | 'rest' | 'fuel' | 'message' | 'rest-warning'
  title: string
  message: string
  priority: 'low' | 'medium' | 'high'
  autoDismiss?: number // секунды
  link?: string
}

interface ReminderToastProps {
  currentDrivingSeconds?: number
  currentStatus?: string
  unreadMessages?: number
  onDismiss?: (id: string) => void
}

const REMINDER_CONFIG = {
  driving: { icon: Clock, color: 'bg-orange-500', borderColor: 'border-orange-500/30' },
  photo: { icon: Camera, color: 'bg-blue-500', borderColor: 'border-blue-500/30' },
  rest: { icon: Coffee, color: 'bg-red-500', borderColor: 'border-red-500/30' },
  'rest-warning': { icon: AlertTriangle, color: 'bg-yellow-500', borderColor: 'border-yellow-500/30' },
  fuel: { icon: Fuel, color: 'bg-purple-500', borderColor: 'border-purple-500/30' },
  message: { icon: MessageSquare, color: 'bg-green-500', borderColor: 'border-green-500/30' },
}

// Статусы при которых нужно напомнить о фото
const PHOTO_STATUSES = ['loading', 'unloading', 'fueling']

export function ReminderToast({ 
  currentDrivingSeconds = 0, 
  currentStatus = 'driving',
  unreadMessages = 0,
  onDismiss 
}: ReminderToastProps) {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [lastPhotoStatus, setLastPhotoStatus] = useState<string | null>(null)

  // Добавить напоминание
  const addReminder = useCallback((reminder: Reminder) => {
    if (dismissed.has(reminder.id)) return
    
    setReminders(prev => {
      // Не добавляем дубликаты
      if (prev.find(r => r.id === reminder.id)) return prev
      return [...prev, reminder]
    })

    // Автоскрытие
    if (reminder.autoDismiss) {
      setTimeout(() => {
        handleDismiss(reminder.id)
      }, reminder.autoDismiss * 1000)
    }
  }, [dismissed])

  // Убрать напоминание
  const handleDismiss = useCallback((id: string) => {
    setDismissed(prev => new Set([...prev, id]))
    setReminders(prev => prev.filter(r => r.id !== id))
    onDismiss?.(id)
  }, [onDismiss])

  // Напоминание о фото при смене статуса на погрузку/выгрузку/заправку
  useEffect(() => {
    if (PHOTO_STATUSES.includes(currentStatus) && lastPhotoStatus !== currentStatus) {
      const statusLabels: Record<string, string> = {
        loading: 'погрузке',
        unloading: 'выгрузке', 
        fueling: 'заправке'
      }
      
      addReminder({
        id: `photo-${currentStatus}-${Date.now()}`,
        type: 'photo',
        title: 'Сделайте фото',
        message: `Сфотографируйте груз при ${statusLabels[currentStatus]}`,
        priority: 'low',
        autoDismiss: 10,
        link: '/m/photo'
      })
      
      setLastPhotoStatus(currentStatus)
    } else if (!PHOTO_STATUSES.includes(currentStatus)) {
      setLastPhotoStatus(null)
    }
  }, [currentStatus, lastPhotoStatus, addReminder])

  // Напоминание об отдыхе
  useEffect(() => {
    const hours = currentDrivingSeconds / 3600
    
    // Предупреждение за 30 минут до лимита (после 4 часов)
    if (hours >= 4 && hours < 4.5 && !dismissed.has('rest-warning')) {
      addReminder({
        id: 'rest-warning',
        type: 'rest-warning',
        title: 'Скоро нужен отдых',
        message: `Осталось ${Math.round((4.5 - hours) * 60)} мин. до обязательного перерыва`,
        priority: 'medium',
        autoDismiss: 20
      })
    }
    
    // Критическое напоминание (после 4.5 часов)
    if (hours >= 4.5 && !dismissed.has('rest-critical')) {
      addReminder({
        id: 'rest-critical',
        type: 'rest',
        title: 'Требуется отдых!',
        message: 'Превышен лимит времени вождения. Остановитесь!',
        priority: 'high'
        // Без autoDismiss — важное!
      })
    }
  }, [currentDrivingSeconds, dismissed, addReminder])

  // Напоминание о сообщениях (только при появлении новых)
  useEffect(() => {
    if (unreadMessages > 0 && !dismissed.has(`messages-${unreadMessages}`)) {
      addReminder({
        id: `messages-${unreadMessages}`,
        type: 'message',
        title: 'Новое сообщение',
        message: unreadMessages === 1 
          ? 'Сообщение от диспетчера' 
          : `${unreadMessages} сообщений от диспетчера`,
        priority: 'medium',
        autoDismiss: 8,
        link: '/m/chat'
      })
    }
  }, [unreadMessages, dismissed, addReminder])

  if (reminders.length === 0) return null

  // Показываем самое важное напоминание
  const reminder = reminders.sort((a, b) => {
    const priority = { high: 3, medium: 2, low: 1 }
    return priority[b.priority] - priority[a.priority]
  })[0]

  const config = REMINDER_CONFIG[reminder.type]
  const Icon = config.icon

  const content = (
    <div className={`bg-[#1a1a1f]/95 backdrop-blur-lg border ${config.borderColor} rounded-2xl p-4 shadow-2xl`}>
      <div className="flex items-start gap-3">
        <div className={`p-2.5 rounded-xl ${config.color}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white text-sm">{reminder.title}</p>
          <p className="text-gray-400 text-xs mt-0.5 leading-relaxed">{reminder.message}</p>
        </div>
        <button 
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            handleDismiss(reminder.id)
          }}
          className="p-1.5 hover:bg-gray-700 rounded-lg transition-colors"
        >
          <X className="h-4 w-4 text-gray-500" />
        </button>
      </div>
      
      {/* Прогресс бар для автоскрытия */}
      {reminder.autoDismiss && (
        <div className="mt-3 h-0.5 bg-gray-800 rounded-full overflow-hidden">
          <div 
            className={`h-full ${config.color}`}
            style={{ 
              animation: `shrink ${reminder.autoDismiss}s linear forwards`
            }}
          />
        </div>
      )}
      
      <style jsx>{`
        @keyframes shrink {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  )

  return (
    <div className="fixed bottom-24 left-4 right-4 z-[80] animate-in slide-in-from-bottom duration-300">
      {reminder.link ? (
        <Link href={reminder.link} onClick={() => handleDismiss(reminder.id)}>
          {content}
        </Link>
      ) : (
        content
      )}
    </div>
  )
}
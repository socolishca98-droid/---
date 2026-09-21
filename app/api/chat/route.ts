// app/api/chat/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

import { requireAnySession } from "@/lib/auth/session"
// Ключевые слова для определения важности
const IMPORTANT_KEYWORDS = [
  // Проблемы на дороге
  'пробка', 'пробки', 'авария', 'дтп', 'затор', 'перекрыт', 'перекрыта', 'объезд',
  // Опоздания
  'опаздываю', 'опоздаю', 'задерживаюсь', 'задержка', 'не успеваю', 'не успею',
  // Проблемы с грузом/погрузкой
  'не загружают', 'не грузят', 'не выгружают', 'ждут', 'жду', 'простой', 'не пускают',
  'отказ', 'отказали', 'проблема', 'проблемы',
  // Поломки
  'поломка', 'сломался', 'сломалась', 'не заводится', 'пробило', 'колесо', 'двигатель',
  // Срочное
  'срочно', 'важно', 'помогите', 'помощь', 'sos', 'sos!',
  // Документы
  'документы', 'накладная', 'ттн', 'не подписывают',
  // Груз
  'повреждение', 'повреждён', 'брак', 'недостача', 'пересорт'
]

function detectImportance(text: string): { isImportant: boolean; reason: string | null } {
  const lowerText = text.toLowerCase()
  
  for (const keyword of IMPORTANT_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      return { 
        isImportant: true, 
        reason: keyword 
      }
    }
  }
  
  // Проверяем восклицательные знаки (много = важно)
  const exclamations = (text.match(/!/g) || []).length
  if (exclamations >= 2) {
    return { isImportant: true, reason: 'срочность' }
  }
  
  // CAPS LOCK = кричит = важно
  const capsRatio = (text.match(/[A-ZА-ЯЁ]/g) || []).length / text.length
  if (text.length > 10 && capsRatio > 0.7) {
    return { isImportant: true, reason: 'срочность' }
  }
  
  return { isImportant: false, reason: null }
}

// GET - получить сообщения
// Водитель видит только свою переписку; логист — переписку выбранного водителя или всю
export async function GET(request: NextRequest) {
  const auth = await requireAnySession(request)
  if (!auth.ok) return auth.response

  try {
    const { searchParams } = new URL(request.url)
    const driverId =
      auth.value.kind === 'driver'
        ? auth.value.driver.id
        : searchParams.get('driverId')
    const requestedLimit = parseInt(searchParams.get('limit') || '50', 10)
    const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, requestedLimit)) : 50
    
    const where: any = {}
    
    if (driverId) {
      // Сообщения конкретного водителя
      where.OR = [
        { senderId: driverId },
        { recipientId: driverId }
      ]
    }
    
    const messages = await prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: limit
    })
    
    return NextResponse.json({ success: true, messages })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

// POST - отправить сообщение
// Отправитель всегда берётся из проверенной сессии: senderId/senderRole/senderName
// из тела запроса игнорируются — иначе любой мог писать от чужого имени
export async function POST(request: NextRequest) {
  const auth = await requireAnySession(request)
  if (!auth.ok) return auth.response

  try {
    const body = await request.json()
    const { recipientId, content, type = 'text', attachmentUrl } = body

    if (!content || !String(content).trim()) {
      return NextResponse.json(
        { success: false, error: 'content обязателен' },
        { status: 400 }
      )
    }

    const senderId = auth.value.kind === 'driver' ? auth.value.driver.id : auth.value.user.id
    const senderRole = auth.value.kind === 'driver' ? 'driver' : auth.value.user.role
    const senderName = auth.value.kind === 'driver' ? auth.value.driver.name : auth.value.user.name
    
    // Определяем важность сообщения
    const { isImportant, reason } = type === 'alert' 
      ? { isImportant: true, reason: 'отмечено как важное' }
      : detectImportance(content)
    
    const message = await prisma.chatMessage.create({
      data: {
        senderId,
        senderRole,
        senderName,
        recipientId,
        content,
        type: isImportant && type === 'text' ? 'alert' : type,
        isImportant,
        importantReason: reason,
        attachmentUrl
      }
    })
    
    return NextResponse.json({ success: true, message })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

// PATCH - пометить как прочитанное
// PATCH - пометить как прочитанное.
// Водитель может отмечать только те сообщения, где он получатель.
export async function PATCH(request: NextRequest) {
  const auth = await requireAnySession(request)
  if (!auth.ok) return auth.response

  try {
    const body = await request.json()
    const { messageIds } = body

    if (!messageIds || !Array.isArray(messageIds)) {
      return NextResponse.json(
        { success: false, error: 'messageIds должен быть массивом' },
        { status: 400 }
      )
    }

    const ownerFilter =
      auth.value.kind === 'driver' ? { recipientId: auth.value.driver.id } : {}

    await prisma.chatMessage.updateMany({
      where: { id: { in: messageIds }, ...ownerFilter },
      data: { isRead: true, readAt: new Date() }
    })
    
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
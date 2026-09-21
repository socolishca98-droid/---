// app/api/chat/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

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
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const driverId = searchParams.get('driverId')
    const limit = parseInt(searchParams.get('limit') || '50')
    
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
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { senderId, senderRole, senderName, content, type = 'text', attachmentUrl } = body
    const recipientId = body.recipientId || body.driverId || null
    
    if (!senderId || !senderName || !content) {
      return NextResponse.json(
        { success: false, error: 'senderId, senderName и content обязательны' },
        { status: 400 }
      )
    }
    
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
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { messageIds } = body
    
    if (!messageIds || !Array.isArray(messageIds)) {
      return NextResponse.json(
        { success: false, error: 'messageIds должен быть массивом' },
        { status: 400 }
      )
    }
    
    await prisma.chatMessage.updateMany({
      where: { id: { in: messageIds } },
      data: { isRead: true, readAt: new Date() }
    })
    
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
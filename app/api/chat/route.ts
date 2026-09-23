// app/api/chat/route.ts - P1-6 zod

import { requireStaffAuth } from "@/lib/api-auth"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { chatMessageSchema, zodErrorResponse } from "@/lib/validators"
import { z } from "zod"

const IMPORTANT_KEYWORDS = [
  'пробка', 'пробки', 'авария', 'дтп', 'затор', 'перекрыт', 'перекрыта', 'объезд',
  'опаздываю', 'опоздаю', 'задерживаюсь', 'задержка', 'не успеваю', 'не успею',
  'не загружают', 'не грузят', 'не выгружают', 'ждут', 'жду', 'простой', 'не пускают',
  'отказ', 'отказали', 'проблема', 'проблемы',
  'поломка', 'сломался', 'сломалась', 'не заводится', 'пробило', 'колесо', 'двигатель',
  'срочно', 'важно', 'помогите', 'помощь', 'sos', 'sos!',
  'документы', 'накладная', 'ттн', 'не подписывают',
  'повреждение', 'повреждён', 'брак', 'недостача', 'пересорт'
]

function detectImportance(text: string): { isImportant: boolean; reason: string | null } {
  const lowerText = text.toLowerCase()
  for (const keyword of IMPORTANT_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      return { isImportant: true, reason: keyword }
    }
  }
  const exclamations = (text.match(/!/g) || []).length
  if (exclamations >= 2) return { isImportant: true, reason: 'срочность' }
  const capsRatio = (text.match(/[A-ZА-ЯЁ]/g) || []).length / text.length
  if (text.length > 10 && capsRatio > 0.7) return { isImportant: true, reason: 'срочность' }
  return { isImportant: false, reason: null }
}

export async function GET(request: NextRequest) {
  const __auth = await requireStaffAuth(request)
  if (__auth.error) return __auth.error

  try {
    const { searchParams } = new URL(request.url)
    const driverId = searchParams.get('driverId')
    const limit = parseInt(searchParams.get('limit') || '50')
    const where: any = {}
    if (driverId) {
      where.OR = [{ senderId: driverId }, { recipientId: driverId }]
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

const chatPostSchema = z.object({
  senderId: z.string().min(1),
  senderRole: z.string().min(1),
  senderName: z.string().min(1).max(100),
  content: z.string().trim().min(1).max(2000),
  type: z.string().optional().default("text"),
  attachmentUrl: z.string().url().optional().or(z.literal("")).or(z.null()),
  recipientId: z.string().optional().or(z.null()),
  driverId: z.string().optional().or(z.null()),
})

export async function POST(request: NextRequest) {
  const __auth = await requireStaffAuth(request)
  if (__auth.error) return __auth.error

  try {
    const rawBody = await request.json().catch(() => null)
    if (!rawBody) {
      return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
    }
    const parsed = chatPostSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(zodErrorResponse(parsed.error), { status: 400 })
    }

    const { senderId, senderRole, senderName, content, type = 'text', attachmentUrl } = parsed.data
    const recipientId = (parsed.data as any).recipientId || (parsed.data as any).driverId || null

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
        attachmentUrl: attachmentUrl || null
      }
    })

    return NextResponse.json({ success: true, message })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

const patchSchema = z.object({
  messageIds: z.array(z.string().min(1)).min(1),
})

export async function PATCH(request: NextRequest) {
  const __auth = await requireStaffAuth(request)
  if (__auth.error) return __auth.error

  try {
    const rawBody = await request.json().catch(() => null)
    if (!rawBody) {
      return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
    }
    const parsed = patchSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(zodErrorResponse(parsed.error), { status: 400 })
    }

    const { messageIds } = parsed.data

    await prisma.chatMessage.updateMany({
      where: { id: { in: messageIds } },
      data: { isRead: true, readAt: new Date() }
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

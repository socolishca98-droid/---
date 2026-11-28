import { NextRequest, NextResponse } from "next/server"
import { requireStaffAuth } from "@/lib/api-auth"

export const dynamic = "force-dynamic"

const SYSTEM_PROMPT = `Ты — парсер скриншотов грузоперевозок (в том числе карточек с биржи АТИ.СУ).
Извлеки из изображения данные груза и верни СТРОГО валидный JSON без markdown-обёртки:
{
  "routeFrom": "город погрузки (строка или пусто)",
  "routeTo": "город выгрузки (строка или пусто)",
  "cargoType": "наименование груза / тип кузова (строка или пусто)",
  "weight": "вес в кг числом (например 5000, если 5 т — переведи в 5000, или пусто)",
  "volume": "объём в м3 числом (например 32, или пусто)",
  "price": "ставка в рублях числом (например 45000, или пусто)",
  "clientName": "название фирмы / заказчика (или пусто)",
  "clientContact": "телефон или контакт (или пусто)"
}`

export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error

  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        code: "needs_ai_key",
        error: "Распознавание скриншотов требует OPENAI_API_KEY или OPENROUTER_API_KEY в настройках сервера.",
      },
      { status: 503 },
    )
  }

  let body: { imageDataUrl?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Некорректный запрос" }, { status: 400 })
  }

  const imageDataUrl = String(body?.imageDataUrl ?? "").trim()
  if (!imageDataUrl.startsWith("data:image/")) {
    return NextResponse.json({ success: false, error: "Прикрепите изображение (скриншот)" }, { status: 400 })
  }

  const isOpenRouter = !process.env.OPENAI_API_KEY && Boolean(process.env.OPENROUTER_API_KEY)
  const endpoint = isOpenRouter
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions"
  const model = isOpenRouter ? "openai/gpt-4o-mini" : "gpt-4o-mini"

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 500,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Распознай данные груза со скриншота:" },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
          },
        ],
      }),
    })

    if (!res.ok) {
      const txt = await res.text().catch(() => "")
      return NextResponse.json(
        { success: false, error: `Ошибка сервиса распознавания (${res.status}): ${txt.slice(0, 120)}` },
        { status: 502 },
      )
    }

    const data = await res.json()
    const raw = String(data?.choices?.[0]?.message?.content ?? "").trim()
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim()
    const parsed = JSON.parse(cleaned)

    return NextResponse.json({ success: true, fields: parsed })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Не удалось распознать скриншот"
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

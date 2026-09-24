"use client"

// components/orders/text-parse-panel.tsx
//
// «Разобрать текст» — заказ из текста заявки (письма, сообщения клиента).
//
// Как это работает и почему так:
//   * разбор детерминированный (правила и регулярные выражения), без внешних
//     ИИ-сервисов: результат предсказуем, ничего не уходит на сторону, и его
//     можно проверить глазами;
//   * разбор НИЧЕГО не создаёт сам — это совет: поля показываются рядом с
//     исходным текстом, их можно поправить руками;
//   * заказ создаётся только по явному нажатию «Создать заказ» (этап
//     «Согласование» — цена ещё не согласована) и открывается его карточка;
//   * чего в тексте не нашлось, видно списком: сервис не выдумывает города,
//     вес и телефоны.

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Loader2,
  Wand2,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

const EXAMPLE_TEXT = `Груз: Стройматериалы (кирпич)
Откуда: Москва, ул. Промышленная 15
Куда: Тверь, склад на Петербургском шоссе
Вес: 18 тонн
Объём: 80 куб.м
Цена: 45000р
Требования: тент, боковая загрузка
Контакт: Иван, +7-925-111-22-33
Срок: завтра до 18:00`

type ParsedFields = {
  routeFrom: string
  routeTo: string
  cargoType: string
  weight: string
  volume: string
  price: string
  distance: string
  clientName: string
  clientContact: string
  requirements: string
  deadline: string
}

const EMPTY: ParsedFields = {
  routeFrom: "",
  routeTo: "",
  cargoType: "",
  weight: "",
  volume: "",
  price: "",
  distance: "",
  clientName: "",
  clientContact: "",
  requirements: "",
  deadline: "",
}

/** Строка после «Откуда:», «Куда:», «Груз:» и похожих меток. */
function pickLabeled(text: string, labels: string[]): string {
  for (const label of labels) {
    const match = text.match(new RegExp(`${label}\\s*[:—-]\\s*(.+)`, "i"))
    if (match) return match[1].split("\n")[0].trim()
  }
  return ""
}

/** Число рядом с единицей измерения: «18 тонн», «80 куб.м», «45 000 р». */
function pickNumber(text: string, unitPattern: string): string {
  const match = text.match(new RegExp(`(\\d[\\d\\s.,]*)\\s*(?:${unitPattern})`, "i"))
  if (!match) return ""
  return match[1].replace(/[\s]/g, "").replace(",", ".").replace(/\.$/, "")
}

/** «завтра до 18:00» → дата; конкретная дата dd.mm(.yyyy) — как есть. */
function pickDeadline(text: string): string {
  const explicit = text.match(/(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?/)
  if (explicit) {
    const day = explicit[1].padStart(2, "0")
    const month = explicit[2].padStart(2, "0")
    const year = explicit[3]
      ? explicit[3].length === 2
        ? `20${explicit[3]}`
        : explicit[3]
      : String(new Date().getFullYear())
    const time = text.match(/(\d{1,2}):(\d{2})/)
    const clock = time ? `T${time[1].padStart(2, "0")}:${time[2]}` : ""
    return `${year}-${month}-${day}${clock}`
  }

  const dayShift = /послезавтра/i.test(text) ? 2 : /завтра/i.test(text) ? 1 : 0
  if (dayShift > 0) {
    const date = new Date(Date.now() + dayShift * 24 * 60 * 60 * 1000)
    const time = text.match(/(\d{1,2}):(\d{2})/)
    if (time) date.setHours(Number(time[1]), Number(time[2]), 0, 0)
    return date.toISOString().slice(0, 16)
  }

  return ""
}

/** Разбор текста заявки в поля заказа. Ничего не создаёт — только предлагает. */
function parseOrderText(text: string): { fields: ParsedFields; warnings: string[] } {
  const fields: ParsedFields = { ...EMPTY }
  const warnings: string[] = []

  fields.routeFrom = pickLabeled(text, ["откуда", "от", "погрузка", "загрузка", "адрес погрузки"])
  fields.routeTo = pickLabeled(text, ["куда", "до", "выгрузка", "разгрузка", "адрес выгрузки"])

  // «Москва → Тверь» одной строкой
  if (!fields.routeFrom || !fields.routeTo) {
    const arrow = text.match(/^([^\n→\-]{3,60})\s*(?:→|->|—|-)\s*([^\n]{3,60})$/m)
    if (arrow) {
      fields.routeFrom = fields.routeFrom || arrow[1].trim()
      fields.routeTo = fields.routeTo || arrow[2].split("\n")[0].trim()
    }
  }

  fields.cargoType = pickLabeled(text, ["груз", "название груза", "товар"])
  if (fields.cargoType.length > 100) fields.cargoType = fields.cargoType.slice(0, 100)

  const tons = text.match(/(\d+[.,]?\d*)\s*(?:т\b|тонн|т\.)/i)
  const kilos = text.match(/(\d[\d\s]{2,})\s*(?:кг|килограмм)/i)
  if (tons) fields.weight = String(Math.round(Number(tons[1].replace(",", ".")) * 1000))
  else if (kilos) fields.weight = kilos[1].replace(/[\s]/g, "")

  fields.volume = pickNumber(text, "куб\\.?\\s*м|м3|м³|кубов")
  fields.price = pickNumber(text, "р\\b|руб|₽|рублей")
  fields.distance = pickNumber(text, "км")

  const phone = text.match(
    /(?:\+7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/,
  )
  if (phone) fields.clientContact = phone[0].replace(/[^\d+]/g, "")

  const contact = pickLabeled(text, ["контакт", "контактное лицо", "клиент", "менеджер"])
  if (contact) {
    const name = contact.replace(/(\+?\d[\d\s\-()]{6,})/, "").replace(/[,;]\s*$/, "").trim()
    if (name) fields.clientName = name
  }

  fields.requirements = pickLabeled(text, ["требовани[яй]", "условия", "примечание"])
  fields.deadline = pickDeadline(text)

  if (!fields.routeFrom) warnings.push("Не найден город отправления — укажите вручную")
  if (!fields.routeTo) warnings.push("Не найден город назначения — укажите вручную")
  if (!fields.weight && !fields.volume) warnings.push("Вес и объём не найдены")
  if (!fields.price) warnings.push("Цена не найдена — заказ можно создать и без неё")

  return { fields, warnings }
}

export function TextParsePanel() {
  const router = useRouter()
  const [text, setText] = useState("")
  const [fields, setFields] = useState<ParsedFields | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [parsed, setParsed] = useState(false)

  const distanceHint = useMemo(() => {
    if (!fields?.routeFrom || !fields?.routeTo) return null
    if (fields.distance) return null
    return "Расстояние не распознано — можно указать вручную, оно понадобится для расчёта цены за км"
  }, [fields])

  const set = <K extends keyof ParsedFields>(key: K, value: ParsedFields[K]) =>
    setFields((prev) => (prev ? { ...prev, [key]: value } : prev))

  const handleParse = () => {
    if (text.trim().length < 10) {
      toast.error("Вставьте текст заявки — например, письмо от клиента")
      return
    }
    const result = parseOrderText(text)
    setFields(result.fields)
    setWarnings(result.warnings)
    setParsed(true)
  }

  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    if (!fields) return
    if (!fields.routeFrom.trim() || !fields.routeTo.trim()) {
      toast.error("Нужны города отправления и назначения")
      return
    }

    setCreating(true)
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "manual",
          routeFrom: fields.routeFrom.trim(),
          routeTo: fields.routeTo.trim(),
          distance: fields.distance ? Number(fields.distance) : 0,
          weight: fields.weight ? Number(fields.weight) : 0,
          volume: fields.volume ? Number(fields.volume) : undefined,
          cargoType: fields.cargoType.trim() || "Груз",
          price: fields.price ? Number(fields.price) : 0,
          clientName: fields.clientName.trim() || undefined,
          clientContact: fields.clientContact.trim() || undefined,
          deadline: fields.deadline ? new Date(fields.deadline).toISOString() : undefined,
        }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        toast.error(data.error || "Не удалось создать заказ")
        return
      }

      const orderId = data.order?.id
      toast.success("Заказ создан на этапе «Согласование»", {
        description: "Дальше — переговоры и торг по цене в карточке заказа",
      })
      if (orderId) router.push(`/orders/${orderId}`)
    } catch {
      toast.error("Ошибка связи с сервером")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-l-4 border-l-primary">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            Заказ из текста заявки
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Вставьте текст письма или сообщения клиента. Разбор идёт по правилам —
            без внешних сервисов: система только <strong>предлагает</strong> поля,
            заказ создаётся по кнопке и всегда начинается с этапа «Согласование».
          </p>
          <Textarea
            rows={9}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={EXAMPLE_TEXT}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleParse} disabled={creating}>
              <Wand2 className="h-4 w-4 mr-2" />
              Разобрать текст
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setText(EXAMPLE_TEXT)
                setFields(null)
                setWarnings([])
                setParsed(false)
              }}
              disabled={creating}
            >
              Вставить пример
            </Button>
          </div>
        </CardContent>
      </Card>

      {parsed && fields && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              Что удалось понять
              <Badge variant="outline" className="ml-1">
                проверьте и поправьте
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["routeFrom", "Откуда"],
                  ["routeTo", "Куда"],
                  ["cargoType", "Груз"],
                  ["weight", "Вес, кг"],
                  ["volume", "Объём, м³"],
                  ["price", "Цена, ₽"],
                  ["distance", "Расстояние, км"],
                  ["clientName", "Контактное лицо"],
                  ["clientContact", "Телефон"],
                  ["requirements", "Требования"],
                ] as [keyof ParsedFields, string][]
              ).map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`parse-${key}`}>{label}</Label>
                  <Input
                    id={`parse-${key}`}
                    value={fields[key]}
                    onChange={(event) => set(key, event.target.value)}
                    placeholder="—"
                  />
                </div>
              ))}
              <div className="space-y-1.5">
                <Label htmlFor="parse-deadline">Срок (дата и время)</Label>
                <Input
                  id="parse-deadline"
                  type="datetime-local"
                  value={fields.deadline.slice(0, 16)}
                  onChange={(event) => set("deadline", event.target.value)}
                />
              </div>
            </div>

            {(warnings.length > 0 || distanceHint) && (
              <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                {warnings.map((warning) => (
                  <div key={warning} className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    {warning}
                  </div>
                ))}
                {distanceHint && (
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    {distanceHint}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void handleCreate()} disabled={creating}>
                {creating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                Создать заказ
              </Button>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                заказ появится на этапе «Согласование»
                <ArrowRight className="h-3 w-3" />
                дальше переговоры и торг по цене
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default TextParsePanel

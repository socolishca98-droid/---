"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Bot, Download, Loader2, Sparkles, Copy, Check } from "lucide-react"

const reportTypes = [
  { value: "financial", label: "Финансовый отчёт" },
  { value: "driver", label: "Отчёт по водителям" },
  { value: "orders", label: "Отчёт по заказам" },
  { value: "expenses", label: "Отчёт по расходам" },
  { value: "custom", label: "Произвольный запрос" },
]

const periods = [
  { value: "week", label: "За неделю" },
  { value: "month", label: "За месяц" },
  { value: "quarter", label: "За квартал" },
  { value: "year", label: "За год" },
]

const sampleReport = `**Финансовый отчёт за январь 2024**

**Общие показатели:**
- Выручка: 2,450,000 ₽ (+18% к прошлому месяцу)
- Расходы: 845,000 ₽ (+12% к прошлому месяцу)
- Чистая прибыль: 1,605,000 ₽ (+23% к прошлому месяцу)
- Маржинальность: 65.5%

**Анализ выручки:**
Основной рост обеспечен увеличением количества заказов на направлении Москва-СПб (+34 заказа). Средний чек вырос на 8% благодаря оптимизации маршрутов.

**Структура расходов:**
- Топливо: 58% (285,000 ₽) — рекомендуется пересмотреть договоры с АЗС
- Платные дороги: 17% (82,000 ₽)
- Ремонт и ТО: 13% (65,000 ₽)
- Прочие расходы: 12% (58,000 ₽)

**Рекомендации ИИ:**
1. Увеличить парк на 1-2 машины для покрытия растущего спроса на направлении Москва-СПб
2. Рассмотреть заключение договора с сетью АЗС для снижения расходов на топливо на 5-7%
3. Внедрить систему мотивации водителей за экономию топлива`

export function AIReportGenerator() {
  const [reportType, setReportType] = useState("financial")
  const [period, setPeriod] = useState("month")
  const [customPrompt, setCustomPrompt] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedReport, setGeneratedReport] = useState("")
  const [copied, setCopied] = useState(false)

  const handleGenerate = async () => {
    setIsGenerating(true)
    await new Promise((resolve) => setTimeout(resolve, 2500))
    setGeneratedReport(sampleReport)
    setIsGenerating(false)
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(generatedReport)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          AI-генератор отчётов
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          ИИ проанализирует данные и создаст отчёт на человеческом языке с рекомендациями
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Тип отчёта</label>
            <Select value={reportType} onValueChange={setReportType}>
              <SelectTrigger className="bg-secondary border-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {reportTypes.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Период</label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="bg-secondary border-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {reportType === "custom" && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Ваш запрос</label>
            <Textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="Например: Сравни эффективность водителей за последний месяц..."
              className="min-h-[100px] bg-secondary border-0 resize-none"
            />
          </div>
        )}

        <Button className="w-full bg-primary text-primary-foreground" onClick={handleGenerate} disabled={isGenerating}>
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Генерирую отчёт...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              Сгенерировать отчёт
            </>
          )}
        </Button>

        {generatedReport && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Badge variant="secondary" className="bg-success/20 text-success">
                <Check className="h-3 w-3 mr-1" />
                Отчёт готов
              </Badge>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                  {copied ? "Скопировано" : "Копировать"}
                </Button>
                <Button variant="outline" size="sm">
                  <Download className="h-4 w-4 mr-1" />
                  PDF
                </Button>
              </div>
            </div>
            <div className="p-4 rounded-lg bg-secondary/50 text-sm whitespace-pre-wrap">{generatedReport}</div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

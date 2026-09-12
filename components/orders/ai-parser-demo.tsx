"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Bot, Sparkles, Loader2, ArrowRight, Check } from "lucide-react"

const exampleText = `Груз: Стройматериалы (кирпич)
Откуда: Москва, ул. Промышленная 15
Куда: Тверь, склад на Петербургском шоссе
Вес: 18 тонн
Объём: 80 куб.м
Цена: 45000р
Требования: тент, боковая загрузка
Контакт: Иван, +7-925-111-22-33
Срок: завтра до 18:00`

interface ParsedOrder {
  routeFrom: string
  routeTo: string
  weight: string
  volume: string
  price: string
  cargoType: string
  requirements: string
  contact: string
  deadline: string
}

export function AIParserDemo() {
  const [inputText, setInputText] = useState("")
  const [isParsing, setIsParsing] = useState(false)
  const [parsedData, setParsedData] = useState<ParsedOrder | null>(null)

  const handleParse = async () => {
    setIsParsing(true)
    // Simulate AI parsing
    await new Promise((resolve) => setTimeout(resolve, 1500))

    setParsedData({
      routeFrom: "Москва, ул. Промышленная 15",
      routeTo: "Тверь, Петербургское шоссе",
      weight: "18 000 кг",
      volume: "80 м³",
      price: "45 000 ₽",
      cargoType: "Стройматериалы (кирпич)",
      requirements: "Тент, боковая загрузка",
      contact: "Иван, +7-925-111-22-33",
      deadline: "Завтра до 18:00",
    })
    setIsParsing(false)
  }

  const handleUseExample = () => {
    setInputText(exampleText)
    setParsedData(null)
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          AI-парсер заказов
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Вставьте текст объявления с биржи грузов — ИИ автоматически извлечёт данные
        </p>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Исходный текст</label>
              <Button variant="ghost" size="sm" onClick={handleUseExample}>
                <Sparkles className="h-3 w-3 mr-1" />
                Пример
              </Button>
            </div>
            <Textarea
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value)
                setParsedData(null)
              }}
              placeholder="Вставьте текст объявления..."
              className="min-h-[200px] bg-secondary border-0 resize-none"
            />
            <Button
              onClick={handleParse}
              disabled={!inputText.trim() || isParsing}
              className="w-full bg-primary text-primary-foreground"
            >
              {isParsing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Анализирую...
                </>
              ) : (
                <>
                  <Bot className="h-4 w-4 mr-2" />
                  Распознать данные
                </>
              )}
            </Button>
          </div>

          {/* Output */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Распознанные данные</label>
            <div className="min-h-[200px] bg-secondary/50 rounded-lg p-4">
              {parsedData ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant="secondary" className="bg-success/20 text-success">
                      <Check className="h-3 w-3 mr-1" />
                      Успешно
                    </Badge>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex items-start gap-2">
                      <span className="text-muted-foreground min-w-[100px]">Маршрут:</span>
                      <span className="flex items-center gap-1">
                        {parsedData.routeFrom}
                        <ArrowRight className="h-3 w-3" />
                        {parsedData.routeTo}
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-muted-foreground min-w-[100px]">Груз:</span>
                      <span>{parsedData.cargoType}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-muted-foreground min-w-[100px]">Вес/Объём:</span>
                      <span>
                        {parsedData.weight} / {parsedData.volume}
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-muted-foreground min-w-[100px]">Цена:</span>
                      <span className="text-primary font-medium">{parsedData.price}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-muted-foreground min-w-[100px]">Требования:</span>
                      <span>{parsedData.requirements}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-muted-foreground min-w-[100px]">Контакт:</span>
                      <span>{parsedData.contact}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-muted-foreground min-w-[100px]">Срок:</span>
                      <span>{parsedData.deadline}</span>
                    </div>
                  </div>

                  <Button size="sm" className="w-full mt-4 bg-primary text-primary-foreground">
                    Создать заказ
                  </Button>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  Здесь появятся распознанные данные
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

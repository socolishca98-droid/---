import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Bot, TrendingUp, AlertCircle, Lightbulb } from "lucide-react"

export function AIInsights() {
  const insights = [
    {
      type: "recommendation",
      icon: Lightbulb,
      title: "Рекомендация по маршруту",
      description: "Объедините заказы #1 и #4 — одинаковое направление, экономия 15% на топливе",
      priority: "high",
    },
    {
      type: "trend",
      icon: TrendingUp,
      title: "Рост спроса",
      description: "На направлении Москва-СПб +23% заказов за неделю. Рассмотрите увеличение тарифов",
      priority: "medium",
    },
    {
      type: "alert",
      icon: AlertCircle,
      title: "Внимание",
      description: "Водитель Сидоров М. не загрузил чеки за последние 3 дня",
      priority: "low",
    },
  ]

  const priorityColors = {
    high: "bg-primary/20 text-primary",
    medium: "bg-warning/20 text-warning",
    low: "bg-muted text-muted-foreground",
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20">
          <Bot className="h-4 w-4 text-primary" />
        </div>
        <CardTitle className="text-lg font-semibold">ИИ-аналитика</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {insights.map((insight: any, index: any) => (
          <div key={index} className="flex gap-3 p-3 rounded-lg bg-secondary/50">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${priorityColors[insight.priority as keyof typeof priorityColors]}`}>
              <insight.icon className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{insight.title}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{insight.description}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

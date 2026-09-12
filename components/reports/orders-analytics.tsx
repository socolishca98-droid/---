"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Package, CheckCircle, TrendingUp } from "lucide-react"
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts"

const ordersByStatus = [
  { name: "Выполнено", value: 156, color: "hsl(var(--success))" },
  { name: "В работе", value: 23, color: "hsl(var(--primary))" },
  { name: "Ожидают", value: 18, color: "hsl(var(--warning))" },
  { name: "Отменено", value: 8, color: "hsl(var(--destructive))" },
]

const ordersTrend = [
  { date: "Нед 1", orders: 32, avgPrice: 52000 },
  { date: "Нед 2", orders: 41, avgPrice: 48000 },
  { date: "Нед 3", orders: 38, avgPrice: 55000 },
  { date: "Нед 4", orders: 45, avgPrice: 58000 },
  { date: "Нед 5", orders: 52, avgPrice: 61000 },
  { date: "Нед 6", orders: 48, avgPrice: 54000 },
]

const topRoutes = [
  { route: "Москва — СПб", count: 34, revenue: 2890000 },
  { route: "Казань — Н.Новгород", count: 28, revenue: 1680000 },
  { route: "Екатеринбург — Челябинск", count: 22, revenue: 880000 },
  { route: "Новосибирск — Омск", count: 18, revenue: 1260000 },
  { route: "Ростов — Краснодар", count: 15, revenue: 525000 },
]

export function OrdersAnalytics() {
  const totalOrders = ordersByStatus.reduce((sum, s) => sum + s.value, 0)

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Orders by Status */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Заказы по статусам
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-8">
            <div className="h-[200px] w-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={ordersByStatus}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {ordersByStatus.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-3">
              {ordersByStatus.map((status) => (
                <div key={status.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full" style={{ backgroundColor: status.color }} />
                    <span className="text-sm">{status.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{status.value}</span>
                    <span className="text-xs text-muted-foreground">
                      ({Math.round((status.value / totalOrders) * 100)}%)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Orders Trend */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Динамика заказов
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={ordersTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" />
                <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="hsl(var(--muted-foreground))"
                  tickFormatter={(v) => `${v / 1000}к`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="orders"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={{ fill: "hsl(var(--primary))" }}
                  name="Заказы"
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="avgPrice"
                  stroke="hsl(var(--success))"
                  strokeWidth={2}
                  dot={{ fill: "hsl(var(--success))" }}
                  name="Ср. цена"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Top Routes */}
      <Card className="bg-card border-border lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-primary" />
            Топ направлений
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {topRoutes.map((route, index) => (
              <div key={route.route} className="flex items-center gap-4 p-3 rounded-lg bg-secondary/50">
                <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center font-bold text-primary">
                  {index + 1}
                </div>
                <div className="flex-1">
                  <div className="font-medium">{route.route}</div>
                  <div className="text-sm text-muted-foreground">{route.count} заказов</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-primary">{(route.revenue / 1000000).toFixed(2)}М ₽</div>
                  <div className="text-xs text-muted-foreground">выручка</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { TrendingUp, TrendingDown, DollarSign, Truck, ArrowUpRight } from "lucide-react"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts"

const revenueData = [
  { date: "01.01", revenue: 185000, expenses: 62000, profit: 123000 },
  { date: "02.01", revenue: 210000, expenses: 71000, profit: 139000 },
  { date: "03.01", revenue: 195000, expenses: 68000, profit: 127000 },
  { date: "04.01", revenue: 245000, expenses: 82000, profit: 163000 },
  { date: "05.01", revenue: 280000, expenses: 95000, profit: 185000 },
  { date: "06.01", revenue: 320000, expenses: 108000, profit: 212000 },
  { date: "07.01", revenue: 295000, expenses: 98000, profit: 197000 },
]

const expenseBreakdown = [
  { name: "Топливо", value: 285000, percentage: 58 },
  { name: "Платные дороги", value: 82000, percentage: 17 },
  { name: "Ремонт", value: 65000, percentage: 13 },
  { name: "Стоянки", value: 35000, percentage: 7 },
  { name: "Прочее", value: 23000, percentage: 5 },
]

export function FinancialOverview() {
  const totalRevenue = revenueData.reduce((sum: any, d: any) => sum + d.revenue, 0)
  const totalExpenses = revenueData.reduce((sum: any, d: any) => sum + d.expenses, 0)
  const totalProfit = totalRevenue - totalExpenses
  const profitMargin = Math.round((totalProfit / totalRevenue) * 100)

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="h-10 w-10 rounded-lg bg-success/20 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-success" />
              </div>
              <Badge variant="secondary" className="bg-success/20 text-success">
                <ArrowUpRight className="h-3 w-3 mr-1" />
                +18%
              </Badge>
            </div>
            <div className="text-2xl font-bold">{(totalRevenue / 1000000).toFixed(2)}М ₽</div>
            <div className="text-sm text-muted-foreground">Выручка за период</div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="h-10 w-10 rounded-lg bg-destructive/20 flex items-center justify-center">
                <TrendingDown className="h-5 w-5 text-destructive" />
              </div>
              <Badge variant="secondary" className="bg-destructive/20 text-destructive">
                <ArrowUpRight className="h-3 w-3 mr-1" />
                +12%
              </Badge>
            </div>
            <div className="text-2xl font-bold">{(totalExpenses / 1000000).toFixed(2)}М ₽</div>
            <div className="text-sm text-muted-foreground">Расходы за период</div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-primary" />
              </div>
              <Badge variant="secondary" className="bg-primary/20 text-primary">
                <ArrowUpRight className="h-3 w-3 mr-1" />
                +23%
              </Badge>
            </div>
            <div className="text-2xl font-bold">{(totalProfit / 1000000).toFixed(2)}М ₽</div>
            <div className="text-sm text-muted-foreground">Чистая прибыль</div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="h-10 w-10 rounded-lg bg-chart-2/20 flex items-center justify-center">
                <Truck className="h-5 w-5 text-chart-2" />
              </div>
              <Badge variant="secondary" className="bg-chart-2/20 text-chart-2">
                {profitMargin}%
              </Badge>
            </div>
            <div className="text-2xl font-bold">{profitMargin}%</div>
            <div className="text-sm text-muted-foreground">Маржинальность</div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Revenue Chart */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg">Динамика выручки и прибыли</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueData}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" />
                  <YAxis stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `${v / 1000}к`} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                    formatter={(value: number) => `${value.toLocaleString()} ₽`}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="hsl(var(--primary))"
                    fillOpacity={1}
                    fill="url(#colorRevenue)"
                    name="Выручка"
                  />
                  <Area
                    type="monotone"
                    dataKey="profit"
                    stroke="hsl(var(--success))"
                    fillOpacity={1}
                    fill="url(#colorProfit)"
                    name="Прибыль"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Expense Breakdown */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg">Структура расходов</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={expenseBreakdown} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `${v / 1000}к`} />
                  <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" width={80} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                    formatter={(value: number) => `${value.toLocaleString()} ₽`}
                  />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

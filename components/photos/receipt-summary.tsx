"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { Photo } from "@/lib/types"
import {
  Receipt,
  Fuel,
  ParkingCircle,
  Wrench,
  FileText,
  TrendingUp,
} from "lucide-react"

interface ReceiptSummaryProps {
  photos: Photo[]
}

export function ReceiptSummary({ photos }: ReceiptSummaryProps) {
  // Приведение к any, т.к. ocrData нет в типе Photo
  const safePhotos = photos as any[]

  const receipts = safePhotos.filter((p: any) => p.type === "receipt" && p.ocrData?.amount,
  )

  const totalAmount = receipts.reduce((sum: any, r: any) => sum + (r.ocrData?.amount || 0),
    0,
  )

  // Group by purpose
  const byPurpose = receipts.reduce((acc: any, receipt: any) => {
      const purpose = receipt.ocrData?.purpose || "Прочее"
      if (!acc[purpose]) {
        acc[purpose] = { count: 0, amount: 0 }
      }
      acc[purpose].count++
      acc[purpose].amount += receipt.ocrData?.amount || 0
      return acc
    },
    {} as Record<string, { count: number; amount: number }>,
  )

  const purposeIcons: Record<string, typeof Receipt> = {
    Топливо: Fuel,
    "Топливо ДТ": Fuel,
    Стоянка: ParkingCircle,
    Ремонт: Wrench,
    ТТН: FileText,
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" />
            Сводка по чекам
          </span>
          <Badge variant="secondary" className="bg-primary/20 text-primary">
            {receipts.length} чеков
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Total */}
        <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-muted-foreground">
                Общая сумма расходов
              </div>
              <div className="text-3xl font-bold text-primary">
                {totalAmount.toLocaleString()} ₽
              </div>
            </div>
            <TrendingUp className="h-8 w-8 text-primary opacity-50" />
          </div>
        </div>

        {/* By Purpose */}
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            По категориям
          </div>
          {Object.entries(byPurpose).map((entry: any) => {
            const purpose = entry[0]
            const data = entry[1] as { count: number; amount: number } // Явное приведение внутри map

            const Icon = purposeIcons[purpose] || Receipt
            const percentage =
              totalAmount > 0
                ? Math.round((data.amount / totalAmount) * 100)
                : 0

            return (
              <div
                key={purpose}
                className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50"
              >
                <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{purpose}</span>
                    <span className="font-bold">
                      {data.amount.toLocaleString()} ₽
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{data.count} чеков</span>
                    <span>{percentage}% от общей суммы</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {receipts.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Receipt className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p>Нет распознанных чеков</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
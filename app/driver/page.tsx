// app/driver/page.tsx
"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Truck, Smartphone, ArrowRight } from "lucide-react"
import Link from "next/link"

export default function DriverPage() {
  const router = useRouter()

  useEffect(() => {
    // Автоматическое перенаправление на полнофункциональное мобильное приложение водителя /m
    router.replace("/m")
  }, [router])

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full border-border bg-card/70 backdrop-blur shadow-xl text-center">
        <CardHeader className="space-y-2">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-2">
            <Smartphone className="h-7 w-7" />
          </div>
          <CardTitle className="text-xl font-bold">Кабина водителя Loginex</CardTitle>
          <p className="text-sm text-muted-foreground">
            Перенаправляем в мобильное веб-приложение для водителей...
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          <Link href="/m" className="w-full">
            <Button className="w-full gap-2">
              <Truck className="h-4 w-4" />
              Открыть приложение водителя (/m)
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </Link>
          <div className="text-xs text-muted-foreground">
            Если перенаправление не сработало, нажмите на кнопку выше.
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

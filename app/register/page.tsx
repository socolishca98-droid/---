"use client"

/**
 * /register — выбор сценария регистрации.
 *
 *   «Создать компанию» → /register/company (станете администратором, вход сразу)
 *   «Войти по коду»    → /register/join    (код выдаёт администратор компании)
 *
 * Водители здесь не регистрируются: их заводит логист в Автопарке.
 * Старые ссылки /register?invite=CODE уводим на /register/join с тем же кодом.
 */

import { Suspense, useEffect } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Building2, KeyRound, Truck, ChevronRight } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { PRODUCT_NAME } from "@/lib/auth/constants"

function RegisterChooser() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const invite = (searchParams?.get("invite") || "").trim()

  useEffect(() => {
    if (invite) router.replace(`/register/join?invite=${encodeURIComponent(invite)}`)
  }, [invite, router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background/70 via-background/40 to-primary/10 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary mb-4">
            <Truck className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{PRODUCT_NAME}</h1>
          <p className="text-muted-foreground">доступ к системе для вашей компании</p>
        </div>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground text-center">Выберите, что вам нужно</p>

          <Link href="/register/company" className="block group">
            <Card className="border-border/50 shadow-lg transition-colors group-hover:border-primary/60">
              <CardContent className="flex items-center gap-4 p-5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Building2 className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Создать компанию</p>
                  <p className="text-sm text-muted-foreground">
                    Вы станете администратором и сможете приглашать сотрудников
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>

          <Link href="/register/join" className="block group">
            <Card className="border-border/50 shadow-lg transition-colors group-hover:border-primary/60">
              <CardContent className="flex items-center gap-4 p-5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <KeyRound className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Войти по коду</p>
                  <p className="text-sm text-muted-foreground">
                    Для логистов и администраторов. Код выдаёт администратор компании
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        </div>

        <div className="space-y-3 text-center text-sm text-muted-foreground">
          <p>
            Водитель? Логист заводит вашу карточку в Автопарке. Входите по телефону и паролю на{" "}
            <Link href="/m/login" className="text-primary hover:underline">
              /m/login
            </Link>
            .
          </p>
          <p>
            Уже есть доступ?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Войти
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterChooser />
    </Suspense>
  )
}

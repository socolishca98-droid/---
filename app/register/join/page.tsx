"use client"

// /register/join — вход по коду приглашения (сценарий «Войти по коду»).
// Код можно передать ссылкой: /register/join?invite=XXXX-XXXX-XXXX

import { Suspense } from "react"
import { RegisterForm } from "@/components/register/register-form"

export default function RegisterJoinPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm mode="join" />
    </Suspense>
  )
}

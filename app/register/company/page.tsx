"use client"

// /register/company — создание новой компании (сценарий «Создать компанию»).

import { Suspense } from "react"
import { RegisterForm } from "@/components/register/register-form"

export default function RegisterCompanyPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm mode="create" />
    </Suspense>
  )
}

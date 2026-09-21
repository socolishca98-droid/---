// app/login/page.tsx
"use client"

import { Suspense } from "react"
import { LoginForm } from "@/components/login-form"
import { Loader2 } from "lucide-react"

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}

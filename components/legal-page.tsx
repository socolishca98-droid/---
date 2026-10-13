// components/legal-page.tsx
//
// Общая вёрстка юридических страниц (/privacy, /terms).
//
// Зачем общий компонент: у документов должна быть одна и та же структура —
// заголовок, дата редакции, разделы. Иначе политика и оферта выглядят как
// разные сайты, и человек не понимает, что это официальные документы одного
// сервиса. Плюс единое место для ссылок «назад» и для явной пометки о том,
// что документ нужно утвердить перед публикацией.

import Link from "next/link"
import type { ReactNode } from "react"

import { ArrowLeft, FileText } from "lucide-react"

import { operatorEmail, operatorName } from "@/lib/legal"

export function LegalPage({
  title,
  updatedAt,
  lead,
  children,
}: {
  title: string
  updatedAt: string
  lead: string
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          На главную
        </Link>

        <header className="mt-6 space-y-3">
          <div className="flex items-center gap-2 text-primary">
            <FileText className="size-5" />
            <span className="text-xs font-semibold uppercase tracking-[0.14em]">
              Документы сервиса
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          <p className="text-sm text-muted-foreground">Редакция от {updatedAt}</p>
          <p className="text-base leading-relaxed text-muted-foreground">{lead}</p>
        </header>

        <div className="mt-8 space-y-8">{children}</div>

        <footer className="mt-12 space-y-2 border-t border-border/50 pt-6 text-sm text-muted-foreground">
          <p>
            Оператор сервиса: {operatorName()}. Вопросы по обработке данных —{" "}
            <a href={`mailto:${operatorEmail()}`} className="text-primary hover:underline">
              {operatorEmail()}
            </a>
            .
          </p>
          <p>
            Документ опубликован в приложении, чтобы его можно было прочитать до принятия
            согласия. Перед публикацией на продакшене реквизиты оператора должны быть
            заполнены владельцем сервиса.
          </p>
        </footer>
      </div>
    </div>
  )
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground [&_a]:text-primary [&_a:hover]:underline [&_b]:text-foreground [&_li]:pl-1 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  )
}

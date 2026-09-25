"use client"

// app/print/route/[routeId]/page.tsx
//
// Печать документов по рейсу (задача 3, пункт 3): ТТН, путевой лист,
// договор-заявка. Страница открывается из карточки рейса, данные берёт из
// GET /api/routes/[routeId]/documents (там же проверяются доступ и организация).
//
// Печать штатная — Ctrl+P или кнопка «Печать»; сохранить в PDF можно из диалога
// печати браузера («Сохранить как PDF»). Так работает на любой машине без
// сторонних библиотек и без отправки данных документов наружу.

import { Suspense, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { AlertCircle, ArrowLeft, Loader2, Printer } from "lucide-react"

import { Button } from "@/components/ui/button"

interface DocumentField {
  label: string
  value: string | null
}

interface PrintDocument {
  kind: string
  number: string
  title: string
  subtitle: string | null
  blocks: { title: string; fields: DocumentField[] }[]
  tables: { title: string; columns: string[]; rows: string[][] }[]
  notes: string[]
  signatures: string[]
}

/** Незаполненное поле печатается местом для рукописной записи. */
function FieldValue({ value }: { value: string | null }) {
  if (value) return <span className="font-medium">{value}</span>
  return <span className="inline-block min-w-[120px] border-b border-dotted border-neutral-400 align-bottom">&nbsp;</span>
}

function Sheet({ document, index }: { document: PrintDocument; index: number }) {
  return (
    <article className="doc-sheet shadow-lg" key={`${document.kind}-${document.number}-${index}`}>
      <header className="mb-4 border-b-2 border-neutral-800 pb-2">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-lg font-bold uppercase tracking-wide">{document.title}</h1>
          <div className="text-right text-xs whitespace-nowrap">
            <div>№ {document.number}</div>
            {document.subtitle ? <div className="mt-1">{document.subtitle}</div> : null}
          </div>
        </div>
      </header>

      <div className="space-y-4">
        {document.blocks.map((block) => (
          <section key={block.title}>
            <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-neutral-700">
              {block.title}
            </h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
              {block.fields.map((field) => (
                <div key={`${block.title}-${field.label}`} className="flex gap-2">
                  <dt className="w-[46%] shrink-0 text-neutral-600">{field.label}:</dt>
                  <dd className="flex-1">
                    <FieldValue value={field.value} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        {document.tables.map((table) => (
          <section key={table.title}>
            <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-neutral-700">
              {table.title}
            </h2>
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  {table.columns.map((column) => (
                    <th
                      key={column}
                      className="border border-neutral-400 bg-neutral-100 px-2 py-1 text-left font-semibold"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr key={`${table.title}-${rowIndex}`}>
                    {row.map((cell, cellIndex) => (
                      <td
                        key={`${table.title}-${rowIndex}-${cellIndex}`}
                        className="border border-neutral-400 px-2 py-1 align-top"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
                {table.rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={table.columns.length}
                      className="border border-neutral-400 px-2 py-3 text-center text-neutral-500"
                    >
                      В рейсе нет заказов
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>
        ))}

        {document.notes.length > 0 ? (
          <section className="text-[11px] text-neutral-700">
            {document.notes.map((note) => (
              <p key={note} className="mt-1">
                {note}
              </p>
            ))}
          </section>
        ) : null}

        <section className="mt-8 space-y-3 text-[11px]">
          {document.signatures.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </section>
      </div>
    </article>
  )
}

function PrintRouteDocumentsContent() {
  const params = useParams<{ routeId: string }>()
  const searchParams = useSearchParams()
  const routeId = params?.routeId

  const types = searchParams.get("types") || ""

  const [documents, setDocuments] = useState<PrintDocument[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!routeId) return

    setIsLoading(true)
    setError(null)

    try {
      const query = types ? `?types=${encodeURIComponent(types)}` : ""
      const res = await fetch(`/api/routes/${routeId}/documents${query}`, { cache: "no-store" })
      const data = await res.json()

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Не удалось собрать документы")
      }

      setDocuments(data.documents || [])
    } catch (e: any) {
      setError(e?.message || "Не удалось собрать документы")
    } finally {
      setIsLoading(false)
    }
  }, [routeId, types])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="min-h-screen bg-neutral-200 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-6 flex max-w-[210mm] flex-wrap items-center gap-3 px-4">
        <Button variant="outline" size="sm" asChild>
          <Link href="/routes">
            <ArrowLeft className="mr-2 h-4 w-4" />
            К рейсам
          </Link>
        </Button>

        <span className="text-sm text-neutral-700">
          {isLoading
            ? "Готовлю документы…"
            : `Документов к печати: ${documents.length}`}
        </span>

        <Button size="sm" onClick={() => window.print()} disabled={isLoading || documents.length === 0}>
          <Printer className="mr-2 h-4 w-4" />
          Печать / PDF
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-sm text-neutral-600">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Собираю документы…
        </div>
      ) : error ? (
        <div className="mx-auto flex max-w-[210mm] items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          {error}
        </div>
      ) : documents.length === 0 ? (
        <div className="mx-auto max-w-[210mm] rounded-lg border border-neutral-300 bg-white p-8 text-center text-sm text-neutral-600">
          Документов нет. Проверьте, выбран ли хотя бы один вид документа, и есть ли в рейсе заказы.
        </div>
      ) : (
        documents.map((document, index) => (
          <Sheet key={`${document.kind}-${document.number}-${index}`} document={document} index={index} />
        ))
      )}
    </div>
  )
}

/**
 * useSearchParams в Next требует границы Suspense: страница печати открывается
 * с параметром types и не должна ронять сборку.
 */
export default function PrintRouteDocumentsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-neutral-200 text-sm text-neutral-600 print:hidden">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Открываю документы…
        </div>
      }
    >
      <PrintRouteDocumentsContent />
    </Suspense>
  )
}

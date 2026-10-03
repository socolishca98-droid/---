"use client";

// app/print/order/[orderId]/page.tsx
//
// Печать документов одного заказа: транспортная накладная, акт оказанных
// услуг и счёт на оплату. Страница открывается из карточки заказа, данные
// берёт из GET /api/orders/[id]/documents (там же проверяются доступ и
// организация). Виды документов выбираются галочками прямо на странице.
//
// Печать штатная — Ctrl+P или кнопка «Печать»; сохранить в PDF можно из
// диалога печати браузера («Сохранить как PDF»).

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertCircle, ArrowLeft, Loader2, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

interface DocumentField {
  label: string;
  value: string | null;
}

interface PrintDocument {
  kind: string;
  number: string;
  title: string;
  subtitle: string | null;
  blocks: { title: string; fields: DocumentField[] }[];
  tables: { title: string; columns: string[]; rows: string[][] }[];
  notes: string[];
  signatures: string[];
}

const KIND_OPTIONS = [
  { kind: "ttn", label: "Накладная (ТТН)" },
  { kind: "act", label: "Акт оказанных услуг" },
  { kind: "invoice", label: "Счёт на оплату" },
] as const;

/** Незаполненное поле печатается местом для рукописной записи. */
function FieldValue({ value }: { value: string | null }) {
  if (value) return <span className="font-medium">{value}</span>;
  return (
    <span className="inline-block min-w-[120px] border-b border-dotted border-neutral-400 align-bottom">
      &nbsp;
    </span>
  );
}

function Sheet({ document }: { document: PrintDocument }) {
  return (
    <article className="doc-sheet shadow-lg">
      <header className="mb-4 border-b-2 border-neutral-800 pb-2">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-lg font-bold uppercase tracking-wide">
            {document.title}
          </h1>
          <div className="whitespace-nowrap text-right text-xs">
            <div>№ {document.number}</div>
            {document.subtitle ? (
              <div className="mt-1">{document.subtitle}</div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="space-y-4">
        {document.blocks.map((block) => (
          <section key={block.title}>
            <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-neutral-700">
              {block.title}
            </h2>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-1 text-xs sm:grid-cols-2">
              {block.fields.map((field) => (
                <div
                  key={field.label}
                  className="flex items-baseline justify-between gap-2"
                >
                  <dt className="text-neutral-600">{field.label}</dt>
                  <dd className="text-right">
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
            <table className="w-full border-collapse text-xs">
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
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className="border border-neutral-400 px-2 py-1"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}

        {document.notes.length > 0 ? (
          <section className="text-[11px] text-neutral-700">
            {document.notes.map((note, index) => (
              <p key={index} className="mt-1">
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
  );
}

function PrintOrderDocumentsContent() {
  const params = useParams<{ orderId: string }>();
  const orderId = params?.orderId;

  const [kinds, setKinds] = useState<string[]>(
    KIND_OPTIONS.map((option) => option.kind),
  );
  const [documents, setDocuments] = useState<PrintDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orderId) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/orders/${orderId}/documents?types=${kinds.join(",")}`,
        {
          cache: "no-store",
        },
      );
      const data = await res.json();

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Не удалось собрать документы");
      }

      setDocuments(data.documents || []);
    } catch (e: any) {
      setError(e?.message || "Не удалось собрать документы");
    } finally {
      setIsLoading(false);
    }
  }, [orderId, kinds]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleKind = (kind: string) => {
    setKinds((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
  };

  return (
    <div className="min-h-screen bg-neutral-200 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-6 flex max-w-[210mm] flex-wrap items-center gap-3 px-4">
        <Button variant="outline" size="sm" asChild>
          <Link href="/orders">
            <ArrowLeft className="mr-2 h-4 w-4" />К заказам
          </Link>
        </Button>

        {/* Выбор видов документов */}
        <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-700">
          {KIND_OPTIONS.map((option) => (
            <label
              key={option.kind}
              className="flex cursor-pointer items-center gap-1.5"
            >
              <input
                type="checkbox"
                checked={kinds.includes(option.kind)}
                onChange={() => toggleKind(option.kind)}
                className="h-4 w-4 accent-neutral-800"
              />
              {option.label}
            </label>
          ))}
        </div>

        <span className="text-sm text-neutral-700">
          {isLoading
            ? "Готовлю документы…"
            : `Документов к печати: ${documents.length}`}
        </span>

        <Button
          size="sm"
          onClick={() => window.print()}
          disabled={isLoading || documents.length === 0}
        >
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
          Выберите хотя бы один вид документа.
        </div>
      ) : (
        documents.map((document, index) => (
          <div
            key={`${document.kind}-${index}`}
            className="mx-auto mb-6 max-w-[210mm] px-4 print:mb-0 print:max-w-none print:px-0"
          >
            <Sheet document={document} />
          </div>
        ))
      )}
    </div>
  );
}

export default function PrintOrderDocumentsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-neutral-200 text-sm text-neutral-600 print:hidden">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Открываю документы…
        </div>
      }
    >
      <PrintOrderDocumentsContent />
    </Suspense>
  );
}

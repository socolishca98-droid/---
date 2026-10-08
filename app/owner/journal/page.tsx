// app/owner/journal/page.tsx — журнал действий по всем компаниям.
//
// Фильтры: компания и тип действия. Записи подгружаются по 50 штук.

"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2 } from "lucide-react"

import { OwnerShell } from "@/components/owner/owner-shell"
import {
  ACTION_LABELS,
  ACTION_OPTIONS,
  Forbidden,
  Panel,
  actionLabel,
  formatDateTime,
} from "@/components/owner/owner-ui"
import { useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"

const PAGE = 50

interface JournalItem {
  id: string
  createdAt: string
  organizationId: string | null
  organizationName: string | null
  actorEmail: string | null
  action: string
  targetType: string
  targetEmail: string | null
}

interface JournalResponse {
  total: number
  limit: number
  offset: number
  items: JournalItem[]
}

interface OverviewResponse {
  organizations: { id: string; name: string }[]
}

export default function OwnerJournalPage() {
  const { user } = useStaffSession()
  const [orgId, setOrgId] = useState("")
  const [action, setAction] = useState("")
  const [items, setItems] = useState<JournalItem[]>([])
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const overview = useJsonApi<OverviewResponse>(user ? "/api/admin/overview" : null)

  const filterQuery = `${orgId ? `&organizationId=${encodeURIComponent(orgId)}` : ""}${
    action ? `&action=${encodeURIComponent(action)}` : ""
  }`

  // Первая страница — при смене фильтров
  const first = useJsonApi<JournalResponse>(user ? `/api/admin/journal?limit=${PAGE}${filterQuery}` : null)

  useEffect(() => {
    if (first.data) {
      setItems(first.data.items)
      setTotal(first.data.total)
      setError(null)
    }
  }, [first.data])

  useEffect(() => {
    if (first.error) setError(first.error)
  }, [first.error])

  const forbidden = Boolean(error && /владельц/i.test(error))

  async function loadMore() {
    setLoadingMore(true)
    try {
      const res = await fetch(
        `/api/admin/journal?limit=${PAGE}&offset=${items.length}${filterQuery}`,
        { cache: "no-store", credentials: "same-origin" },
      )
      const data = (await res.json().catch(() => null)) as JournalResponse | { error?: string } | null
      if (!res.ok || !data || !("items" in data)) {
        setError((data as { error?: string } | null)?.error || "Не удалось загрузить журнал")
        return
      }
      setItems((prev) => [...prev, ...data.items])
      setTotal(data.total)
    } catch {
      setError("Нет связи с сервером. Попробуйте ещё раз")
    } finally {
      setLoadingMore(false)
    }
  }

  const selectClass =
    "h-10 rounded-lg border border-border bg-card px-3 text-[13px] text-foreground transition-colors duration-200 focus:border-primary focus:outline-none"

  return (
    <OwnerShell>
      <Link
        href="/owner"
        className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors duration-200 hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Все компании
      </Link>

      <header className="mt-4 flex flex-col gap-1" style={{ animation: "rise-in 480ms cubic-bezier(0.22, 1, 0.36, 1) both" }}>
        <h1 className="text-[22px] font-semibold tracking-tight">Журнал действий</h1>
        <p className="text-[13.5px] text-muted-foreground">
          Кто, в какой компании и что сделал. Всего записей: {total}.
        </p>
      </header>

      {forbidden ? (
        <div className="mt-6">
          <Forbidden message="Этот экран доступен только владельцу платформы." />
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className={selectClass} aria-label="Компания">
          <option value="">Все компании</option>
          {(overview.data?.organizations ?? []).map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
        <select value={action} onChange={(e) => setAction(e.target.value)} className={selectClass} aria-label="Действие">
          <option value="">Все действия</option>
          {ACTION_OPTIONS.map((code) => (
            <option key={code} value={code}>
              {ACTION_LABELS[code]}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4">
        <Panel title={`Записей: ${items.length} из ${total}`}>
          {first.loading && items.length === 0 ? (
            <p className="flex items-center gap-2 px-4 py-4 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Загружаю журнал…
            </p>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="border-b border-border text-[12px] text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Когда</th>
                  <th className="px-4 py-2.5 font-medium">Компания</th>
                  <th className="px-4 py-2.5 font-medium">Кто</th>
                  <th className="px-4 py-2.5 font-medium">Действие</th>
                  <th className="px-4 py-2.5 font-medium">Над кем</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((row) => (
                  <tr
                    key={row.id}
                    className="transition-colors duration-200 hover:bg-secondary/40"
                    style={{ animation: "rise-in 380ms cubic-bezier(0.22, 1, 0.36, 1) both" }}
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{formatDateTime(row.createdAt)}</td>
                    <td className="px-4 py-2.5">{row.organizationName ?? <span className="text-muted-foreground">вне компании</span>}</td>
                    <td className="px-4 py-2.5 text-foreground/90">{row.actorEmail ?? "—"}</td>
                    <td className="px-4 py-2.5">{actionLabel(row.action)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{row.targetEmail ?? row.targetType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!first.loading && items.length === 0 && !error ? (
            <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">Записей по этим фильтрам нет</p>
          ) : null}

          {items.length < total ? (
            <div className="border-t border-border p-3 text-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-[13px] transition-colors duration-200 hover:bg-secondary disabled:opacity-60"
              >
                {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Показать ещё
              </button>
            </div>
          ) : null}
        </Panel>
      </div>
    </OwnerShell>
  )
}

"use client"

// components/audit/audit-view.tsx
//
// Журнал действий организации (только админ): кто входил, кого приглашали,
// одобряли, меняли роль, создавали и правили сущности. Данные — существующий
// GET /api/admin/audit, который сам ограничивает выборку организацией админа.

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { DataTable, type DataTableColumn } from "@/components/ui/data-table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TruckLoader } from "@/components/ui/truck-loader"
import { formatLocalDate } from "@/lib/dates"

interface AuditLogRow {
  id: string
  actorId: string
  actorEmail: string | null
  action: string
  targetId: string | null
  targetType: string
  targetEmail: string | null
  metadata: Record<string, unknown> | null
  ip: string | null
  createdAt: string
}

// Подписи действий — из комментариев схемы AuditLog
const ACTION_LABELS: Record<string, string> = {
  login: "Вход",
  create: "Создание",
  update: "Изменение",
  delete: "Удаление",
  approve: "Одобрение сотрудника",
  activate: "Активация",
  deactivate: "Деактивация",
  change_role: "Смена роли",
  invite_create: "Создание приглашения",
  invite_revoke: "Отзыв приглашения",
}

const ACTION_FILTERS = Object.entries(ACTION_LABELS)

const TARGET_TYPE_LABELS: Record<string, string> = {
  user: "сотрудник",
  order: "заказ",
  route: "рейс",
  client: "клиент",
  vehicle: "машина",
  driver: "водитель",
  organization: "организация",
}

function ActionBadge({ action }: { action: string }) {
  const label = ACTION_LABELS[action] ?? action
  if (action === "delete" || action === "deactivate" || action === "invite_revoke") {
    return <Badge variant="destructive">{label}</Badge>
  }
  if (action === "create" || action === "approve" || action === "activate") {
    return <Badge variant="secondary">{label}</Badge>
  }
  return <Badge variant="outline">{label}</Badge>
}

/** Короткая суть из metadata: старая/новая роль, причина и т.п. */
function metadataSummary(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null
  const parts: string[] = []
  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || value === undefined || typeof value === "object") continue
    parts.push(`${key}: ${String(value)}`)
  }
  return parts.length > 0 ? parts.join(" · ") : null
}

const columns: DataTableColumn<AuditLogRow>[] = [
  {
    key: "when",
    label: "Когда",
    cell: (row) => (
      <div>
        <p>{formatLocalDate(row.createdAt)}</p>
        <p className="text-xs text-muted-foreground">
          {new Date(row.createdAt).toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    ),
  },
  { key: "actor", label: "Кто", cell: (row) => row.actorEmail ?? "—" },
  { key: "action", label: "Действие", cell: (row) => <ActionBadge action={row.action} /> },
  {
    key: "target",
    label: "Объект",
    cell: (row) => {
      const type = TARGET_TYPE_LABELS[row.targetType] ?? row.targetType
      if (!row.targetId) return <span className="text-muted-foreground">—</span>
      return (
        <span>
          {row.targetEmail ?? ""}{" "}
          <span className="text-xs text-muted-foreground">({type})</span>
        </span>
      )
    },
  },
  {
    key: "details",
    label: "Детали",
    cell: (row) => {
      const summary = metadataSummary(row.metadata)
      return summary ? (
        <span className="line-clamp-1 max-w-xs text-muted-foreground">{summary}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )
    },
  },
  {
    key: "ip",
    label: "IP",
    cell: (row) => <span className="text-xs text-muted-foreground">{row.ip ?? "—"}</span>,
  },
]

const PAGE_SIZE = 100

export function AuditView() {
  const [action, setAction] = useState("all")
  const [logs, setLogs] = useState<AuditLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const load = useCallback(
    async (offset: number, append: boolean) => {
      if (append) setLoadingMore(true)
      else setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
        if (action !== "all") params.set("action", action)
        const response = await fetch(`/api/admin/audit?${params.toString()}`, {
          credentials: "include",
        })
        const json = await response.json()
        if (!response.ok || !json?.success) {
          setError(json?.error || "Не удалось загрузить журнал")
          return
        }
        const rows = (json.logs ?? []) as AuditLogRow[]
        setLogs((prev) => (append ? [...prev, ...rows] : rows))
        setHasMore(rows.length === PAGE_SIZE)
      } catch {
        setError("Сервер недоступен")
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [action],
  )

  useEffect(() => {
    load(0, false)
  }, [load])

  if (loading && logs.length === 0) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <TruckLoader className="text-primary" />
      </div>
    )
  }

  if (error && logs.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-destructive">{error}</CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Действие:</span>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все действия</SelectItem>
            {ACTION_FILTERS.map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={logs}
        rowKey={(row) => row.id}
        density="compact"
        isLoading={loadingMore}
        empty={
          <p className="p-6 text-center text-sm text-muted-foreground">
            Записей в журнале пока нет
          </p>
        }
      />

      {hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" disabled={loadingMore} onClick={() => load(logs.length, true)}>
            Показать ещё {PAGE_SIZE}
          </Button>
        </div>
      )}
    </div>
  )
}

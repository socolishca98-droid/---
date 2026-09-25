"use client"

// components/clients/clients-view.tsx
//
// Список клиентской базы со статистикой (задача 5).
//
// Видно сразу то, что важно логисту: сколько заказов, сколько денег пришло,
// есть ли просроченный долг, насколько клиент надёжен, когда был последний заказ.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Download, Loader2, Plus, RefreshCw, Search, Upload, Users } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

import { DataTable, type DataTableColumn } from "@/components/ui/data-table"
import { fetchJsonCached, invalidateCache, peekCache } from "@/lib/client-cache"
import { ClientCardDialog } from "./client-card-dialog"
import { ClientFormDialog, EMPTY_CLIENT } from "./client-form-dialog"
import { ClientImportDialog } from "./client-import-dialog"

type Client = {
  id: string
  name: string
  inn: string | null
  phone: string | null
  contactName: string | null
  email: string | null
  deferredDays: number | null
  source: string
  stats: {
    total: number
    delivered: number
    active: number
    cancelled: number
    revenueRub: number
    paidRub: number
    unpaidRub: number
    overdueRub: number
    overdueCount: number
    reliabilityPercent: number | null
    lastOrderAt: string | null
  }
}

type SortKey = "name" | "revenue" | "unpaid" | "reliability" | "lastOrder"

const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: "name", label: "по названию" },
  { id: "revenue", label: "по выручке" },
  { id: "unpaid", label: "по долгу" },
  { id: "reliability", label: "по надёжности" },
  { id: "lastOrder", label: "по последнему заказу" },
]

function money(value: number) {
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`
}

function shortDate(value: string | null) {
  if (!value) return "—"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "—"
  return parsed.toLocaleDateString("ru-RU")
}

// Столбцы списка клиентов: описаны данными, рисует их единый DataTable
const CLIENT_COLUMNS: DataTableColumn<Client>[] = [
  {
    key: "name",
    label: "Клиент",
    cell: (client) => (
      <>
        <div className="font-medium">{client.name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {client.inn && <span>ИНН {client.inn}</span>}
          {client.deferredDays !== null && <span>отсрочка {client.deferredDays} дн.</span>}
          {client.source === "import" && (
            <Badge variant="outline" className="text-[10px]">
              импорт
            </Badge>
          )}
        </div>
      </>
    ),
  },
  {
    key: "contacts",
    label: "Контакты",
    cellClassName: "text-xs text-muted-foreground",
    cell: (client) => (
      <>
        {client.contactName && <div>{client.contactName}</div>}
        {client.phone && <div>{client.phone}</div>}
        {!client.contactName && !client.phone && "—"}
      </>
    ),
  },
  {
    key: "orders",
    label: "Заказы",
    align: "right",
    cell: (client) => (
      <>
        {client.stats.total}
        <div className="text-xs text-muted-foreground">
          {client.stats.active > 0 ? `в работе ${client.stats.active}` : "нет активных"}
        </div>
      </>
    ),
  },
  {
    key: "revenue",
    label: "Выручка",
    align: "right",
    cell: (client) => (
      <>
        {money(client.stats.revenueRub)}
        <div className="text-xs text-emerald-600">получено {money(client.stats.paidRub)}</div>
      </>
    ),
  },
  {
    key: "debt",
    label: "Долг",
    align: "right",
    cell: (client) => (
      <>
        <span className={client.stats.overdueRub > 0 ? "text-destructive" : ""}>
          {money(client.stats.unpaidRub)}
        </span>
        {client.stats.overdueCount > 0 && (
          <div className="text-xs text-destructive">просрочено {client.stats.overdueCount}</div>
        )}
      </>
    ),
  },
  {
    key: "reliability",
    label: "Надёжность",
    cell: (client) =>
      client.stats.reliabilityPercent === null ? (
        <span className="text-xs text-muted-foreground">нет данных</span>
      ) : (
        <Badge
          variant={
            client.stats.reliabilityPercent >= 90
              ? "default"
              : client.stats.reliabilityPercent >= 70
                ? "secondary"
                : "destructive"
          }
        >
          {client.stats.reliabilityPercent}%
        </Badge>
      ),
  },
  {
    key: "lastOrder",
    label: "Последний заказ",
    cellClassName: "text-xs text-muted-foreground",
    cell: (client) => shortDate(client.stats.lastOrderAt),
  },
]

export function ClientsView() {
  const [clients, setClients] = useState<Client[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<SortKey>("name")
  const [onlyDebtors, setOnlyDebtors] = useState(false)

  const [cardClientId, setCardClientId] = useState<string | null>(null)
  const [isCardOpen, setIsCardOpen] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)

  const load = useCallback(async (options?: { force?: boolean }) => {
    if (options?.force) invalidateCache("/api/clients")
    if (!options?.force && peekCache("/api/clients?limit=500")) {
      // данные уже приносили — показываем сразу, без скелетона
      setClients(peekCache<{ clients?: Client[] }>("/api/clients?limit=500")!.data.clients ?? [])
      setIsLoading(false)
    } else {
      setIsLoading(true)
    }
    setError(null)

    try {
      // Через кеш: карточка клиента открывается и закрывается часто, и каждый
      // возврат не должен тянуть весь список заново
      const data = await fetchJsonCached<{ clients?: Client[] }>(
        "/api/clients?limit=500",
        { force: options?.force },
      )
      setClients(data.clients ?? [])
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить клиентов")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()

    const filtered = clients.filter((client) => {
      if (onlyDebtors && client.stats.unpaidRub <= 0) return false
      if (!query) return true

      return [client.name, client.inn, client.phone, client.contactName, client.email]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    })

    const sorted = [...filtered]
    sorted.sort((a, b) => {
      switch (sort) {
        case "revenue":
          return b.stats.revenueRub - a.stats.revenueRub
        case "unpaid":
          return b.stats.unpaidRub - a.stats.unpaidRub
        case "reliability":
          return (b.stats.reliabilityPercent ?? -1) - (a.stats.reliabilityPercent ?? -1)
        case "lastOrder": {
          const aTime = a.stats.lastOrderAt ? new Date(a.stats.lastOrderAt).getTime() : 0
          const bTime = b.stats.lastOrderAt ? new Date(b.stats.lastOrderAt).getTime() : 0
          return bTime - aTime
        }
        default:
          return a.name.localeCompare(b.name, "ru")
      }
    })

    return sorted
  }, [clients, search, sort, onlyDebtors])

  const totals = useMemo(
    () => ({
      count: clients.length,
      debt: clients.reduce((sum, client) => sum + client.stats.unpaidRub, 0),
      overdue: clients.reduce((sum, client) => sum + client.stats.overdueRub, 0),
    }),
    [clients],
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Клиенты</h1>
          <p className="text-sm text-muted-foreground">
            {totals.count} в базе
            {totals.debt > 0 ? ` · ждут оплаты ${money(totals.debt)}` : ""}
            {totals.overdue > 0 ? ` · просрочено ${money(totals.overdue)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => void load({ force: true })}
            disabled={isLoading}
            aria-label="Обновить список клиентов"
            title="Обновить список клиентов"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="outline" onClick={() => setIsImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Импорт базы
          </Button>
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Новый клиент
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск по названию, ИНН, телефону или контакту"
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap gap-1">
          {SORTS.map((option) => (
            <Button
              key={option.id}
              size="sm"
              variant={sort === option.id ? "secondary" : "ghost"}
              onClick={() => setSort(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="only-debtors"
            checked={onlyDebtors}
            onCheckedChange={(checked) => setOnlyDebtors(checked === true)}
          />
          <Label htmlFor="only-debtors" className="cursor-pointer text-sm">
            только должники
          </Label>
        </div>
      </div>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : (
        <DataTable
          columns={CLIENT_COLUMNS}
          rows={visible}
          rowKey={(client) => client.id}
          isLoading={isLoading}
          skeletonRows={7}
          empty={
            <Card className="flex flex-col items-center gap-3 p-10 text-center">
              <Users className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="font-medium">
                  {clients.length === 0 ? "Клиентская база пуста" : "Ничего не найдено"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {clients.length === 0
                    ? "Заведите первого клиента вручную или импортируйте существующую базу из файла."
                    : "Измените поиск или снимите фильтры."}
                </p>
              </div>
              {clients.length === 0 && (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setIsImportOpen(true)}>
                    <Upload className="mr-2 h-4 w-4" />
                    Импортировать базу
                  </Button>
                  <Button onClick={() => setIsCreateOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Добавить клиента
                  </Button>
                </div>
              )}
            </Card>
          }
          onRowClick={(client) => {
            setCardClientId(client.id)
            setIsCardOpen(true)
          }}
        />
      )}

      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Download className="h-3 w-3" />
        Нажмите на строку, чтобы открыть карточку: история заказов, оплаты и фото.
      </p>

      <ClientCardDialog
        open={isCardOpen}
        onOpenChange={setIsCardOpen}
        clientId={cardClientId}
        onChanged={() => void load({ force: true })}
      />

      <ClientFormDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        clientId={null}
        initial={EMPTY_CLIENT}
        onSaved={() => void load({ force: true })}
      />

      <ClientImportDialog open={isImportOpen} onOpenChange={setIsImportOpen} onImported={() => void load({ force: true })} />
    </div>
  )
}

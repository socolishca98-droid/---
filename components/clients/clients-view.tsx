"use client"

// components/clients/clients-view.tsx
//
// Список клиентской базы со статистикой (задача 5).
//
// Видно сразу то, что важно логисту: сколько заказов, сколько денег пришло,
// есть ли просроченный долг, насколько клиент надёжен, когда был последний заказ.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Download, Loader2, Plus, Search, Upload, Users } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

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

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch("/api/clients?limit=500")
      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Не удалось загрузить клиентов")
      }

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

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загружаем клиентскую базу…
        </div>
      ) : error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : visible.length === 0 ? (
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
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr className="text-left">
                  <th className="p-3 font-medium">Клиент</th>
                  <th className="p-3 font-medium">Контакты</th>
                  <th className="p-3 font-medium text-right">Заказы</th>
                  <th className="p-3 font-medium text-right">Выручка</th>
                  <th className="p-3 font-medium text-right">Долг</th>
                  <th className="p-3 font-medium">Надёжность</th>
                  <th className="p-3 font-medium">Последний заказ</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((client) => (
                  <tr
                    key={client.id}
                    className="cursor-pointer border-t transition hover:bg-muted/40"
                    onClick={() => {
                      setCardClientId(client.id)
                      setIsCardOpen(true)
                    }}
                  >
                    <td className="p-3">
                      <div className="font-medium">{client.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        {client.inn && <span>ИНН {client.inn}</span>}
                        {client.deferredDays !== null && <span>отсрочка {client.deferredDays} дн.</span>}
                        {client.source === "import" && <Badge variant="outline" className="text-[10px]">импорт</Badge>}
                      </div>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {client.contactName && <div>{client.contactName}</div>}
                      {client.phone && <div>{client.phone}</div>}
                      {!client.contactName && !client.phone && "—"}
                    </td>
                    <td className="p-3 text-right">
                      {client.stats.total}
                      <div className="text-xs text-muted-foreground">
                        {client.stats.active > 0 ? `в работе ${client.stats.active}` : "нет активных"}
                      </div>
                    </td>
                    <td className="p-3 text-right">
                      {money(client.stats.revenueRub)}
                      <div className="text-xs text-emerald-600">
                        получено {money(client.stats.paidRub)}
                      </div>
                    </td>
                    <td className="p-3 text-right">
                      <span className={client.stats.overdueRub > 0 ? "text-destructive" : ""}>
                        {money(client.stats.unpaidRub)}
                      </span>
                      {client.stats.overdueCount > 0 && (
                        <div className="text-xs text-destructive">
                          просрочено {client.stats.overdueCount}
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      {client.stats.reliabilityPercent === null ? (
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
                      )}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {shortDate(client.stats.lastOrderAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Download className="h-3 w-3" />
        Нажмите на строку, чтобы открыть карточку: история заказов, оплаты и фото.
      </p>

      <ClientCardDialog
        open={isCardOpen}
        onOpenChange={setIsCardOpen}
        clientId={cardClientId}
        onChanged={load}
      />

      <ClientFormDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        clientId={null}
        initial={EMPTY_CLIENT}
        onSaved={load}
      />

      <ClientImportDialog open={isImportOpen} onOpenChange={setIsImportOpen} onImported={load} />
    </div>
  )
}

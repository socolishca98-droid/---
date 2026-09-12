"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Search, X, Flame, CheckCircle, AlertTriangle, HelpCircle } from "lucide-react"

interface OrderFiltersProps {
  onFilterChange: (filters: FilterState) => void
}

export interface FilterState {
  search: string
  status: string
  priority: string
  source: string
  sortBy: string
}

const priorities = [
  { value: "all", label: "Все приоритеты" },
  { value: "hot", label: "Лучшие варианты", icon: Flame },
  { value: "possible", label: "Возможные", icon: CheckCircle },
  { value: "doubtful", label: "Сомнительные", icon: AlertTriangle },
  { value: "needs_clarification", label: "Уточнить", icon: HelpCircle },
]

const statuses = [
  { value: "all", label: "Все статусы" },
  { value: "new", label: "Новые" },
  { value: "processing", label: "В обработке" },
  { value: "confirmed", label: "Подтверждённые" },
  { value: "in_transit", label: "В пути" },
  { value: "delivered", label: "Доставленные" },
]

const sources = [
  { value: "all", label: "Все источники" },
  { value: "ATI.SU", label: "ATI.SU" },
  { value: "Груз.ру", label: "Груз.ру" },
  { value: "Telegram", label: "Telegram" },
  { value: "Объявления", label: "Объявления" },
]

const sortOptions = [
  { value: "aiScore", label: "По AI-рейтингу" },
  { value: "price", label: "По цене" },
  { value: "deadline", label: "По срокам" },
  { value: "distance", label: "По расстоянию" },
  { value: "createdAt", label: "По дате" },
]

export function OrderFilters({ onFilterChange }: OrderFiltersProps) {
  const [filters, setFilters] = useState<FilterState>({
    search: "",
    status: "all",
    priority: "all",
    source: "all",
    sortBy: "aiScore",
  })

  const [activeFilters, setActiveFilters] = useState<string[]>([])

  const updateFilter = (key: keyof FilterState, value: string) => {
    const newFilters = { ...filters, [key]: value }
    setFilters(newFilters)
    onFilterChange(newFilters)

    if (value !== "all" && value !== "" && key !== "search" && key !== "sortBy") {
      if (!activeFilters.includes(key)) {
        setActiveFilters([...activeFilters, key])
      }
    } else if (key !== "search" && key !== "sortBy") {
      setActiveFilters(activeFilters.filter((f) => f !== key))
    }
  }

  const clearFilter = (key: keyof FilterState) => {
    updateFilter(key, key === "sortBy" ? "aiScore" : "all")
    setActiveFilters(activeFilters.filter((f) => f !== key))
  }

  const clearAllFilters = () => {
    const newFilters: FilterState = {
      search: "",
      status: "all",
      priority: "all",
      source: "all",
      sortBy: "aiScore",
    }
    setFilters(newFilters)
    setActiveFilters([])
    onFilterChange(newFilters)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Поиск по маршруту, клиенту..."
            value={filters.search}
            onChange={(e) => updateFilter("search", e.target.value)}
            className="pl-9 bg-secondary border-0"
          />
        </div>

        {/* Priority Filter */}
        <Select value={filters.priority} onValueChange={(v) => updateFilter("priority", v)}>
          <SelectTrigger className="w-[180px] bg-secondary border-0">
            <SelectValue placeholder="Приоритет" />
          </SelectTrigger>
          <SelectContent>
            {priorities.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                <div className="flex items-center gap-2">
                  {p.icon && <p.icon className="h-4 w-4" />}
                  {p.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Status Filter */}
        <Select value={filters.status} onValueChange={(v) => updateFilter("status", v)}>
          <SelectTrigger className="w-[160px] bg-secondary border-0">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            {statuses.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Source Filter */}
        <Select value={filters.source} onValueChange={(v) => updateFilter("source", v)}>
          <SelectTrigger className="w-[160px] bg-secondary border-0">
            <SelectValue placeholder="Источник" />
          </SelectTrigger>
          <SelectContent>
            {sources.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Sort */}
        <Select value={filters.sortBy} onValueChange={(v) => updateFilter("sortBy", v)}>
          <SelectTrigger className="w-[180px] bg-secondary border-0">
            <SelectValue placeholder="Сортировка" />
          </SelectTrigger>
          <SelectContent>
            {sortOptions.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Active Filters */}
      {activeFilters.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground">Активные фильтры:</span>
          {activeFilters.map((key) => {
            const filterKey = key as keyof FilterState
            let label = ""
            if (filterKey === "priority") {
              label = priorities.find((p) => p.value === filters.priority)?.label || ""
            } else if (filterKey === "status") {
              label = statuses.find((s) => s.value === filters.status)?.label || ""
            } else if (filterKey === "source") {
              label = sources.find((s) => s.value === filters.source)?.label || ""
            }
            return (
              <Badge key={key} variant="secondary" className="gap-1 pr-1">
                {label}
                <button onClick={() => clearFilter(filterKey)} className="ml-1 rounded-full hover:bg-muted p-0.5">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )
          })}
          <Button variant="ghost" size="sm" onClick={clearAllFilters} className="text-muted-foreground">
            Сбросить все
          </Button>
        </div>
      )}
    </div>
  )
}

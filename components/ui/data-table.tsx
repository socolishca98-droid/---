"use client"

/**
 * Единый компонент списков-таблиц.
 *
 * До него каждая страница рисовала таблицу сама: где-то `<table className="w-full text-sm">`,
 * где-то примитивы shadcn, у кого-то шапка с фоном, у кого-то без, кто-то с пустым
 * состоянием, кто-то без. Здесь одна рамка, одна шапка, одни отступы, один скелет
 * загрузки и одно пустое состояние — странице остаётся описать столбцы и строки.
 *
 * Пример:
 *
 *   const columns: DataTableColumn<Client>[] = [
 *     { key: "name", label: "Клиент", cell: (row) => row.name },
 *     { key: "debt", label: "Долг", align: "right", cell: (row) => money(row.debt) },
 *   ]
 *
 *   <DataTable
 *     columns={columns}
 *     rows={clients}
 *     rowKey={(row) => row.id}
 *     isLoading={isLoading}
 *     empty={<EmptyBlock />}
 *     onRowClick={(row) => openCard(row.id)}
 *   />
 */

import * as React from "react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TableSkeleton } from "@/components/ui/skeletons"
import { cn } from "@/lib/utils"

export type DataTableAlign = "left" | "right" | "center"

export interface DataTableColumn<T> {
  /** Уникальный ключ столбца */
  key: string
  label?: React.ReactNode
  align?: DataTableAlign
  /** Ячейка строки; если не задана — берётся поле с именем key */
  cell?: (row: T) => React.ReactNode
  headerClassName?: string
  cellClassName?: string
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => React.Key
  /** cozy — отступы p-3 (основные списки), compact — p-2 (плотные отчёты) */
  density?: "cozy" | "compact"
  isLoading?: boolean
  skeletonRows?: number
  /** Что показать, когда строк нет */
  empty?: React.ReactNode
  onRowClick?: (row: T) => void
  rowClassName?: string | ((row: T, index: number) => string)
  /** false — таблица без своей рамки-карточки (когда уже лежит в Card) */
  frame?: boolean
  className?: string
  /** Дополнительные классы для tbody */
  bodyClassName?: string
}

const ALIGN: Record<DataTableAlign, string> = {
  left: "",
  right: "text-right",
  center: "text-center",
}

function DefaultEmpty() {
  return (
    <p className="py-12 text-center text-sm text-muted-foreground">Ничего не найдено</p>
  )
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  density = "cozy",
  isLoading = false,
  skeletonRows = 6,
  empty,
  onRowClick,
  rowClassName,
  frame = true,
  className,
  bodyClassName,
}: DataTableProps<T>) {
  const pad = density === "cozy" ? "p-3" : "p-2"

  const content = isLoading ? (
    // Внутри рамки собственная рамка скелетона лишняя
    <TableSkeleton
      rows={skeletonRows}
      columns={columns.length}
      className={frame ? "rounded-none border-0" : undefined}
    />
  ) : rows.length === 0 ? (
    empty ?? <DefaultEmpty />
  ) : (
    <Table className={className}>
      <TableHeader className="bg-muted/40 text-xs text-muted-foreground">
        <TableRow className="hover:bg-transparent">
          {columns.map((column) => (
            <TableHead
              key={column.key}
              className={cn(
                pad,
                "font-medium",
                ALIGN[column.align ?? "left"],
                column.headerClassName,
              )}
            >
              {column.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody className={cn("stagger-in", bodyClassName)}>
        {rows.map((row, index) => (
          <TableRow
            key={rowKey(row, index)}
            className={cn(
              onRowClick && "cursor-pointer hover:bg-muted/40",
              typeof rowClassName === "function" ? rowClassName(row, index) : rowClassName,
            )}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
            {columns.map((column) => (
              <TableCell
                key={column.key}
                className={cn(pad, ALIGN[column.align ?? "left"], column.cellClassName)}
              >
                {column.cell
                  ? column.cell(row)
                  : ((row as Record<string, React.ReactNode>)[column.key] ?? "—")}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )

  const body = frame ? (
    <div className="overflow-hidden rounded-xl border border-border bg-card">{content}</div>
  ) : (
    content
  )

  return <div className="overflow-x-auto">{body}</div>
}

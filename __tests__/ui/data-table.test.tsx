// Единый компонент таблиц: проверяем, что описание столбцов действительно
// превращается в шапку и строки, что выравнивание, пустое состояние и скелетон
// работают — иначе все списки разом «поедут».

import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import { DataTable, type DataTableColumn } from "@/components/ui/data-table"

type Row = { id: string; name: string; sum: number }

const columns: DataTableColumn<Row>[] = [
  { key: "name", label: "Клиент", cell: (row) => row.name },
  { key: "sum", label: "Сумма", align: "right", cell: (row) => `${row.sum} ₽` },
]

const rows: Row[] = [
  { id: "a", name: "ООО Ромашка", sum: 1500 },
  { id: "b", name: "ИП Петров", sum: 0 },
]

function render(node: React.ReactElement) {
  return renderToStaticMarkup(node)
}

describe("DataTable — единые списки-таблицы", () => {
  it("рисует заголовки из описания столбцов", () => {
    const html = render(
      <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} />,
    )

    expect(html).toContain("Клиент")
    expect(html).toContain("Сумма")
    expect(html.match(/<th[ >]/g)?.length).toBe(2)
  })

  it("рисует строки и значения ячеек", () => {
    const html = render(
      <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} />,
    )

    expect(html.match(/<tr/g)?.length).toBe(3) // шапка + две строки
    expect(html).toContain("ООО Ромашка")
    expect(html).toContain("1500 ₽")
    expect(html).toContain("ИП Петров")
    // строки появляются по очереди — базовый класс анимации на месте
    expect(html).toContain("stagger-in")
  })

  it("выравнивает колонки так, как просили", () => {
    const html = render(
      <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} />,
    )

    // «Сумма» — align: right: шапка + две ячейки
    expect(html.match(/text-right/g)?.length).toBe(3)
  })

  it("показывает своё пустое состояние, когда строк нет", () => {
    const html = render(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        empty={<span>Клиентская база пуста</span>}
      />,
    )

    expect(html).toContain("Клиентская база пуста")
    expect(html).not.toContain("<table")
  })

  it("показывает скелетон во время загрузки и не показывает пустое состояние", () => {
    const html = render(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        isLoading
        skeletonRows={3}
        empty={<span>Клиентская база пуста</span>}
      />,
    )

    expect(html).toContain("skeleton-shimmer")
    expect(html).not.toContain("Клиентская база пуста")
    expect(html).toContain('aria-label="Загружаем список"')
  })

  it("без рамки (frame=false) не добавляет свою карточку", () => {
    const framed = render(
      <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} />,
    )
    const bare = render(
      <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} frame={false} />,
    )

    expect(framed).toContain("bg-card")
    expect(bare).not.toContain("bg-card")
  })

  it("раскладывает шапку и ячейки по местам (thead/tbody/td)", () => {
    const html = render(
      <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} />,
    )

    expect(html).toContain("<thead")
    expect(html).toContain("<tbody")
    expect(html.match(/<th[ >]/g)?.length).toBe(2)
    expect(html.match(/<td[ >]/g)?.length).toBe(4)
  })
})

"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Printer } from "lucide-react"

interface OrderDoc {
  id: string
  orderNumber: string
  routeFrom: string
  routeTo: string
  cargoType: string
  weight: number | null
  price: number | null
  clientName: string | null
  clientContact: string | null
  createdAt: string
}

interface OrgDoc {
  name: string
  inn?: string | null
  kpp?: string | null
  ogrn?: string | null
  legalAddress?: string | null
  bankName?: string | null
  bik?: string | null
  checkingAccount?: string | null
  corrAccount?: string | null
  directorName?: string | null
}

export default function OrderDocumentPage() {
  const params = useParams<{ id: string }>()
  const [docType, setDocType] = useState<"invoice" | "act">("invoice")

  const [order, setOrder] = useState<OrderDoc | null>(null)
  const [org, setOrg] = useState<OrgDoc | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    if (sp.get("type") === "act") setDocType("act")
    Promise.all([
      fetch(`/api/orders/${params.id}`).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/organization").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([oData, orgData]) => {
        setOrder(oData?.order ?? oData ?? null)
        setOrg(orgData?.organization ?? orgData ?? null)
      })
      .finally(() => setLoading(false))
  }, [params.id])

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Готовим документ...</div>
  }

  if (!order) {
    return (
      <div className="p-6 text-sm">
        Заказ не найден. <Link href="/lm/orders" className="underline">К заказам</Link>
      </div>
    )
  }

  const dateStr = new Date(order.createdAt).toLocaleDateString("ru-RU")
  const price = order.price ?? 0
  const title = docType === "act" ? `Акт выполненных работ № ${order.orderNumber}` : `Счёт на оплату № ${order.orderNumber}`

  return (
    <div className="min-h-screen bg-white p-4 text-zinc-900 sm:p-8">
      <div className="mx-auto mb-6 flex max-w-3xl items-center justify-between gap-3 print:hidden">
        <Link
          href={`/lm/orders/${order.id}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Назад к заказу
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
        >
          <Printer className="h-4 w-4" />
          Печать / Сохранить PDF
        </button>
      </div>

      <div className="mx-auto max-w-3xl rounded-xl border border-zinc-300 bg-white p-6 shadow-sm sm:p-10 print:border-0 print:p-0 print:shadow-none">
        <div className="border-b border-zinc-300 pb-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500">
            {org?.name || "Транспортная компания"}
          </p>
          <h1 className="mt-1 text-xl font-bold text-zinc-900">
            {title} от {dateStr}
          </h1>
        </div>

        <div className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          <div className="rounded-lg bg-zinc-50 p-3.5">
            <p className="text-xs font-semibold uppercase text-zinc-500">Исполнитель</p>
            <p className="mt-1 font-semibold">{org?.name || "Не указано"}</p>
            {org?.inn && <p className="text-xs text-zinc-600">ИНН: {org.inn}{org.kpp ? ` / КПП: ${org.kpp}` : ""}</p>}
            {org?.legalAddress && <p className="mt-1 text-xs text-zinc-600">{org.legalAddress}</p>}
            {org?.bankName && (
              <p className="mt-1 text-xs text-zinc-600">
                Банк: {org.bankName}{org.bik ? `, БИК ${org.bik}` : ""}
                {org.checkingAccount ? `, р/с ${org.checkingAccount}` : ""}
              </p>
            )}
          </div>

          <div className="rounded-lg bg-zinc-50 p-3.5">
            <p className="text-xs font-semibold uppercase text-zinc-500">Заказчик</p>
            <p className="mt-1 font-semibold">{order.clientName || "Не указан"}</p>
            {order.clientContact && <p className="mt-1 text-xs text-zinc-600">Контакт: {order.clientContact}</p>}
          </div>
        </div>

        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-t border-zinc-300 bg-zinc-50 text-left text-xs uppercase text-zinc-600">
              <th className="py-2.5 pl-2">Наименование услуги</th>
              <th className="py-2.5 text-right">Вес</th>
              <th className="py-2.5 pr-2 text-right">Сумма</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-zinc-200">
              <td className="py-3 pl-2">
                Грузоперевозка по маршруту {order.routeFrom} — {order.routeTo} ({order.cargoType || "груз"})
              </td>
              <td className="py-3 text-right">{order.weight ? `${order.weight} кг` : "—"}</td>
              <td className="py-3 pr-2 text-right font-semibold">{price.toLocaleString("ru-RU")} ₽</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-4 flex justify-end text-base font-bold">
          Итого к оплате: {price.toLocaleString("ru-RU")} ₽
        </div>

        <div className="mt-10 grid grid-cols-2 gap-8 border-t border-zinc-300 pt-6 text-xs text-zinc-600">
          <div>
            <p className="font-semibold text-zinc-800">Исполнитель</p>
            <p className="mt-6 border-b border-zinc-400 pb-1">{org?.directorName || "________________"}</p>
          </div>
          <div>
            <p className="font-semibold text-zinc-800">Заказчик</p>
            <p className="mt-6 border-b border-zinc-400 pb-1">________________</p>
          </div>
        </div>
      </div>
    </div>
  )
}

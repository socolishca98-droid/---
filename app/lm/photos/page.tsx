// app/lm/photos/page.tsx — фотографии от водителей.
//
// Логист смотрит фото груза, повреждений, чеков и накладных. На телефоне это
// естественнее всего: сетка миниатюр, тап — на весь экран.

"use client"

import { useMemo, useState } from "react"
import { Camera, X } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { EmptyState, ErrorState, ListSkeleton } from "@/components/logist-mobile/ui"
import { useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import { PHOTO_TYPE_LABELS, type MobilePhoto } from "@/lib/logist-mobile/types"
import { formatDateTime } from "@/lib/logist-mobile/format"

const FILTERS = [
  { id: "all", label: "Все" },
  { id: "cargo_before", label: "До погрузки" },
  { id: "cargo_after", label: "После погрузки" },
  { id: "damage", label: "Повреждения" },
  { id: "receipt", label: "Чеки" },
  { id: "waybill", label: "Накладные" },
]

export default function LogistPhotosPage() {
  const { user } = useStaffSession()
  const { data, error, loading, reload } = useJsonApi<{ photos: MobilePhoto[] }>(user ? "/api/photos" : null)
  const [filter, setFilter] = useState("all")
  const [opened, setOpened] = useState<MobilePhoto | null>(null)

  const photos = useMemo(() => {
    const list = data?.photos ?? []
    return filter === "all" ? list : list.filter((photo) => photo.type === filter)
  }, [data, filter])

  return (
    <>
      <LogistHeader
        title="Фото"
        subtitle={data?.photos ? `${data.photos.length} снимков` : undefined}
        userName={user?.name}
      />

      <div className="sticky top-[calc(57px+env(safe-area-inset-top))] z-20 border-b border-white/8 bg-[#0b0b0e]/95 px-4 py-2.5 backdrop-blur">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={`rounded-full border px-3 py-1.5 text-[13px] font-medium ${
                filter === item.id
                  ? "border-orange-500/40 bg-orange-500/15 text-orange-300"
                  : "border-white/8 bg-white/[0.03] text-zinc-400"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-3.5">
        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading ? (
          <ListSkeleton rows={3} />
        ) : photos.length === 0 ? (
          <EmptyState
            icon={<Camera className="h-6 w-6" />}
            title="Фотографий нет"
            description="Снимки груза, документов и чеков делают водители в своём приложении"
          />
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {photos.map((photo) => (
              <button
                key={photo.id}
                type="button"
                onClick={() => setOpened(photo)}
                className="overflow-hidden rounded-2xl border border-white/8 bg-white/[0.03] text-left active:border-orange-500/40"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt={photo.description || "Фото"} className="h-40 w-full object-cover" loading="lazy" />
                <span className="block px-3 py-2">
                  <span className="block text-[12.5px] font-medium text-white">
                    {PHOTO_TYPE_LABELS[photo.type] ?? photo.type}
                  </span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-zinc-500">
                    {photo.description || formatDateTime(photo.createdAt)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {opened ? (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/95"
          style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="flex items-center justify-between px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-medium text-white">
                {PHOTO_TYPE_LABELS[opened.type] ?? opened.type}
              </p>
              <p className="text-[12px] text-zinc-400">{formatDateTime(opened.createdAt)}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpened(null)}
              aria-label="Закрыть"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white active:bg-white/20"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-auto px-2 pb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={opened.url} alt={opened.description || "Фото"} className="max-h-full w-full object-contain" />
          </div>
          {opened.orderId ? (
            <div className="px-4 pb-4">
              <a
                href={`/lm/orders/${opened.orderId}`}
                className="flex min-h-[48px] items-center justify-center rounded-xl bg-orange-500 text-[14.5px] font-semibold text-white active:bg-orange-600"
              >
                Открыть заказ
              </a>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

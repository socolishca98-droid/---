"use client"

import { useEffect, useState } from "react"
import { FileText, Plus, Share2, Trash2 } from "lucide-react"

export interface VehicleDocItem {
  id: string
  type: string
  expiresAt?: string
  fileName?: string
  dataUrl?: string
}

const DOC_TYPES = [
  "СТС",
  "ОСАГО / КАСКО",
  "Диагностическая карта",
  "Пропуск (МКАД/ТТК/СК)",
  "Санитарный паспорт",
  "Другое",
]

export function VehicleDocsPanel({ vehicleId, vehicleLabel }: { vehicleId: string; vehicleLabel: string }) {
  const storageKey = `vehicle_docs_${vehicleId}`
  const [docs, setDocs] = useState<VehicleDocItem[]>([])
  const [open, setOpen] = useState(false)
  const [docType, setDocType] = useState(DOC_TYPES[0])
  const [expiresAt, setExpiresAt] = useState("")
  const [fileName, setFileName] = useState("")
  const [dataUrl, setDataUrl] = useState("")

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) setDocs(JSON.parse(raw))
    } catch {
      // ignore
    }
  }, [storageKey])

  function save(next: VehicleDocItem[]) {
    setDocs(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      // ignore
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => setDataUrl(String(reader.result ?? ""))
    reader.readAsDataURL(file)
  }

  function addDoc() {
    const item: VehicleDocItem = {
      id: `${Date.now()}`,
      type: docType,
      expiresAt: expiresAt || undefined,
      fileName: fileName || undefined,
      dataUrl: dataUrl || undefined,
    }
    save([item, ...docs])
    setExpiresAt("")
    setFileName("")
    setDataUrl("")
    setOpen(false)
  }

  async function shareDoc(doc: VehicleDocItem) {
    if (doc.dataUrl && navigator.share) {
      try {
        const res = await fetch(doc.dataUrl)
        const blob = await res.blob()
        const file = new File([blob], doc.fileName || `${doc.type}.png`, { type: blob.type || "image/png" })
        await navigator.share({ title: `${doc.type} — ${vehicleLabel}`, files: [file] })
        return
      } catch {
        // fallback to download
      }
    }
    if (doc.dataUrl) {
      const a = document.createElement("a")
      a.href = doc.dataUrl
      a.download = doc.fileName || `${doc.type}-${vehicleLabel}.png`
      a.click()
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-border/70 bg-background/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
          <FileText className="h-3.5 w-3.5 text-amber-400" />
          Документы ({docs.length})
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11.5px] font-semibold text-amber-300"
        >
          <Plus className="h-3 w-3" />
          Добавить
        </button>
      </div>

      {open && (
        <div className="mt-2.5 space-y-2 rounded-lg border border-border bg-card p-2.5 text-xs">
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-foreground"
          >
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-foreground"
          />
          <input type="file" accept="image/*,application/pdf" onChange={onFile} className="w-full text-[11px]" />
          <button
            type="button"
            onClick={addDoc}
            className="w-full rounded-lg bg-amber-500 py-1.5 font-semibold text-zinc-950"
          >
            Сохранить документ
          </button>
        </div>
      )}

      {docs.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {docs.map((doc) => {
            const daysLeft = doc.expiresAt
              ? Math.ceil((new Date(doc.expiresAt).getTime() - Date.now()) / 86400000)
              : null
            return (
              <div key={doc.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/80 px-2.5 py-1.5 text-[12px]">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{doc.type}</p>
                  {doc.expiresAt && (
                    <p className={`text-[11px] ${daysLeft !== null && daysLeft <= 14 ? "text-amber-400" : "text-muted-foreground"}`}>
                      до {new Date(doc.expiresAt).toLocaleDateString("ru-RU")}
                      {daysLeft !== null && daysLeft <= 14 ? ` (${daysLeft <= 0 ? "истёк" : `осталось ${daysLeft} дн.`})` : ""}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {doc.dataUrl && (
                    <button
                      type="button"
                      onClick={() => shareDoc(doc)}
                      title="Отправить / скачать"
                      className="rounded-md border border-border px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-500/10"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => save(docs.filter((d) => d.id !== doc.id))}
                    className="rounded-md p-1 text-muted-foreground hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

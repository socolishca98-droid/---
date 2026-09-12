// lib/offline-queue.ts
import { safeLocalStorageGet, safeLocalStorageSet } from "@/lib/safe-json"

export type QueueItem = {
  id: string
  type: "photo"
  data: any
  status: "pending" | "uploading" | "success" | "failed"
  createdAt: number
  error?: string
}

class UploadQueue {
  private queue: QueueItem[] = []
  private listeners: Set<(queue: QueueItem[]) => void> = new Set()

  constructor() {
    if (typeof window !== "undefined") {
      this.load()
      window.addEventListener("online", () => this.processQueue())
    }
  }

  private load() {
    // ✅ ИСПРАВЛЕНО
    this.queue = safeLocalStorageGet<QueueItem[]>("uploadQueue", [])
  }

  private save() {
    safeLocalStorageSet("uploadQueue", this.queue)
    this.notify()
  }

  private notify() {
    this.listeners.forEach((listener) => listener([...this.queue]))
  }

  add(item: Omit<QueueItem, "id" | "status" | "createdAt">) {
    const queueItem: QueueItem = {
      ...item,
      id: `${Date.now()}-${Math.random()}`,
      status: "pending",
      createdAt: Date.now(),
    }
    this.queue.push(queueItem)
    this.save()
    this.processQueue()
  }

  async processQueue() {
    if (!navigator.onLine) return

    const pending = this.queue.filter((item) => item.status === "pending")

    for (const item of pending) {
      try {
        this.updateStatus(item.id, "uploading")

        if (item.type === "photo") {
          await this.uploadPhoto(item.data)
        }

        this.updateStatus(item.id, "success")
        setTimeout(() => this.remove(item.id), 3000)
      } catch (error: any) {
        this.updateStatus(item.id, "failed", error.message)
      }
    }
  }

  private async uploadPhoto(data: any) {
    const res = await fetch("/api/m/photos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })

    if (!res.ok) {
      throw new Error("Upload failed")
    }

    return res.json()
  }

  private updateStatus(id: string, status: QueueItem["status"], error?: string) {
    const item = this.queue.find((i) => i.id === id)
    if (item) {
      item.status = status
      if (error) item.error = error
      this.save()
    }
  }

  private remove(id: string) {
    this.queue = this.queue.filter((item) => item.id !== id)
    this.save()
  }

  subscribe(listener: (queue: QueueItem[]) => void) {
    this.listeners.add(listener)
    listener([...this.queue])
    return () => this.listeners.delete(listener)
  }

  retry(id: string) {
    this.updateStatus(id, "pending")
    this.processQueue()
  }

  clear() {
    this.queue = []
    this.save()
  }
}

export const uploadQueue = new UploadQueue()
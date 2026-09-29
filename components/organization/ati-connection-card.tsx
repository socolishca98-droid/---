"use client"

// components/organization/ati-connection-card.tsx
//
// Подключение организации к ATI.SU. Принцип: у каждой организации СВОЙ
// аккаунт ATI — свой токен, свои площадки, свои подписки и лимиты. Общий
// токен на всё приложение больше не используется.
//
// Карточка для админа: сохранить постоянный токен из «Мои токены» ATI.SU,
// подключить через OAuth 2.0 (если серверу выданы client_id/secret продукта),
// проверить подключение и отключить. Токен на сервере шифруется и в ответе
// никогда не возвращается — здесь только статус и название фирмы.

import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, ExternalLink, Loader2, PlugZap, ShieldAlert, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

interface ConnectionInfo {
  id: string
  kind: string
  status: string
  firmId: string | null
  firmName: string | null
  contactId: string | null
  expiresAt: string | null
  lastCheckAt: string | null
  lastError: string | null
}

interface StatusResponse {
  connected: boolean
  oauthAvailable: boolean
  connection: ConnectionInfo | null
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  active: { label: "Подключено", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  unverified: { label: "Токен сохранён — нужна проверка", className: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  invalid: { label: "Токен недействителен", className: "border-destructive/40 bg-destructive/10 text-destructive" },
}

export function AtiConnectionCard() {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [token, setToken] = useState("")
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/ati/connection", { credentials: "include" })
      const data = await response.json()
      if (data?.success) {
        setStatus({
          connected: Boolean(data.connected),
          oauthAvailable: Boolean(data.oauthAvailable),
          connection: data.connection ?? null,
        })
      }
    } catch {
      /* статус не критичен — карточка покажет «нет данных» */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    // результат OAuth-возврата видим в адресной строке (?ati=…)
    const params = new URLSearchParams(window.location.search)
    const ati = params.get("ati")
    if (ati === "connected") {
      setMessage({ kind: "ok", text: "ATI.SU подключён через OAuth — токен сохранён и активен" })
    } else if (ati?.startsWith("error")) {
      const reason = params.get("reason")
      setMessage({
        kind: "error",
        text: reason || "Не удалось подключить ATI.SU через OAuth. Попробуйте постоянный токен.",
      })
    }
  }, [load])

  const saveToken = async () => {
    setBusy("save")
    setMessage(null)
    try {
      const response = await fetch("/api/ati/connection", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      })
      const data = await response.json()
      if (!response.ok || !data?.success) {
        setMessage({ kind: "error", text: data?.error || "Не удалось сохранить токен" })
        return
      }
      setToken("")
      setMessage({ kind: "ok", text: "Токен сохранён. Нажмите «Проверить», чтобы подтвердить подключение." })
      await load()
    } catch {
      setMessage({ kind: "error", text: "Сервер недоступен" })
    } finally {
      setBusy(null)
    }
  }

  const check = async () => {
    setBusy("check")
    setMessage(null)
    try {
      const response = await fetch("/api/ati/connection/check", {
        method: "POST",
        credentials: "include",
      })
      const data = await response.json()
      if (!response.ok || !data?.success) {
        setMessage({ kind: "error", text: data?.error || "Проверка не удалась" })
      } else {
        setMessage({
          kind: "ok",
          text: `Подключение подтверждено: ${data.firmName ?? "фирма"} (ID ${data.firmId ?? "—"})`,
        })
      }
      await load()
    } catch {
      setMessage({ kind: "error", text: "Нет связи с сервером" })
    } finally {
      setBusy(null)
    }
  }

  const disconnect = async () => {
    if (!window.confirm("Отключить организацию от ATI.SU? Токен будет удалён безвозвратно.")) return
    setBusy("delete")
    setMessage(null)
    try {
      const response = await fetch("/api/ati/connection", { method: "DELETE", credentials: "include" })
      const data = await response.json()
      if (!response.ok || !data?.success) {
        setMessage({ kind: "error", text: data?.error || "Не удалось отключить" })
      } else {
        setMessage({ kind: "ok", text: "ATI.SU отключён" })
      }
      await load()
    } finally {
      setBusy(null)
    }
  }

  const connection = status?.connection ?? null
  const meta = connection ? STATUS_META[connection.status] ?? null : null

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <PlugZap className="h-5 w-5 text-primary" />
          Интеграция с ATI.SU
          {meta && (
            <Badge variant="outline" className={meta.className}>
              {meta.label}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          У каждой организации свой аккаунт ATI.SU: свой токен, свои площадки, подписки и лимиты
          запросов. Поиск грузов и контакты фирм работают от имени вашей организации.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {message && (
          <div
            className={
              "flex items-start gap-2 rounded-lg p-3 text-sm " +
              (message.kind === "ok"
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "bg-destructive/10 text-destructive")
            }
          >
            {message.kind === "ok" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
            ) : (
              <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
            )}
            <span>{message.text}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Загружаем состояние подключения…
          </div>
        ) : connection ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-border/50 bg-muted/20 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>
                  Фирма в ATI:{" "}
                  <strong>{connection.firmName ?? "не определена (нажмите «Проверить»)"}</strong>
                </span>
                <span className="text-muted-foreground">
                  Способ: {connection.kind === "oauth" ? "OAuth 2.0" : "постоянный токен"}
                </span>
                {connection.lastCheckAt && (
                  <span className="text-muted-foreground">
                    Проверено: {new Date(connection.lastCheckAt).toLocaleString("ru-RU")}
                  </span>
                )}
              </div>
              {connection.lastError && (
                <p className="mt-2 text-destructive">{connection.lastError}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={check} disabled={busy !== null}>
                {busy === "check" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Проверить
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={disconnect}
                disabled={busy !== null}
              >
                {busy === "delete" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Отключить
              </Button>
            </div>
            <details className="text-sm text-muted-foreground">
              <summary className="cursor-pointer select-none">Заменить токен</summary>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Input
                  type="password"
                  autoComplete="off"
                  className="max-w-md"
                  placeholder="Новый access_token ATI.SU"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                />
                <Button size="sm" onClick={saveToken} disabled={busy !== null || !token.trim()}>
                  {busy === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Сохранить
                </Button>
              </div>
            </details>
          </div>
        ) : (
          <div className="space-y-4">
            <ol className="space-y-2 text-sm">
              <li className="flex gap-2">
                <span className="font-semibold text-primary">1.</span>
                <span>
                  Зарегистрируйте организацию на{" "}
                  <a
                    href="https://ati.su"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                  >
                    ATI.SU <ExternalLink className="h-3 w-3" />
                  </a>{" "}
                  и подтвердите аккаунт (для юрлиц — оплатить любую лицензию или пополнить
                  виртуальный счёт с расчётного счёта фирмы).
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-primary">2.</span>
                <span>
                  В разделе{" "}
                  <a
                    href="https://ati.su/developers/tokens/"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                  >
                    «Мои токены» <ExternalLink className="h-3 w-3" />
                  </a>{" "}
                  создайте постоянный токен по client_id нашего продукта (client_id выдаёт
                  администратор системы) — или нажмите «Подключить через ATI.SU» ниже.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-primary">3.</span>
                <span>
                  Вставьте токен ниже и сохраните, затем нажмите «Проверить». После этого
                  «Поиск грузов» будет искать по вашим площадкам ATI, а лимиты запросов
                  (10/сек, 500 созданных грузов в сутки) расходуются вашим аккаунтом.
                </span>
              </li>
            </ol>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="password"
                autoComplete="off"
                className="max-w-md"
                placeholder="access_token ATI.SU"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
              <Button size="sm" onClick={saveToken} disabled={busy !== null || !token.trim()}>
                {busy === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Подключить
              </Button>
              {status?.oauthAvailable && (
                <Button variant="outline" size="sm" onClick={() => window.location.assign("/api/ati/oauth/start")}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Подключить через ATI.SU
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

"use client";

// components/push-enable-button.tsx
//
// «Включить уведомления» — подписка браузера на веб-пуш (VAPID).
// Работает и в мобильном пульте /s, и в контуре водителя /m, и в настройках
// десктопа. Если пуш на сервере не настроен (нет ключей VAPID в .env),
// компонент не показывается вовсе — не дразнить кнопкой, которая не работает.

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";

/** base64url-ключ → Uint8Array для applicationServerKey. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; ++i) output[i] = rawData.charCodeAt(i);
  return output;
}

type PushState =
  "hidden" | "idle" | "working" | "on" | "denied" | "unsupported";

export function PushEnableButton() {
  const [state, setState] = useState<PushState>("hidden");
  const [publicKey, setPublicKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    try {
      const res = await fetch("/api/push/vapid", { credentials: "include" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.enabled || !data.publicKey) {
        setState("hidden");
        return;
      }
      setPublicKey(data.publicKey);
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) setState("on");
      else if (Notification.permission === "denied") setState("denied");
      else setState("idle");
    } catch {
      setState("hidden");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = async () => {
    if (!publicKey) return;
    setState("working");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("denied");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      const data = await res.json().catch(() => null);
      setState(res.ok && data?.success ? "on" : "idle");
    } catch {
      setState("idle");
    }
  };

  const disable = async () => {
    setState("working");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe();
      }
    } finally {
      await refresh();
    }
  };

  if (state === "hidden" || state === "unsupported") return null;

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.04] p-3.5 backdrop-blur-xl">
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500/20 to-sky-500/5 text-sky-400 ring-1 ring-sky-500/20">
        {state === "on" ? (
          <Bell className="h-4 w-4" />
        ) : (
          <BellOff className="h-4 w-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {state === "on"
            ? "Уведомления включены"
            : state === "denied"
              ? "Уведомления заблокированы"
              : "Уведомления на телефон"}
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
          {state === "on"
            ? "SOS, сообщения чата и новые согласования придут даже из закрытого приложения."
            : state === "denied"
              ? "Разрешение отозвано в настройках браузера — включите уведомления для сайта там."
              : "SOS, чат и согласования будут приходить на телефон, даже когда приложение закрыто."}
        </p>
      </div>
      {state === "on" ? (
        <button
          type="button"
          onClick={() => void disable()}
          className="flex-shrink-0 rounded-xl border border-white/[0.08] px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
        >
          Выключить
        </button>
      ) : state === "denied" ? null : (
        <button
          type="button"
          onClick={() => void enable()}
          disabled={state === "working"}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-br from-sky-500 to-sky-600 px-3 py-1.5 text-xs font-semibold text-zinc-950 shadow-[0_8px_24px_-10px_rgba(14,165,233,0.6)] transition-opacity disabled:opacity-50"
        >
          {state === "working" && <Loader2 className="h-3 w-3 animate-spin" />}
          Включить
        </button>
      )}
    </div>
  );
}

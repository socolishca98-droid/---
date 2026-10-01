"use client";

// components/pwa-register.tsx
//
// Регистрирует service worker приложения. Вызывается из мобильных контуров
// (/s и /m): после установки с телефона интерфейс открывается standalone и
// переживает потерю сети, а данные всегда приходят живыми из /api.

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // без SW приложение работает как обычный сайт — не критично
    });
  }, []);

  return null;
}

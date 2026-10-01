// components/ati/ati-disabled-notice.tsx
//
// Заглушка для ATI-разделов, когда организация выключила биржу в настройках.
// Не тупик: объясняет, где теперь брать заказы (клиентская база) и где
// включить ATI обратно.

import Link from "next/link";
import { Plug, Users } from "lucide-react";

export function AtiDisabledNotice({
  title = "ATI.SU выключен",
}: {
  title?: string;
}) {
  return (
    <div className="surface-glass rounded-2xl p-10 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.05] text-zinc-500 ring-1 ring-white/[0.06]">
        <Plug className="h-6 w-6" />
      </span>
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        Ваша организация не работает через биржу грузов — ATI-разделы скрыты,
        чтобы не мешать. Заказы от постоянных клиентов создаются в один клик из
        клиентской базы: карточка клиента → «Новый заказ».
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/clients"
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 px-4 py-2.5 text-sm font-semibold text-zinc-950 shadow-[0_10px_28px_-12px_rgba(249,115,22,0.7)] transition-transform hover:-translate-y-0.5"
        >
          <Users className="h-4 w-4" />К клиентской базе
        </Link>
        <Link
          href="/settings"
          className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <Plug className="h-4 w-4" />
          Включить ATI в настройках
        </Link>
      </div>
    </div>
  );
}

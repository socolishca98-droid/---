import type { Metadata, Viewport } from "next"
import "./globals.css"
import { Toaster as SonnerToaster } from "sonner"
import { AuthProvider } from "@/lib/auth-context"
import { SidebarProvider } from "@/lib/sidebar-context"
import { CsrfProvider } from "@/components/csrf-provider"
import { LiveBackground } from "@/components/visual/live-background"
import { PageTransition } from "@/components/visual/page-transition"
import { WelcomeSplash } from "@/components/visual/welcome-splash"
import { ConfirmProvider } from "@/components/ui/confirm-dialog"

export const metadata: Metadata = {
  title: "Loginex TMS — Система управления грузоперевозками",
  description: "Loginex TMS: управление грузоперевозками, мониторинг автопарка, координация рейсов и мобильное приложение водителя",
  // Приложение с экрана «Домой» открывается БЕЗ браузерных стрелок и
  // адресной строки — на всех страницах, включая вход (раньше meta
  // был только в /m-контуре, и иконка запускалась в Safari)
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Loginex TMS",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#03060d",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // и49: видимая метка сборки на каждом экране. Разбор инцидентов на
  // телефоне владельца упёрся в единственное неразрешимое отсюда: сервер
  // отдаёт кабинет (журнал подтверждает каждый клик), а человек видит
  // другое. Метка в углу показывает, СВЕЖУЮ ли копию программы видит
  // человек: после каждого обновления сайта цифра меняется. Нет цифры
  // или старая цифра — телефон показывает устаревшую копию (отдельные
  // программы iOS хранит намертво), и это лечится переустановкой иконки.
  const buildTag = (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "dev").slice(0, 7)
  return (
    <html lang="ru" suppressHydrationWarning>
      {/* iOS понимает только apple-префиксную мету; Next 16 эмитит
          современную mobile-web-app-capable — дублируем для всех версий */}
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <body className="min-h-screen bg-background font-sans antialiased">
        {/* и52: воскресительный щит — на КАЖДОЙ странице, до всей гидрации.
            Телефон умеет замораживать вкладку на часы: краска остаётся
            (человек видит «вчерашний экран»), а JavaScript наполовину мёртв —
            ни запросов, ни реакции на нажатия (жалобы 13–15.11: сервер по
            журналу отдавал кабинет, а экран был старым). Живому коду вернуть
            страницу несложно: долго скрытая вкладка при возврате полностью
            перезагружается — сервер сам решает, что показать (живому
            владельцу — панель/кабинет, анониму — вход). Это тот же принцип,
            что и40 в контуре водителя, но щит закрывает ВСЕ экраны, включая
            вход владельца, и убирает сам «окаменевший кадр», а не только
            обновляет данные. 120 секунд выбраны осознанно: короче — можно
            перезагрузить человеку, отвлёкшемуся на минуту от набора пароля. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{
var GAP=120000,h=0;
document.addEventListener('visibilitychange',function(){
if(document.visibilityState==='hidden'){h=Date.now();return}
if(h&&Date.now()-h>GAP){location.reload()}
});
window.addEventListener('pageshow',function(e){if(e.persisted){location.reload()}});
}catch(e){}})()`,
          }}
        />
        <div
          aria-hidden
          style={{
            position: "fixed",
            left: 4,
            bottom: 2,
            zIndex: 9999,
            fontSize: 9,
            lineHeight: "10px",
            color: "#7c8090",
            opacity: 0.55,
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          сб. {buildTag}
        </div>
        {/* Живой фон (задача 9): декоративный слой под содержимым,
            в контуре водителя и на печати не рендерится */}
        <LiveBackground />

        <CsrfProvider>
          <AuthProvider>
            <SidebarProvider>
              {/* Подтверждения — свои диалоги, а не системные окна браузера */}
              <ConfirmProvider>
                {/* Плавный вход в раздел вместо мгновенной подмены экрана */}
                <PageTransition>{children}</PageTransition>
                {/* Приветствие после входа: показывается один раз на сессию,
                    в том числе на полноэкранном дашборде с картой */}
                <WelcomeSplash />
              </ConfirmProvider>
            </SidebarProvider>
          </AuthProvider>
        </CsrfProvider>
        {/* Уведомления — «прозрачное стекло» iOS: размытая подложка,
            лёгкая световая рамка, мягкая тень, крупное скругление.
            Позиция сверху по центру — как баннер-уведомление на iPhone. */}
        <SonnerToaster
          richColors
          position="top-center"
          toastOptions={{
            classNames: {
              toast:
                "!rounded-2xl !border !border-white/15 !bg-white/10 !backdrop-blur-xl !backdrop-saturate-150 !shadow-[0_8px_32px_rgba(0,0,0,0.36)] !ring-1 !ring-inset !ring-white/10 !text-[13px] !font-medium",
              title: "!text-[13px] !font-semibold",
              description: "!text-[11.5px] !opacity-75",
              actionButton:
                "!rounded-full !border-white/15 !bg-white/15 !backdrop-blur-sm !text-[12px]",
              cancelButton: "!rounded-full !border-white/15 !bg-white/10",
              closeButton: "!rounded-full !border-white/10 !bg-white/10",
              success:
                "!border-emerald-400/30 !bg-emerald-950/45 !text-emerald-50",
              error: "!border-red-400/30 !bg-red-950/45 !text-red-50",
              warning: "!border-amber-400/30 !bg-amber-950/45 !text-amber-50",
              info: "!border-white/15 !bg-white/10 !text-foreground",
            },
          }}
        />
      </body>
    </html>
  )
}
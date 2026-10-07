// components/page-layout.tsx

"use client"

import { useSidebar } from "@/lib/sidebar-context"
import { cn } from "@/lib/utils"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"

interface PageLayoutProps {
  children: React.ReactNode
  title: string
  description?: string
  actions?: React.ReactNode
}

export function PageLayout({ children, title, description, actions }: PageLayoutProps) {
  const { isCollapsed } = useSidebar()

  return (
    // Фон НЕ закрашиваем: под штабными страницами живёт LiveBackground
    // (общий слой в app/layout.tsx), а цвет подложки задаёт <body>.
    <div className="min-h-screen bg-transparent">
      <Sidebar />
      <div className={cn("transition-all duration-300 ease-in-out", isCollapsed ? "lg:ml-20" : "lg:ml-64")}>
        <Header />
        <main className="isolate space-y-4 p-4 lg:space-y-6 lg:p-6">
          {/* flex-wrap: на узком окне кнопки уходят под заголовок, а не наезжают на него */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-bold lg:text-2xl">{title}</h1>
              {description && <p className="text-sm text-muted-foreground lg:text-base">{description}</p>}
            </div>
            {actions}
          </div>
          {children}
        </main>
      </div>
    </div>
  )
}
// components/page-layout.tsx

"use client"

import { useSidebar } from "@/lib/sidebar-context"
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
      <div 
        className="transition-all duration-300 ease-in-out"
        style={{ marginLeft: isCollapsed ? '80px' : '256px' }}
      >
        <Header />
        <main className="p-6 space-y-6 isolate">
          {/* flex-wrap: на узком окне кнопки уходят под заголовок, а не наезжают на него */}
          <div className="flex flex-wrap justify-between items-center gap-3">
            <div>
              <h1 className="text-2xl font-bold">{title}</h1>
              {description && <p className="text-muted-foreground">{description}</p>}
            </div>
            {actions}
          </div>
          {children}
        </main>
      </div>
    </div>
  )
}
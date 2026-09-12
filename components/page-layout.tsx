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
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div 
        className="transition-all duration-300 ease-in-out"
        style={{ marginLeft: isCollapsed ? '80px' : '256px' }}
      >
        <Header />
        <main className="p-6 space-y-6">
          <div className="flex justify-between items-center">
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
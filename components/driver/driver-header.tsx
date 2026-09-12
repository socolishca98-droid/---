"use client"

import { Bell, Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import Link from "next/link"

interface DriverHeaderProps {
  driverName: string
  notificationCount?: number
}

export function DriverHeader({ driverName, notificationCount = 0 }: DriverHeaderProps) {
  const initials = driverName
    .split(" ")
    .map((n) => n[0])
    .join("")

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background px-4">
      {/* Menu */}
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon">
            <Menu className="h-6 w-6" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72">
          <SheetHeader>
            <SheetTitle>Меню</SheetTitle>
          </SheetHeader>
          <nav className="mt-6 space-y-2">
            <Link
              href="/driver"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium bg-primary/10 text-primary"
            >
              Мои задания
            </Link>
            <Link
              href="/driver/photos"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary"
            >
              Загрузить фото
            </Link>
            <Link
              href="/driver/history"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary"
            >
              История
            </Link>
            <Link
              href="/"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary"
            >
              Выход (Логист)
            </Link>
          </nav>
        </SheetContent>
      </Sheet>

      {/* Title */}
      <div className="flex items-center gap-2">
        <Avatar className="h-8 w-8">
          <AvatarFallback className="bg-primary text-primary-foreground text-sm">{initials}</AvatarFallback>
        </Avatar>
        <span className="font-medium">{driverName}</span>
      </div>

      {/* Notifications */}
      <Button variant="ghost" size="icon" className="relative">
        <Bell className="h-5 w-5" />
        {notificationCount > 0 && (
          <Badge className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs bg-primary text-primary-foreground">
            {notificationCount}
          </Badge>
        )}
      </Button>
    </header>
  )
}

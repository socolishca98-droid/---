// app/users/page.tsx
"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Users,
  UserCheck,
  UserX,
  Clock,
  Search,
  Shield,
  ShieldCheck,
  MoreVertical,
  Loader2,
  RefreshCw,
  UserPlus,
} from "lucide-react"
import { toast } from "sonner"

interface StaffUser {
  id: string
  email: string
  name: string | null
  role: "admin" | "logist"
  status: "pending_approval" | "active" | "deactivated"
  approvedBy: string | null
  approvedAt: string | null
  createdAt: string
  updatedAt: string
}

interface UserCounts {
  total: number
  pending: number
  active: number
  deactivated: number
}

export default function UsersManagementPage() {
  const { user: currentUser, isLoading: authLoading } = useAuth()
  const { isCollapsed } = useSidebar()
  const router = useRouter()

  const [users, setUsers] = useState<StaffUser[]>([])
  const [counts, setCounts] = useState<UserCounts>({
    total: 0,
    pending: 0,
    active: 0,
    deactivated: 0,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [activeTab, setActiveTab] = useState<"all" | "pending_approval" | "active" | "deactivated">("all")
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !currentUser) {
      router.push("/login")
    }
  }, [currentUser, authLoading, router])

  const fetchUsers = async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/admin/users")
      const data = await res.json()
      if (res.ok && data.success) {
        setUsers(data.users)
        if (data.counts) setCounts(data.counts)
      } else {
        toast.error(data.error || "Ошибка загрузки списка сотрудников")
      }
    } catch {
      toast.error("Сетевая ошибка при загрузке сотрудников")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  const handleAction = async (
    userId: string,
    action: "approve" | "deactivate" | "activate" | "change_role",
    role?: "admin" | "logist"
  ) => {
    setActionLoadingId(userId)
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, action, role }),
      })
      const data = await res.json()

      if (res.ok && data.success) {
        toast.success(
          action === "approve"
            ? "Доступ успешно одобрен"
            : action === "deactivate"
            ? "Сотрудник деактивирован"
            : action === "activate"
            ? "Доступ восстановлен"
            : "Роль обновлена"
        )
        await fetchUsers()
      } else {
        toast.error(data.error || "Не удалось выполнить операцию")
      }
    } catch {
      toast.error("Ошибка сети")
    } finally {
      setActionLoadingId(null)
    }
  }

  const filteredUsers = useMemo(() => {
    return users.filter((u: any) => {
      if (activeTab !== "all" && u.status !== activeTab) {
        return false
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const nameMatch = u.name?.toLowerCase().includes(q)
        const emailMatch = u.email.toLowerCase().includes(q)
        return nameMatch || emailMatch
      }
      return true
    })
  }, [users, activeTab, searchQuery])

  if (authLoading || !currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-primary h-8 w-8" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div
        className="transition-all duration-300 ease-in-out"
        style={{ paddingLeft: isCollapsed ? "80px" : "256px" }}
      >
        <Header />
        <main className="p-6 space-y-6">
          {/* Header section */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                <Users className="h-6 w-6 text-primary" />
                Сотрудники и Доступ
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Одобрение регистраций, управление ролями логистов и контроль учетных записей
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={fetchUsers}
                disabled={isLoading}
                className="gap-1.5"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                Обновить
              </Button>
            </div>
          </div>

          {/* Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-border/50">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Всего сотрудников</p>
                  <p className="text-2xl font-bold mt-1">{counts.total}</p>
                </div>
                <div className="p-3 bg-primary/10 rounded-xl text-primary">
                  <Users className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-amber-500">Ожидают одобрения</p>
                  <p className="text-2xl font-bold mt-1 text-amber-600 dark:text-amber-400">
                    {counts.pending}
                  </p>
                </div>
                <div className="p-3 bg-amber-500/10 rounded-xl text-amber-500">
                  <Clock className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-emerald-500">Активный доступ</p>
                  <p className="text-2xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">
                    {counts.active}
                  </p>
                </div>
                <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-500">
                  <UserCheck className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-rose-500">Деактивированы</p>
                  <p className="text-2xl font-bold mt-1 text-rose-600 dark:text-rose-400">
                    {counts.deactivated}
                  </p>
                </div>
                <div className="p-3 bg-rose-500/10 rounded-xl text-rose-500">
                  <UserX className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Table Card */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                {/* Tabs */}
                <div className="flex items-center gap-1.5 p-1 bg-muted/50 rounded-lg overflow-x-auto">
                  <button
                    onClick={() => setActiveTab("all")}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      activeTab === "all"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Все ({counts.total})
                  </button>
                  <button
                    onClick={() => setActiveTab("pending_approval")}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                      activeTab === "pending_approval"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    На одобрении ({counts.pending})
                  </button>
                  <button
                    onClick={() => setActiveTab("active")}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                      activeTab === "active"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    Активные ({counts.active})
                  </button>
                  <button
                    onClick={() => setActiveTab("deactivated")}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                      activeTab === "deactivated"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-rose-500" />
                    Деактивированные ({counts.deactivated})
                  </button>
                </div>

                {/* Search */}
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Поиск по имени или email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-9 pl-9 text-xs"
                  />
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {isLoading ? (
                <div className="flex items-center justify-center p-12">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="text-center p-12 text-muted-foreground space-y-2">
                  <Users className="h-8 w-8 mx-auto opacity-40" />
                  <p className="text-sm">Сотрудники не найдены</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Сотрудник</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Роль</TableHead>
                        <TableHead>Статус</TableHead>
                        <TableHead>Дата создания</TableHead>
                        <TableHead className="text-right">Действия</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.map((u: any) => {
                        const isActionLoading = actionLoadingId === u.id
                        const isSelf = currentUser.id === u.id

                        return (
                          <TableRow key={u.id}>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-primary/10 text-primary font-semibold text-xs flex items-center justify-center shrink-0">
                                  {u.name ? u.name.charAt(0).toUpperCase() : u.email.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <div className="font-medium text-sm flex items-center gap-1.5">
                                    {u.name || "Без имени"}
                                    {isSelf && (
                                      <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
                                        Вы
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </TableCell>

                            <TableCell className="text-sm text-muted-foreground">
                              {u.email}
                            </TableCell>

                            <TableCell>
                              <Badge
                                variant="outline"
                                className={
                                  u.role === "admin"
                                    ? "border-primary/50 text-primary bg-primary/5"
                                    : "border-border text-muted-foreground"
                                }
                              >
                                {u.role === "admin" ? (
                                  <span className="flex items-center gap-1">
                                    <ShieldCheck className="h-3 w-3" />
                                    Администратор
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1">
                                    <Shield className="h-3 w-3" />
                                    Логист
                                  </span>
                                )}
                              </Badge>
                            </TableCell>

                            <TableCell>
                              {u.status === "pending_approval" && (
                                <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                                  Ожидает одобрения
                                </Badge>
                              )}
                              {u.status === "active" && (
                                <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                                  Активен
                                </Badge>
                              )}
                              {u.status === "deactivated" && (
                                <Badge variant="secondary" className="text-rose-600 dark:text-rose-400 bg-rose-500/10 border border-rose-500/30">
                                  Деактивирован
                                </Badge>
                              )}
                            </TableCell>

                            <TableCell className="text-xs text-muted-foreground">
                              {new Date(u.createdAt).toLocaleDateString("ru-RU", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                            </TableCell>

                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                {u.status === "pending_approval" && (
                                  <Button
                                    size="sm"
                                    className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                                    disabled={isActionLoading}
                                    onClick={() => handleAction(u.id, "approve")}
                                  >
                                    {isActionLoading ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <>
                                        <UserCheck className="h-3.5 w-3.5 mr-1" />
                                        Одобрить доступ
                                      </>
                                    )}
                                  </Button>
                                )}

                                {u.status === "active" && !isSelf && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-500/10"
                                    disabled={isActionLoading}
                                    onClick={() => handleAction(u.id, "deactivate")}
                                  >
                                    Деактивировать
                                  </Button>
                                )}

                                {u.status === "deactivated" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"
                                    disabled={isActionLoading}
                                    onClick={() => handleAction(u.id, "activate")}
                                  >
                                    Восстановить
                                  </Button>
                                )}

                                {!isSelf && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-8 w-8">
                                        <MoreVertical className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      {u.role === "logist" ? (
                                        <DropdownMenuItem
                                          onClick={() => handleAction(u.id, "change_role", "admin")}
                                        >
                                          Назначить Администратором
                                        </DropdownMenuItem>
                                      ) : (
                                        <DropdownMenuItem
                                          onClick={() => handleAction(u.id, "change_role", "logist")}
                                        >
                                          Сделать обычным Логистом
                                        </DropdownMenuItem>
                                      )}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  )
}

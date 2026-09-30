"use client"

// components/onboarding/first-login-guide.tsx
//
// Приветственный инструктаж при первом входе. Показывается один раз на
// человека (отметка на сервере — User.onboardedAt), содержание своё для каждой
// из двух ролей: организатор (админ/логист) и исполнитель (водитель).
// «Показать позже» не ставит отметку — инструктаж встретит при следующем входе.

import { useEffect, useState } from "react"
import {
  BarChart3,
  Camera,
  ClipboardList,
  Fuel as FuelIcon,
  Package,
  RouteIcon,
  ShieldAlert,
  Smartphone,
  Warehouse,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { PRODUCT_NAME } from "@/lib/auth/constants"

interface GuideStep {
  icon: typeof Package
  title: string
  text: string
}

const STAFF_STEPS: GuideStep[] = [
  {
    icon: Warehouse,
    title: "Автопарк",
    text: "Добавьте машины и водителей — без них не собрать ни один рейс. Там же топливо, документы и обслуживание.",
  },
  {
    icon: Package,
    title: "Заказы",
    text: "Создавайте заказы вручную или берите грузы из ATI.SU — для этого подключите свой аккаунт ATI в разделе «Настройки».",
  },
  {
    icon: RouteIcon,
    title: "Маршруты",
    text: "Собирайте заказы в рейсы, назначайте водителя и машину. Рейс показывает экономику: ₽/км, маржу и убыточные плечи.",
  },
  {
    icon: Smartphone,
    title: "Водители в пути",
    text: "Водитель работает в мобильном приложении: статусы, фото, чеки и SOS. Данные сразу попадают в рейс и рейтинг.",
  },
  {
    icon: BarChart3,
    title: "Отчёты и топливо",
    text: "Реальные числа: прибыль по водителям и машинам, ведомость топлива, сроки ТО и страховок.",
  },
]

const DRIVER_STEPS: GuideStep[] = [
  {
    icon: ClipboardList,
    title: "Мои заказы",
    text: "Все активные заказы и рейсы — на главном экране. Отмечайте этапы: принял, в пути, доставил.",
  },
  {
    icon: Camera,
    title: "Фото",
    text: "Фотографируйте груз и документы на каждом этапе — это закрывает заказ и влияет на ваш рейтинг.",
  },
  {
    icon: FuelIcon,
    title: "Чеки",
    text: "Вносите топливные чеки: по ним считается реальный расход и экономика рейса.",
  },
  {
    icon: ShieldAlert,
    title: "SOS и отдых",
    text: "Кнопка SOS мгновенно сообщает диспетчеру, где вы. Нормы отдыха подскажут, когда нужна пауза.",
  },
]

export function FirstLoginGuide() {
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<string>("logist")
  const [name, setName] = useState<string>("")
  const [organizationName, setOrganizationName] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const response = await fetch("/api/onboarding", { credentials: "include" })
        const data = await response.json()
        if (!active || !data?.success || !data.show) return
        setRole(data.role)
        setName(data.name)
        setOrganizationName(data.organizationName ?? null)
        setOpen(true)
      } catch {
        /* нет инструктажа — не беда */
      }
    }
    load()
    return () => {
      active = false
    }
  }, [])

  const finish = async () => {
    setSaving(true)
    try {
      await fetch("/api/onboarding", { method: "POST", credentials: "include" })
    } finally {
      setSaving(false)
      setOpen(false)
    }
  }

  const isDriver = role === "driver"
  const steps = isDriver ? DRIVER_STEPS : STAFF_STEPS
  const accent = isDriver ? "text-orange-500" : "text-primary"
  const firstName = name.trim().split(/\s+/)[0] || "коллега"

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">
            Добро пожаловать в {PRODUCT_NAME}
            {firstName ? `, ${firstName}` : ""}!
          </DialogTitle>
          <DialogDescription>
            {organizationName
              ? `Организация: ${organizationName}. Коротко — как здесь всё устроено.`
              : "Коротко — как здесь всё устроено."}
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-3 py-1">
          {steps.map((step, index) => (
            <li key={step.title} className="flex items-start gap-3">
              <span
                className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-muted ${accent}`}
              >
                <step.icon className="h-4 w-4" />
              </span>
              <div className="pt-0.5">
                <p className="text-sm font-semibold">
                  {index + 1}. {step.title}
                </p>
                <p className="text-sm text-muted-foreground">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
            Показать позже
          </Button>
          <Button onClick={finish} disabled={saving} className={isDriver ? "bg-orange-500 hover:bg-orange-600" : ""}>
            Понятно, начать работу
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

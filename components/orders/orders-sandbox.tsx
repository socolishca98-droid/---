// components/orders/orders-sandbox.tsx

"use client"

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react"
import {
  DndContext,
  useSensor,
  useSensors,
  PointerSensor,
  DragEndEvent,
  useDraggable,
} from "@dnd-kit/core"
import {
  Package,
  Truck,
  MousePointer2,
  Link2,
  StickyNote,
  Trash2,
  FileText,
  GripVertical,
  Calendar,
  CheckCircle2,
  ArrowRight,
  X,
  Send,
  Phone,
  Building2,
  Route,
  Edit3,
  Eye,
  Pencil,
  MoreHorizontal,
  Info,
  FileCheck,
  FileSignature,
  FileSpreadsheet,
  Receipt,
  UserCheck,
  Globe,
  Layers,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Car,
  Ungroup,
  Group,
  Weight,
  DollarSign,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Clock,
  Undo2,
  MessagesSquare,
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  calculateAllCoefficients,
  calculateRiskFactors,
  calculateRouteCost,
  formatDuration as formatEtaDuration,
  type ETARequest,
  type RiskLevel,
} from "@/lib/eta"
import {
  isOrderClosed,
  isOrderRouteable,
  normalizeOrderStatus,
  orderStatusLabel,
  type OrderStatus,
} from "@/lib/orders/stages"
import { OrderProcess } from "@/components/orders/order-process"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

// ==================== ТИПЫ ====================
type Mode = "select" | "connect" | "route" | "group"

interface OrderItem {
  /** Локальный id элемента холста (для dnd-kit и подсветки). */
  id: string
  /** Id настоящего заказа организации, если элемент взят из песочницы. */
  orderId?: string
  /** Id строки накопленной базы ATI, из которой заказ был взят в работу. */
  atiCacheId?: string
  routeFrom: string
  routeTo: string
  distance: number
  cargo: string
  weight: number
  volume?: number
  price: number
  pricePerKm?: number
  loadingDate?: string
  loadingTime?: string
  unloadingDate?: string
  unloadingTime?: string
  clientName?: string
  clientPhone?: string
  clientCompany?: string
  comment?: string
  /** Этап заказа — канон жизненного цикла (lib/orders/stages.ts). */
  status: OrderStatus
  x: number
  y: number
  inRouteOrder?: number | null
  groupId?: string | null
}

type GroupColorId = "blue" | "green" | "purple" | "pink" | "cyan"

interface OrderGroup {
  id: string
  name: string
  color: GroupColorId
  orderIds: string[]
}

interface NoteItem {
  id: string
  text: string
  x: number
  y: number
  color: "yellow" | "blue" | "green" | "pink" | "orange"
  orderId?: string | null
}

interface Connection {
  id: string
  from: string
  to: string
}

interface CanvasSheet {
  id: number
  name: string
  orders: OrderItem[]
  notes: NoteItem[]
  connections: Connection[]
  groups: OrderGroup[]
}

interface DocumentTemplate {
  id: string
  name: string
  description: string
  icon: React.ReactNode
  category: "transport" | "financial" | "legal"
}

interface AtiOrderFromApi {
  id: string
  atiLoadId: string
  from: string
  to: string
  price: number
  weight: number
  distance: number
  cargo: string
  company: string
  phone?: string | null
  loadingDate?: string | null
  contactName?: string | null
  firmId?: string | null
  /**
   * Песочница показывает настоящие заказы организации (GET /api/ati/sandbox),
   * поэтому у строки есть id заказа и ссылка на строку накопленной базы ATI.
   */
  orderId?: string
  atiCacheId?: string | null
  routeFrom?: string
  routeTo?: string
  clientCompany?: string | null
  clientPhone?: string | null
  volume?: number | null
  requirements?: string | null
  priceNegotiable?: boolean
  /** Этап процесса заказа — lib/orders/stages.ts. */
  status?: string
  stage?: string | null
  statusLabel?: string
  agreedPrice?: number | null
  negotiationStatus?: string | null
  nextFollowUpAt?: string | null
  source?: string | null
  createdAt?: string | null
}

interface VehicleWithDriver {
  id: string
  plate: string
  type: string
  brand?: string
  model?: string
  capacity: number
  volume?: number
  status: string
  nextAvailableAt?: string | null
  driver?: {
    id: string
    name: string
    phone: string
    status: string
  }
}

// ==================== АВТОПРЕДЛОЖЕНИЯ (MVP) ====================
type AutoProposalType =
  | "dogruz"
  | "bundle"
  | "reroute"
  | "risk_delay"
  | "docs_missing"
  | "profit_boost"
  | "vehicle_match"

type AutoProposalStatus = "open" | "hidden" | "snoozed" | "sent"

interface AutoProposal {
  id: string
  type: AutoProposalType
  status: AutoProposalStatus
  title: string
  subtitle?: string
  reasons?: string[]
  score?: number

  // payload
  atiOrderId?: string
  existingOrderId?: string
  orderIds?: string[]
}

type RouteEtaPreview = {
  durationBaseSec: number
  durationWithTrafficSec: number
  riskLevel: RiskLevel
  delayProbability: number
  fuelCost: number
  tollsCost: number
  totalCost: number
}

const AUTOPROPOSALS_HIDDEN_KEY = "tms_sandbox_autoproposals_hidden_v1"
const AUTOPROPOSALS_SNOOZED_KEY = "tms_sandbox_autoproposals_snoozed_v1"
const AUTOPROPOSALS_SENT_KEY = "tms_sandbox_autoproposals_sent_v1"

const AUTOPROPOSALS_SNOOZE_MINUTES = 30

const AUTOPROPOSAL_TYPE_META: Record<
  AutoProposalType,
  { label: string; hint: string; badgeClass: string }
> = {
  dogruz: {
    label: "Догруз",
    hint: "Кандидаты для добора на текущий коридор",
    badgeClass: "border-fuchsia-500/30 text-fuchsia-300 bg-fuchsia-500/10",
  },
  bundle: {
    label: "Сборка",
    hint: "Группировка похожих направлений",
    badgeClass: "border-purple-500/30 text-purple-300 bg-purple-500/10",
  },
  reroute: {
    label: "Рероут",
    hint: "Переупорядочить/пересобрать плечо",
    badgeClass: "border-blue-500/30 text-blue-300 bg-blue-500/10",
  },
  risk_delay: {
    label: "Риски",
    hint: "Потенциальные опоздания/узкие места",
    badgeClass: "border-amber-500/30 text-amber-300 bg-amber-500/10",
  },
  docs_missing: {
    label: "Документы",
    hint: "Не хватает данных для оформления",
    badgeClass: "border-sky-500/30 text-sky-300 bg-sky-500/10",
  },
  profit_boost: {
    label: "Прибыль",
    hint: "Где можно улучшить ставку/экономику",
    badgeClass: "border-emerald-500/30 text-emerald-300 bg-emerald-500/10",
  },
  vehicle_match: {
    label: "ТС",
    hint: "Подбор машины/ёмкости под текущую сборку",
    badgeClass: "border-orange-500/30 text-orange-300 bg-orange-500/10",
  },
}

// ==================== КОНСТАНТЫ ====================
const NOTE_COLORS: Record<NoteItem["color"], string> = {
  yellow: "bg-yellow-100 border-yellow-300 text-yellow-900",
  blue: "bg-blue-100 border-blue-300 text-blue-900",
  green: "bg-green-100 border-green-300 text-green-900",
  pink: "bg-pink-100 border-pink-300 text-pink-900",
  orange: "bg-orange-100 border-orange-300 text-orange-900",
}

const GROUP_COLORS: {
  id: GroupColorId
  border: string
  bg: string
  text: string
}[] = [
  {
    id: "blue",
    border: "border-blue-500",
    bg: "bg-blue-500/8",
    text: "text-blue-300",
  },
  {
    id: "green",
    border: "border-green-500",
    bg: "bg-green-500/8",
    text: "text-green-300",
  },
  {
    id: "purple",
    border: "border-purple-500",
    bg: "bg-purple-500/8",
    text: "text-purple-300",
  },
  {
    id: "pink",
    border: "border-pink-500",
    bg: "bg-pink-500/8",
    text: "text-pink-300",
  },
  {
    id: "cyan",
    border: "border-cyan-500",
    bg: "bg-cyan-500/8",
    text: "text-cyan-300",
  },
]

const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: "tn",
    name: "Транспортная накладная",
    description: "Основной документ",
    icon: <FileText className="h-4 w-4 text-blue-400" />,
    category: "transport",
  },
  {
    id: "contract",
    name: "Договор-заявка",
    description: "Заявка на перевозку",
    icon: <FileSignature className="h-4 w-4 text-purple-400" />,
    category: "legal",
  },
  {
    id: "waybill",
    name: "Путевой лист",
    description: "Учёт работы водителя",
    icon: <Route className="h-4 w-4 text-green-400" />,
    category: "transport",
  },
  {
    id: "act",
    name: "Акт выполненных работ",
    description: "Подтверждение услуг",
    icon: <FileCheck className="h-4 w-4 text-emerald-400" />,
    category: "financial",
  },
  {
    id: "invoice",
    name: "Счёт на оплату",
    description: "Счёт для оплаты",
    icon: <Receipt className="h-4 w-4 text-yellow-400" />,
    category: "financial",
  },
  {
    id: "proxy",
    name: "Доверенность",
    description: "Право получения груза",
    icon: <UserCheck className="h-4 w-4 text-orange-400" />,
    category: "legal",
  },
  {
    id: "cmr",
    name: "CMR",
    description: "Международная накладная",
    icon: <Globe className="h-4 w-4 text-cyan-400" />,
    category: "transport",
  },
  {
    id: "ttn",
    name: "ТТН",
    description: "Товарно-транспортная",
    icon: <FileSpreadsheet className="h-4 w-4 text-indigo-400" />,
    category: "transport",
  },
]

const STORAGE_KEY = "tms_sandbox_sheets_v2"

const CARD_WIDTH = 230
const CARD_HEIGHT = 200
const NOTE_WIDTH = 190
const NOTE_HEIGHT = 110

// ==================== DRAGGABLE ORDER CARD ====================
function DraggableOrderCard({
  order,
  mode,
  isConnecting,
  isConnectionStart,
  isHighlighted,
  allOrders,
  group,
  attachedNotes,
  onDoubleClick,
  onConnectStart,
  onConnectEnd,
  onRemove,
  onRouteToggle,
  onSetRoutePosition,
  onSendDocuments,
  onAddToGroup,
  onRemoveFromGroup,
  onRemoveAttachedNote,
}: {
  order: OrderItem
  mode: Mode
  isConnecting: boolean
  isConnectionStart: boolean
  isHighlighted?: boolean
  allOrders: OrderItem[]
  group?: OrderGroup | null
  attachedNotes: NoteItem[]
  onDoubleClick: () => void
  onConnectStart: () => void
  onConnectEnd: () => void
  onRemove: () => void
  onRouteToggle: () => void
  onSetRoutePosition: (position: number) => void
  onSendDocuments: () => void
  onAddToGroup: () => void
  onRemoveFromGroup: () => void
  onRemoveAttachedNote: (noteId: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: order.id,
      disabled: mode === "route",
    })

  const style: React.CSSProperties = {
    position: "absolute",
    left: order.x,
    top: order.y,
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    zIndex: isDragging ? 100 : order.inRouteOrder ? 20 : 10,
  }

  const isInRoute = !!order.inRouteOrder
  const isInGroup = !!order.groupId
  const maxRouteOrder = Math.max(0, ...allOrders.map((o: any) => o.inRouteOrder || 0))
  const nextRouteNumber = maxRouteOrder + 1
  const displayName = order.clientCompany || order.clientName || "Заказ"

  const availablePositions = useMemo(
    () =>
      Array.from(
        { length: Math.min(nextRouteNumber, 10) },
        (_: unknown, idx: number) => idx + 1,
      ),
    [nextRouteNumber],
  )

  const groupColor = group ? (GROUP_COLORS as any).find((c: any) => c.id === group.color) : null
  const hasShortComment = Boolean(order.comment && order.comment.trim().length > 0)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "w-[230px] rounded-lg border-2 transition-all duration-200 group/card cursor-pointer",
        "bg-gradient-to-br from-slate-900 to-slate-800",
        "hover:shadow-lg hover:shadow-blue-500/10",
        isDragging && "opacity-70 scale-105 shadow-2xl rotate-2",
        isHighlighted && "ring-4 ring-amber-400/25 border-amber-400",
        isInRoute && "border-orange-500 shadow-orange-500/20 shadow-lg",
        isConnectionStart && "border-blue-500 ring-4 ring-blue-500/30",
        isInGroup &&
          groupColor &&
          `${groupColor.border} ring-2 ${groupColor.border.replace("border", "ring")}/30`,
        !isInRoute &&
          !isConnectionStart &&
          !isInGroup &&
          "border-slate-700 hover:border-slate-500",
        mode === "route" && "hover:scale-[1.02] hover:border-orange-400",
        mode === "connect" && "hover:border-blue-400",
        mode === "group" && "hover:border-purple-400 hover:ring-2 hover:ring-purple-400/30",
      )}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onDoubleClick()
      }}
      onClick={(e) => {
        e.stopPropagation()
        if (mode === "route") onRouteToggle()
        if (mode === "connect" && isConnecting) onConnectEnd()
        if (mode === "group") {
          if (isInGroup) onRemoveFromGroup()
          else onAddToGroup()
        }
      }}
      onMouseDown={(e) => {
        if (mode === "connect" && !isConnecting) {
          e.stopPropagation()
          onConnectStart()
        }
      }}
    >
      {isInRoute && (
        <div className="absolute -top-3 -left-3 w-7 h-7 rounded-full bg-orange-500 text-white font-bold text-sm flex items-center justify-center shadow-lg border-2 border-slate-900 z-10">
          {order.inRouteOrder}
        </div>
      )}

      {isInGroup && groupColor && (
        <div
          className={cn(
            "absolute -top-2 -right-2 px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 shadow-lg border border-slate-900 z-10",
            groupColor.bg,
            groupColor.text,
          )}
        >
          <Layers className="h-3.5 w-3.5" />
          {group?.name || "Группа"}
        </div>
      )}

      <div
        {...listeners}
        {...attributes}
        className={cn(
          "px-3 py-2 flex items-center justify-between border-b border-slate-700/50 bg-slate-800/60 rounded-t-lg",
          mode === "select" && "cursor-grab active:cursor-grabbing",
        )}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Building2
            className={cn(
              "h-3.5 w-3.5 flex-shrink-0",
              order.status === "search" && "text-sky-400",
              order.status === "negotiation" && "text-amber-400",
              order.status === "agreed" && "text-emerald-400",
              order.status === "in_route" && "text-orange-400",
              order.status === "documents" && "text-violet-400",
              order.status === "assigned" && "text-green-400",
              order.status === "control" && "text-orange-400",
              order.status === "delivered" && "text-slate-400",
              isOrderClosed(order.status) && "text-red-400",
            )}
          />
          <span className="text-xs font-medium text-slate-200 truncate">
            {displayName}
          </span>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {mode === "select" && <GripVertical className="h-4 w-4 text-slate-600" />}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="p-1 rounded hover:bg-slate-700 opacity-0 group-hover/card:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-3.5 w-3.5 text-slate-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56 bg-slate-900 border-slate-700"
            >
              <DropdownMenuItem
                onClick={onDoubleClick}
                className="text-slate-200 focus:bg-slate-800"
              >
                <Eye className="h-4 w-4 mr-2" /> Подробнее / редактировать
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-slate-700" />

              {isInGroup ? (
                <DropdownMenuItem
                  onClick={onRemoveFromGroup}
                  className="text-purple-400 focus:bg-slate-800"
                >
                  <Ungroup className="h-4 w-4 mr-2" /> Убрать из группы
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={onAddToGroup}
                  className="text-purple-400 focus:bg-slate-800"
                >
                  <Group className="h-4 w-4 mr-2" /> Добавить в группу
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator className="bg-slate-700" />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="text-slate-200 focus:bg-slate-800">
                  <Route className="h-4 w-4 mr-2 text-orange-400" />
                  Маршрут
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent className="bg-slate-900 border-slate-700">
                    {isInRoute ? (
                      <DropdownMenuItem
                        onClick={() => onSetRoutePosition(0)}
                        className="text-red-400"
                      >
                        <X className="h-4 w-4 mr-2" />
                        Убрать из маршрута
                      </DropdownMenuItem>
                    ) : (
                      availablePositions.map((position: any) => (
                        <DropdownMenuItem
                          key={position}
                          onClick={() => onSetRoutePosition(position)}
                          className="text-slate-200"
                        >
                          <div className="w-5 h-5 rounded-full bg-orange-500 text-white mr-2 flex items-center justify-center text-xs font-bold">
                            {position}
                          </div>
                          Позиция {position}
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
              <DropdownMenuSeparator className="bg-slate-700" />
              <DropdownMenuItem
                onClick={onSendDocuments}
                className="text-slate-200"
              >
                <Send className="h-4 w-4 mr-2 text-blue-400" />
                Документы
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-slate-700" />
              <DropdownMenuItem onClick={onRemove} className="text-red-400">
                <Trash2 className="h-4 w-4 mr-2" />
                Удалить с холста
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Тело карточки */}
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="flex-1 truncate text-white font-medium">
            {order.routeFrom?.split(",")[0]}
          </span>
          <ArrowRight className="h-4 w-4 text-slate-500 flex-shrink-0" />
          <span className="flex-1 truncate text-right text-white font-medium">
            {order.routeTo?.split(",")[0]}
          </span>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span className="flex items-center gap-1 max-w-[130px] truncate">
            <Package className="h-3 w-3" />
            <span className="truncate">{order.cargo}</span>
          </span>
          <span className="flex items-center gap-1">
            <Weight className="h-3 w-3" />
            {(order.weight / 1000).toFixed(1)}т
          </span>
        </div>

        {(order.loadingDate || order.unloadingDate) && (
          <div className="space-y-0.5 text-[10px] text-slate-400">
            {order.loadingDate && (
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Погр.
                </span>
                <span>
                  {new Date(order.loadingDate).toLocaleDateString("ru-RU")}
                  {order.loadingTime && ` • ${order.loadingTime}`}
                </span>
              </div>
            )}
            {order.unloadingDate && (
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3 opacity-70" />
                  Выгр.
                </span>
                <span>
                  {new Date(order.unloadingDate).toLocaleDateString("ru-RU")}
                  {order.unloadingTime && ` • ${order.unloadingTime}`}
                </span>
              </div>
            )}
          </div>
        )}

        {order.clientPhone && (
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 bg-emerald-500/10 rounded px-2 py-1">
            <Phone className="h-3 w-3" />
            <span className="font-mono truncate">{order.clientPhone}</span>
          </div>
        )}

        {Boolean(order.comment && order.comment.trim().length > 0) && (
          <div className="mt-1 pt-1 border-t border-slate-700/40 text-[10px] text-slate-400 max-h-9 overflow-hidden">
            <span className="font-semibold text-slate-500">Комментарий: </span>
            <span className="line-clamp-2">{order.comment}</span>
          </div>
        )}

        {attachedNotes.length > 0 && (
          <div
            className={cn(
              "pt-1 mt-1 space-y-0.5 text-[10px]",
              !(order.comment && order.comment.trim().length > 0) &&
                "border-t border-slate-700/40",
            )}
          >
            {attachedNotes.map((note: any) => (
              <div key={note.id} className="flex items-start gap-1 text-slate-200">
                <div className="flex-1 whitespace-pre-wrap">{note.text}</div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemoveAttachedNote(note.id)
                  }}
                  className="ml-1 p-0.5 rounded hover:bg-slate-800 flex-shrink-0"
                  title="Удалить заметку"
                >
                  <X className="h-3 w-3 text-slate-500 hover:text-red-400" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-1 border-t border-slate-700/50 mt-1">
          <div className="flex flex-col text-[10px] text-slate-500">
            <span>{order.distance} км</span>
            {order.pricePerKm && order.pricePerKm > 0 && (
              <span className="text-[10px] text-slate-400">
                {order.pricePerKm} ₽/км
              </span>
            )}
          </div>
          <span className="text-base font-bold text-emerald-400">
            {order.price > 0 ? `${order.price.toLocaleString()}₽` : "Договорная"}
          </span>
        </div>
      </div>
    </div>
  )
}

// ==================== КОНТУР ГРУППЫ ====================
function GroupContainer({
  group,
  orders,
  onRemoveGroup,
}: {
  group: OrderGroup
  orders: OrderItem[]
  onRemoveGroup: () => void
}) {
  if (orders.length === 0) return null

  const minX = Math.min(...orders.map((o: any) => o.x)) - 14
  const minY = Math.min(...orders.map((o: any) => o.y)) - 10
  const maxX = Math.max(...orders.map((o: any) => o.x + CARD_WIDTH)) + 14
  const maxY = Math.max(...orders.map((o: any) => o.y + CARD_HEIGHT)) + 4

  const width = maxX - minX
  const height = maxY - minY

  const groupColor =
    GROUP_COLORS.find((c: any) => c.id === group.color) ?? GROUP_COLORS[0]

  const totalPrice = orders.reduce((sum: any, o: any) => sum + o.price, 0)
  const totalWeight = orders.reduce((sum: any, o: any) => sum + o.weight, 0)
  const effectiveDistance = Math.max(...orders.map((o: any) => o.distance))
  const pricePerKm =
    effectiveDistance > 0 ? Math.round(totalPrice / effectiveDistance) : 0

  const mainOrder = orders.reduce<OrderItem>(
    (max, o) => (o.weight > max.weight ? o : max),
    orders[0],
  )
  const dogruzOrders = orders.filter((o: any) => o.id !== mainOrder.id)
  const dogruzWeight = dogruzOrders.reduce((sum: any, o: any) => sum + o.weight, 0)

  const topHeaderY = minY - 24
  const bottomStatsY = maxY + 6

  return (
    <>
      <div
        className={cn(
          "absolute rounded-2xl border border-dashed pointer-events-none",
          groupColor.border,
        )}
        style={{
          left: minX,
          top: minY,
          width,
          height,
          zIndex: 4,
        }}
      />

      <div
        className={cn(
          "absolute flex items-center gap-2 px-2.5 py-1 rounded-md border text-xs font-medium shadow-sm",
          groupColor.bg,
          groupColor.text,
          groupColor.border,
          "pointer-events-auto",
        )}
        style={{
          left: minX + 8,
          top: topHeaderY,
          zIndex: 6,
        }}
      >
        <Layers className="h-3.5 w-3.5" />
        <span className="truncate max-w-[160px]">{group.name}</span>
        <button
          type="button"
          onClick={onRemoveGroup}
          className="ml-1 p-0.5 rounded-full hover:bg-slate-950/50"
          title="Расформировать группу"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <div
        className="absolute flex flex-wrap gap-2 pointer-events-auto"
        style={{
          left: minX + 8,
          top: bottomStatsY,
          zIndex: 6,
        }}
      >
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-900/85 border border-slate-700/80 text-[11px]">
          <Route className="h-3 w-3 text-blue-300" />
          <span className="text-slate-200">{effectiveDistance} км</span>
        </div>

        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-900/85 border border-slate-700/80 text-[11px]">
          <Weight className="h-3 w-3 text-emerald-300" />
          <span className="text-slate-200">
            {(totalWeight / 1000).toFixed(1)} т
          </span>
        </div>

        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-900/85 border border-slate-700/80 text-[11px]">
          <DollarSign className="h-3 w-3 text-amber-300" />
          <span className="text-slate-200">{totalPrice.toLocaleString()} ₽</span>
          {pricePerKm > 0 && (
            <span
              className={cn(
                "ml-1 text-[10px]",
                pricePerKm >= 50
                  ? "text-emerald-300"
                  : pricePerKm >= 35
                    ? "text-yellow-300"
                    : "text-red-300",
              )}
            >
              • {pricePerKm} ₽/км
            </span>
          )}
        </div>

        {dogruzOrders.length > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-900/85 border border-slate-700/80 text-[11px]">
            <Package className="h-3 w-3 text-fuchsia-300" />
            <span className="text-slate-200">
              Догрузы: {dogruzOrders.length} • {(dogruzWeight / 1000).toFixed(1)}т
            </span>
          </div>
        )}
      </div>
    </>
  )
}

// ==================== DRAGGABLE NOTE ====================
function DraggableNote({
  note,
  mode,
  onEdit,
  onRemove,
}: {
  note: NoteItem
  mode: Mode
  onEdit: (text: string) => void
  onRemove: () => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(note.text)
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: note.id,
      disabled: mode === "route" || isEditing,
    })

  const style: React.CSSProperties = {
    position: "absolute",
    left: note.x,
    top: note.y,
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    zIndex: isDragging ? 100 : 15,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "w-48 rounded-lg border shadow-lg transition-all group",
        (NOTE_COLORS as any)[note.color],
        isDragging && "opacity-70 scale-105 rotate-3",
      )}
    >
      <div
        {...listeners}
        {...attributes}
        className="px-2 py-1.5 border-b border-current/20 flex items-center justify-between opacity-60"
      >
        <GripVertical className="h-3.5 w-3.5" />
        <div className="flex gap-1">
          {!isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="p-0.5 rounded hover:bg-black/10"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="p-0.5 rounded hover:bg-black/10"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="p-3">
        {isEditing ? (
          <div className="space-y-2">
            <Textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="min-h-[60px] bg-white/50 border-current/30 resize-none text-sm"
              autoFocus
            />
            <div className="flex gap-1">
              <Button
                size="sm"
                className="h-6 text-xs flex-1"
                onClick={() => {
                  onEdit(editText)
                  setIsEditing(false)
                }}
              >
                OK
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-xs"
                onClick={() => {
                  setEditText(note.text)
                  setIsEditing(false)
                }}
              >
                ✕
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm whitespace-pre-wrap">{note.text}</p>
        )}
      </div>
    </div>
  )
}

// ==================== ГЛАВНЫЙ КОМПОНЕНТ ====================
export function OrdersSandbox() {
  const [mode, setMode] = useState<Mode>("select")
  const [sheets, setSheets] = useState<CanvasSheet[]>([
    { id: 0, name: "Лист 1", orders: [], notes: [], connections: [], groups: [] },
    { id: 1, name: "Лист 2", orders: [], notes: [], connections: [], groups: [] },
    { id: 2, name: "Лист 3", orders: [], notes: [], connections: [], groups: [] },
  ])
  const [activeSheetId, setActiveSheetId] = useState(0)
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null)
  const [selectedOrderForEdit, setSelectedOrderForEdit] =
    useState<OrderItem | null>(null)
  const [selectedOrderForDocs, setSelectedOrderForDocs] =
    useState<OrderItem | null>(null)
  const [showAddNoteDialog, setShowAddNoteDialog] = useState(false)
  const [newNoteText, setNewNoteText] = useState("")
  const [newNoteColor, setNewNoteColor] = useState<NoteItem["color"]>("yellow")

  const [atiOrders, setAtiOrders] = useState<AtiOrderFromApi[]>([])
  const [loadingAti, setLoadingAti] = useState(true)

  const [autoPanelCollapsed, setAutoPanelCollapsed] = useState(false)
  const [collapsedProposalTypes, setCollapsedProposalTypes] = useState<
    Partial<Record<AutoProposalType, boolean>>
  >({})

  const [hiddenProposalIds, setHiddenProposalIds] = useState<Set<string>>(
    () => new Set<string>(),
  )
  const [sentProposalIds, setSentProposalIds] = useState<Set<string>>(
    () => new Set<string>(),
  )
  const [snoozedUntilById, setSnoozedUntilById] = useState<Record<string, number>>(
    () => ({}),
  )

  const [undoBanner, setUndoBanner] = useState<{
    label: string
    undo: () => void
    createdAt: number
  } | null>(null)

  const [timeTick, setTimeTick] = useState(0)

  const [capacityHint, setCapacityHint] = useState<{
    capacityKg: number
    vehicleLabel: string
  } | null>(null)
  const [loadingCapacityHint, setLoadingCapacityHint] = useState(false)

  const [highlightOrderId, setHighlightOrderId] = useState<string | null>(null)

  const [showVehicleDialog, setShowVehicleDialog] = useState(false)
  const [availableVehicles, setAvailableVehicles] = useState<VehicleWithDriver[]>(
    [],
  )
  const [loadingVehicles, setLoadingVehicles] = useState(false)
  const [selectedVehicle, setSelectedVehicle] =
    useState<VehicleWithDriver | null>(null)
  const [savingRoute, setSavingRoute] = useState(false)

  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [showCreateGroupDialog, setShowCreateGroupDialog] = useState(false)
  const [newGroupName, setNewGroupName] = useState("")
  const [newGroupColor, setNewGroupColor] = useState<GroupColorId>("blue")

  const [etaPreview, setEtaPreview] = useState<RouteEtaPreview | null>(null)

  const canvasRef = useRef<HTMLDivElement | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  /** Заказ, открытый в выдвижной панели согласования (быстрые действия). */
  const [negotiationOrderId, setNegotiationOrderId] = useState<string | null>(null)

  const activeSheet = sheets[activeSheetId]

  const usedAtiIds = useMemo(() => {
    const set = new Set<string>()
    sheets.forEach((sheet: any) => {
      sheet.orders.forEach((order: any) => {
        // в списке песочницы строка идентифицируется id заказа
        if (order.orderId) set.add(order.orderId)
        if (order.atiCacheId) set.add(order.atiCacheId)
      })
    })
    return set
  }, [sheets])

  const attachedNotesByOrderId = useMemo(() => {
    const map = new Map<string, NoteItem[]>()
    activeSheet.notes.forEach((note: any) => {
      if (note.orderId) {
        const existing = map.get(note.orderId) ?? []
        existing.push(note)
        map.set(note.orderId, existing)
      }
    })
    return map
  }, [activeSheet.notes])

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as unknown
        if (Array.isArray(parsed) && parsed.length > 0) {
          const parsedSheets = parsed as CanvasSheet[]
          const migrated: CanvasSheet[] = parsedSheets.map((sheet: any) => ({
            ...sheet,
            groups: sheet.groups || [],
          }))
          setSheets(migrated)
        }
      }
    } catch (e) {
      console.error("Failed to load sheets:", e)
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sheets))
    } catch (e) {
      console.error("Failed to save sheets:", e)
    }
  }, [sheets])

  // ==================== localStorage: автопредложения ====================
  useEffect(() => {
    const t = window.setInterval(() => setTimeTick(Date.now()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    try {
      const rawHidden = localStorage.getItem(AUTOPROPOSALS_HIDDEN_KEY)
      if (rawHidden) {
        const arr = JSON.parse(rawHidden) as unknown
        if (Array.isArray(arr)) {
          setHiddenProposalIds(
            new Set(arr.filter((x: any) => typeof x === "string")),
          )
        }
      }

      const rawSent = localStorage.getItem(AUTOPROPOSALS_SENT_KEY)
      if (rawSent) {
        const arr = JSON.parse(rawSent) as unknown
        if (Array.isArray(arr)) {
          setSentProposalIds(new Set(arr.filter((x: any) => typeof x === "string")))
        }
      }

      const rawSnoozed = localStorage.getItem(AUTOPROPOSALS_SNOOZED_KEY)
      if (rawSnoozed) {
        const obj = JSON.parse(rawSnoozed) as unknown
        if (obj && typeof obj === "object") {
          setSnoozedUntilById(obj as Record<string, number>)
        }
      }
    } catch (e) {
      console.error("Failed to load autoprops:", e)
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(
        AUTOPROPOSALS_HIDDEN_KEY,
        JSON.stringify(Array.from(hiddenProposalIds)),
      )
      localStorage.setItem(
        AUTOPROPOSALS_SENT_KEY,
        JSON.stringify(Array.from(sentProposalIds)),
      )
      localStorage.setItem(
        AUTOPROPOSALS_SNOOZED_KEY,
        JSON.stringify(snoozedUntilById),
      )
    } catch (e) {
      console.error("Failed to save autoprops:", e)
    }
  }, [hiddenProposalIds, sentProposalIds, snoozedUntilById])

  useEffect(() => {
    void loadAtiOrders()
  }, [])

  const loadAtiOrders = async (): Promise<void> => {
    setLoadingAti(true)
    try {
      const res = await fetch("/api/ati/sandbox")
      const data = (await res.json()) as unknown
      if (Array.isArray(data)) {
        setAtiOrders(data as AtiOrderFromApi[])
      } else {
        setAtiOrders([])
      }
    } catch (e) {
      console.error("Failed to load ATI:", e)
      setAtiOrders([])
    } finally {
      setLoadingAti(false)
    }
  }

  const removeFromAtiList = async (orderId: string): Promise<void> => {
    try {
      await fetch("/api/ati/sandbox", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: orderId }),
      })
      setAtiOrders((prev) => prev.filter((o: any) => o.id !== orderId))
      toast.success("Груз возвращён в базу")
    } catch {
      toast.error("Ошибка")
    }
  }

  const updateSheet = useCallback(
    (updater: (sheet: CanvasSheet) => CanvasSheet) => {
      setSheets((prev) =>
        prev.map((s: any) => (s.id === activeSheetId ? updater(s) : s)),
      )
    },
    [activeSheetId],
  )

  const addOrderFromAti = (atiOrder: AtiOrderFromApi): void => {
    const newOrder: OrderItem = {
      id: `order-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      // элемент песочницы — это существующий заказ организации: при оформлении
      // рейса он передаётся по orderId, а не создаётся заново
      orderId: atiOrder.orderId ?? atiOrder.id,
      atiCacheId: atiOrder.atiCacheId ?? undefined,
      routeFrom: atiOrder.routeFrom ?? atiOrder.from,
      routeTo: atiOrder.routeTo ?? atiOrder.to,
      distance: atiOrder.distance,
      cargo: atiOrder.cargo,
      weight: atiOrder.weight,
      volume: atiOrder.volume ?? undefined,
      price: atiOrder.price,
      pricePerKm:
        atiOrder.distance > 0
          ? Math.round(atiOrder.price / atiOrder.distance)
          : 0,
      clientCompany: atiOrder.clientCompany ?? atiOrder.company,
      clientPhone: atiOrder.clientPhone ?? atiOrder.phone ?? undefined,
      loadingDate: atiOrder.loadingDate || undefined,
      status: normalizeOrderStatus(atiOrder.status) ?? "search",
      x: 100 + Math.random() * 50,
      y: 100 + Math.random() * 50,
      groupId: null,
    }
    updateSheet((s) => ({ ...s, orders: [...s.orders, newOrder] }))
  }

  const pushUndo = (label: string, undo: () => void): void => {
    const createdAt = Date.now()
    setUndoBanner({ label, undo, createdAt })
    window.setTimeout(() => {
      setUndoBanner((prev) => {
        if (!prev) return null
        if (prev.createdAt !== createdAt) return prev
        return null
      })
    }, 8000)
  }

  const normalizeCity = (value: string | null | undefined): string => {
    const raw = (value ?? "").trim()
    if (!raw) return ""
    return raw.split(",")[0]?.trim().toLowerCase() ?? ""
  }

  const setHidden = (proposalId: string, hidden: boolean): void => {
    setHiddenProposalIds((prev) => {
      const next = new Set(prev)
      if (hidden) next.add(proposalId)
      else next.delete(proposalId)
      return next
    })
  }

  const snooze = (proposalId: string, minutes = AUTOPROPOSALS_SNOOZE_MINUTES): void => {
    const until = Date.now() + minutes * 60_000
    setSnoozedUntilById((prev) => ({ ...prev, [proposalId]: until }))
  }

  const unsnooze = (proposalId: string): void => {
    setSnoozedUntilById((prev) => {
      const next = { ...prev }
      delete next[proposalId]
      return next
    })
  }

  const markSent = (proposalId: string, sent: boolean): void => {
    setSentProposalIds((prev) => {
      const next = new Set(prev)
      if (sent) next.add(proposalId)
      else next.delete(proposalId)
      return next
    })
  }

  const calculateCapacityHintFromFleet = async (): Promise<void> => {
    if (routeOrders.length === 0) {
      toast.error("Сначала соберите маршрут (режим “Маршрут”)")
      return
    }

    setLoadingCapacityHint(true)
    try {
      const res = await fetch("/api/fleet")
      const data = (await res.json()) as any
      if (!data?.success) {
        throw new Error(data?.error || "Ошибка загрузки автопарка")
      }

      const vehiclesRaw = Array.isArray(data.vehicles) ? data.vehicles : []
      const vehicles: VehicleWithDriver[] = vehiclesRaw.map((v: any) => ({
        id: v.id,
        plate: v.plate,
        type: v.type,
        brand: v.brand ?? "",
        model: v.model ?? "",
        capacity: v.capacity ?? 0,
        volume: v.volume ?? undefined,
        status: v.status,
        nextAvailableAt: v.nextAvailableAt ?? null,
        driver: v.driver
          ? {
              id: v.driver.id,
              name: v.driver.name,
              phone: v.driver.phone,
              status: v.driver.status,
            }
          : undefined,
      }))

      const totalWeightKg = routeCalculation.totalWeight
      const candidates = vehicles
        .filter((v: any) => v.status === "available" && v.capacity >= totalWeightKg)
        .sort((a, b) => a.capacity - b.capacity)

      if (candidates.length === 0) {
        setCapacityHint(null)
        toast.message("Нет доступных машин под текущий вес (проверьте маршрут/парк)")
        return
      }

      const best = candidates[0]
      const label = `${best.plate}${best.driver?.name ? ` • ${best.driver.name}` : ""} • ${(best.capacity / 1000).toFixed(0)}т`

      setCapacityHint({ capacityKg: best.capacity, vehicleLabel: label })
      toast.success("Ёмкость рассчитана по автопарку")
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || "Не удалось рассчитать ёмкость")
      setCapacityHint(null)
    } finally {
      setLoadingCapacityHint(false)
    }
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, delta } = event
    const id = active.id as string

    if (id.startsWith("order-")) {
      const anchor = activeSheet.orders.find((o: any) => o.id === id)
      if (!anchor) return

      let dx = delta.x
      let dy = delta.y

      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect()
        const maxX = rect.width - CARD_WIDTH
        const maxY = rect.height - CARD_HEIGHT

        let newX = anchor.x + dx
        let newY = anchor.y + dy

        newX = Math.max(0, Math.min(newX, maxX))
        newY = Math.max(0, Math.min(newY, maxY))

        dx = newX - anchor.x
        dy = newY - anchor.y
      }

      if (anchor.groupId) {
        updateSheet((s) => ({
          ...s,
          orders: s.orders.map((o: any) =>
            o.groupId === anchor.groupId
              ? { ...o, x: o.x + dx, y: o.y + dy }
              : o,
          ),
        }))
      } else {
        updateSheet((s) => ({
          ...s,
          orders: s.orders.map((o: any) =>
            o.id === id ? { ...o, x: o.x + dx, y: o.y + dy } : o,
          ),
        }))
      }
      return
    }

    if (id.startsWith("note-")) {
      updateSheet((s) => {
        const movedNotes = s.notes.map((n: any) =>
          n.id === id ? { ...n, x: n.x + delta.x, y: n.y + delta.y } : n,
        )
        const note = movedNotes.find((n: any) => n.id === id)
        if (!note) return { ...s, notes: movedNotes }

        const centerX = note.x + NOTE_WIDTH / 2
        const centerY = note.y + NOTE_HEIGHT / 2

        let attachedOrderId: string | null = null
        let attachedOrder: OrderItem | null = null

        for (const o of s.orders) {
          const withinX = centerX >= o.x && centerX <= o.x + CARD_WIDTH
          const withinY = centerY >= o.y && centerY <= o.y + CARD_HEIGHT
          if (withinX && withinY) {
            attachedOrderId = o.id
            attachedOrder = o
            break
          }
        }

        if (attachedOrderId && attachedOrder) {
          const updatedNotes = movedNotes.map((n: any) =>
            n.id === id
              ? {
                  ...n,
                  orderId: attachedOrderId,
                  x: attachedOrder.x,
                  y: attachedOrder.y,
                }
              : n,
          )
          return { ...s, notes: updatedNotes }
        }

        const updatedNotes = movedNotes.map((n: any) =>
          n.id === id ? { ...n, orderId: null } : n,
        )
        return { ...s, notes: updatedNotes }
      })
    }
  }

  const handleConnectStart = (orderId: string): void =>
    setConnectingFrom(orderId)

  const handleConnectEnd = (orderId: string): void => {
    if (connectingFrom && connectingFrom !== orderId) {
      const exists = activeSheet.connections.some((c: any) =>
          (c.from === connectingFrom && c.to === orderId) ||
          (c.from === orderId && c.to === connectingFrom),
      )
      if (!exists) {
        updateSheet((s) => ({
          ...s,
          connections: [
            ...s.connections,
            { id: `conn-${Date.now()}`, from: connectingFrom, to: orderId },
          ],
        }))
      }
    }
    setConnectingFrom(null)
    setMode("select")
  }

  const removeConnection = (connId: string): void =>
    updateSheet((s) => ({
      ...s,
      connections: s.connections.filter((c: any) => c.id !== connId),
    }))

  const createGroup = (): void => {
    if (!newGroupName.trim()) {
      toast.error("Введите название группы")
      return
    }

    const newGroup: OrderGroup = {
      id: `group-${Date.now()}`,
      name: newGroupName.trim(),
      color: newGroupColor,
      orderIds: [],
    }

    updateSheet((s) => ({ ...s, groups: [...s.groups, newGroup] }))
    setActiveGroupId(newGroup.id)
    setShowCreateGroupDialog(false)
    setNewGroupName("")
    setMode("group")
    toast.success(
      `Группа "${newGroup.name}" создана. Кликайте на карточки для добавления.`,
    )
  }

  const addOrderToGroup = (orderId: string): void => {
    if (!activeGroupId) {
      setShowCreateGroupDialog(true)
      return
    }

    updateSheet((s) => ({
      ...s,
      orders: s.orders.map((o: any) =>
        o.id === orderId ? { ...o, groupId: activeGroupId } : o,
      ),
      groups: s.groups.map((g: any) =>
        g.id === activeGroupId
          ? {
              ...g,
              orderIds: [
                ...g.orderIds.filter((existingId: any) => existingId !== orderId),
                orderId,
              ],
            }
          : g,
      ),
    }))
  }

  const removeOrderFromGroup = (orderId: string): void => {
    const order = activeSheet.orders.find((o: any) => o.id === orderId)
    if (!order?.groupId) return

    updateSheet((s) => ({
      ...s,
      orders: s.orders.map((o: any) =>
        o.id === orderId ? { ...o, groupId: null } : o,
      ),
      groups: s.groups.map((g: any) =>
        g.id === order.groupId
          ? { ...g, orderIds: g.orderIds.filter((id: any) => id !== orderId) }
          : g,
      ),
    }))
  }

  const removeGroup = (groupId: string): void => {
    updateSheet((s) => ({
      ...s,
      orders: s.orders.map((o: any) =>
        o.groupId === groupId ? { ...o, groupId: null } : o,
      ),
      groups: s.groups.filter((g: any) => g.id !== groupId),
    }))
    if (activeGroupId === groupId) setActiveGroupId(null)
    toast.success("Группа расформирована")
  }

  const removeOrder = (orderId: string): void =>
    updateSheet((s) => ({
      ...s,
      orders: s.orders.filter((o: any) => o.id !== orderId),
      connections: s.connections.filter((c: any) => c.from !== orderId && c.to !== orderId,
      ),
      groups: s.groups.map((g: any) => ({
        ...g,
        orderIds: g.orderIds.filter((id: any) => id !== orderId),
      })),
      notes: s.notes.map((n: any) =>
        n.orderId === orderId ? { ...n, orderId: null } : n,
      ),
    }))

  const setOrderRoutePosition = (orderId: string, position: number): void => {
    if (position === 0) {
      updateSheet((s) => {
        const order = s.orders.find((o: any) => o.id === orderId)
        if (!order || order.inRouteOrder == null) return s

        const currentOrderPos = order.inRouteOrder

        return {
          ...s,
          orders: s.orders.map((o: any) => {
            if (o.id === orderId) {
              return { ...o, inRouteOrder: null, status: "new" as const }
            }
            if (o.inRouteOrder != null && o.inRouteOrder > currentOrderPos) {
              return { ...o, inRouteOrder: o.inRouteOrder - 1 }
            }
            return o
          }),
        }
      })
    } else {
      updateSheet((s) => {
        let updatedOrders = s.orders.map((o: any) =>
          o.id === orderId ? { ...o, inRouteOrder: null } : o,
        )
        updatedOrders = updatedOrders.map((o: any) =>
          o.inRouteOrder != null && o.inRouteOrder >= position
            ? { ...o, inRouteOrder: o.inRouteOrder + 1 }
            : o,
        )
        updatedOrders = updatedOrders.map((o: any) =>
          o.id === orderId
            ? { ...o, inRouteOrder: position, status: "in_route" as const }
            : o,
        )
        return { ...s, orders: updatedOrders }
      })
    }
  }

  const toggleOrderInRoute = (orderId: string): void => {
    updateSheet((s) => {
      const order = s.orders.find((o: any) => o.id === orderId)
      if (!order) return s

      if (order.inRouteOrder != null) {
        const currentOrderPos = order.inRouteOrder
        return {
          ...s,
          orders: s.orders.map((o: any) => {
            if (o.id === orderId) {
              return { ...o, inRouteOrder: null, status: "new" as const }
            }
            if (o.inRouteOrder != null && o.inRouteOrder > currentOrderPos) {
              return { ...o, inRouteOrder: o.inRouteOrder - 1 }
            }
            return o
          }),
        }
      }

      const maxOrder = Math.max(0, ...s.orders.map((o: any) => o.inRouteOrder || 0))
      return {
        ...s,
        orders: s.orders.map((o: any) =>
          o.id === orderId
            ? {
                ...o,
                inRouteOrder: maxOrder + 1,
                status: "in_route" as const,
              }
            : o,
        ),
      }
    })
  }

  const saveOrderEdit = (updatedOrder: OrderItem): void => {
    updateSheet((s) => ({
      ...s,
      orders: s.orders.map((o: any) => (o.id === updatedOrder.id ? updatedOrder : o)),
    }))
    setSelectedOrderForEdit(null)
  }

  const addNote = (): void => {
    if (!newNoteText.trim()) return
    updateSheet((s) => ({
      ...s,
      notes: [
        ...s.notes,
        {
          id: `note-${Date.now()}`,
          text: newNoteText,
          x: 400 + Math.random() * 100,
          y: 200 + Math.random() * 100,
          color: newNoteColor,
          orderId: null,
        },
      ],
    }))
    setNewNoteText("")
    setShowAddNoteDialog(false)
  }

  const updateNoteText = (noteId: string, text: string): void =>
    updateSheet((s) => ({
      ...s,
      notes: s.notes.map((n: any) => (n.id === noteId ? { ...n, text } : n)),
    }))

  const removeNote = (noteId: string): void =>
    updateSheet((s) => ({
      ...s,
      notes: s.notes.filter((n: any) => n.id !== noteId),
    }))

  const clearCanvas = (): void => {
    if (window.confirm("Очистить лист?")) {
      updateSheet((s) => ({
        ...s,
        orders: [],
        notes: [],
        connections: [],
        groups: [],
      }))
    }
  }

  const renderConnections = (): React.ReactNode => {
    return activeSheet.connections.map((conn: any) => {
      const from = activeSheet.orders.find((o: any) => o.id === conn.from)
      const to = activeSheet.orders.find((o: any) => o.id === conn.to)
      if (!from || !to) return null

      const x1 = from.x + CARD_WIDTH / 2
      const y1 = from.y + 80
      const x2 = to.x + CARD_WIDTH / 2
      const y2 = to.y + 80
      const midX = (x1 + x2) / 2
      const midY = (y1 + y2) / 2

      const path = `M ${x1} ${y1} Q ${midX} ${y1}, ${midX} ${midY} T ${x2} ${y2}`

      return (
        <g key={conn.id} className="group/conn">
          <path
            d={path}
            fill="none"
            stroke="rgba(15,23,42,0.9)"
            strokeWidth={6}
            strokeLinecap="round"
          />

          <path
            d={path}
            fill="none"
            stroke="#fb923c"
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray="8 6"
            markerEnd="url(#arrowhead)"
          >
            <animate
              attributeName="stroke-dashoffset"
              from="0"
              to="-28"
              dur="1s"
              repeatCount="indefinite"
            />
          </path>

          <g>
            <g transform="translate(-12, -12) scale(0.8)">
              <rect x="1" y="3" width="15" height="13" rx="2" fill="#fb923c" />
              <path d="M16 8h4l3 3v5h-7V8z" fill="#fb923c" />
              <circle cx="5.5" cy="16" r="2.5" fill="#ea580c" />
              <circle cx="18.5" cy="16" r="2.5" fill="#ea580c" />
              <path
                d="M17 9h2.5l1.5 1.5V12h-4V9z"
                fill="rgba(255,255,255,0.4)"
              />
            </g>

            <animateMotion
              dur="3s"
              repeatCount="indefinite"
              path={path}
              rotate="auto"
              keyPoints="0;1"
              keyTimes="0;1"
              calcMode="linear"
            />
          </g>

          <g
            className="opacity-0 group-hover/conn:opacity-100 cursor-pointer"
            onClick={() => removeConnection(conn.id)}
          >
            <circle cx={midX} cy={midY} r="10" fill="#ef4444" />
            <path
              d={`M ${midX - 4} ${midY - 4} L ${midX + 4} ${midY + 4} M ${
                midX + 4
              } ${midY - 4} L ${midX - 4} ${midY + 4}`}
              stroke="white"
              strokeWidth="2"
            />
          </g>
        </g>
      )
    })
  }

  const routeOrders = activeSheet.orders
    .filter((o: any) => o.inRouteOrder)
    .sort((a, b) => (a.inRouteOrder ?? 0) - (b.inRouteOrder ?? 0))

  const routeCalculation = useMemo(() => {
    let totalPrice = 0
    let totalWeight = 0
    let effectiveDistance = 0

    const processedGroups = new Set<string>()

    routeOrders.forEach((order: any) => {
      totalPrice += order.price
      totalWeight += order.weight

      if (order.groupId) {
        if (!processedGroups.has(order.groupId)) {
          const groupOrders = routeOrders.filter((o: any) => o.groupId === order.groupId)
          const maxDistance = Math.max(...groupOrders.map((o: any) => o.distance))
          effectiveDistance += maxDistance
          processedGroups.add(order.groupId)
        }
      } else {
        effectiveDistance += order.distance
      }
    })

    const pricePerKm =
      effectiveDistance > 0 ? Math.round(totalPrice / effectiveDistance) : 0
    const naiveDistance = routeOrders.reduce((sum: any, o: any) => sum + o.distance, 0)
    const savedDistance = naiveDistance - effectiveDistance

    return {
      totalPrice,
      totalWeight,
      effectiveDistance,
      naiveDistance,
      savedDistance,
      pricePerKm,
      hasGroups: processedGroups.size > 0,
    }
  }, [routeOrders])

  useEffect(() => {
    // если маршрут не собран — сбрасываем ETA
    if (
      routeCalculation.effectiveDistance <= 0 ||
      routeCalculation.totalWeight <= 0
    ) {
      setEtaPreview(null)
      return
    }

    try {
      const distanceKm = routeCalculation.effectiveDistance
      const totalWeightKg = routeCalculation.totalWeight
      const baseSpeedKmH = 60 // базовая скорость для песочницы

      const durationBaseSec = (distanceKm / baseSpeedKmH) * 3600

      const etaRequest: ETARequest = {
        origin: { lat: 0, lng: 0 },
        destination: { lat: 0, lng: 0 },
        departureTime: new Date(),
        cargo: {
          weight: totalWeightKg / 1000, // тонны
          type: "standard",
        },
        vehicle: {
          type: "truck",
        },
        useCache: false,
      }

      const coeffs = calculateAllCoefficients(etaRequest, distanceKm)
      const durationWithTrafficSec = Math.round(durationBaseSec * coeffs.total)
      const risk = calculateRiskFactors(coeffs, etaRequest, distanceKm)
      const cost = calculateRouteCost(distanceKm, etaRequest.vehicle)

      setEtaPreview({
        durationBaseSec: Math.round(durationBaseSec),
        durationWithTrafficSec,
        riskLevel: risk.level,
        delayProbability: risk.delayProbability,
        fuelCost: cost.fuel,
        tollsCost: cost.tolls,
        totalCost: cost.total,
      })
    } catch (e) {
      console.error("[Sandbox ETA] calculation error", e)
      setEtaPreview(null)
    }
  }, [routeCalculation.effectiveDistance, routeCalculation.totalWeight])

  // ==================== Автопредложения (rules-based, MVP) ====================
  const availableCapacityKg =
    capacityHint?.capacityKg != null
      ? Math.max(0, capacityHint.capacityKg - routeCalculation.totalWeight)
      : null

  const autoProposals = useMemo<AutoProposal[]>(() => {
    const proposals: AutoProposal[] = []

    const routeCities = new Set<string>()
    routeOrders.forEach((o: any) => {
      routeCities.add(normalizeCity(o.routeFrom))
      routeCities.add(normalizeCity(o.routeTo))
    })

    // 1) vehicle_match
    if (routeOrders.length > 0) {
      if (capacityHint) {
        proposals.push({
          id: "vehicle_match:capacity",
          type: "vehicle_match",
          status: "open",
          title: "Ёмкость под текущий маршрут",
          subtitle: `${capacityHint.vehicleLabel} • свободно ${((availableCapacityKg ?? 0) / 1000).toFixed(1)}т`,
          reasons: [
            "Подбор сделан по доступным машинам (минимальная подходящая).",
            "Можно искать догруз под свободную ёмкость.",
          ],
          score: 90,
        })
      } else {
        proposals.push({
          id: "vehicle_match:need_capacity",
          type: "vehicle_match",
          status: "open",
          title: "Рассчитать свободную ёмкость",
          subtitle:
            "Чтобы точнее предлагать догрузы, подберём подходящую машину из автопарка.",
          reasons: [
            "Без ёмкости догрузы считаются приблизительно.",
            "Кнопка использует /api/fleet и ничего не сохраняет.",
          ],
          score: 60,
        })
      }
    }

    // 2) docs_missing / profit_boost — по заказам на холсте
    const canvasOrders = activeSheet.orders
    for (const o of canvasOrders) {
      if (!o.clientPhone) {
        proposals.push({
          id: `docs_missing:${o.id}:phone`,
          type: "docs_missing",
          status: "open",
          title: "Не указан телефон клиента",
          subtitle: `${o.routeFrom?.split(",")[0]} → ${o.routeTo?.split(",")[0]}`,
          reasons: ["Без контакта сложнее подтверждать/закрывать документы."],
          existingOrderId: o.id,
          score: 55,
        })
      }
      if ((o.price ?? 0) === 0) {
        proposals.push({
          id: `profit_boost:${o.id}:price_unknown`,
          type: "profit_boost",
          status: "open",
          title: "Ставка “договорная” — уточнить",
          subtitle: `${o.routeFrom?.split(",")[0]} → ${o.routeTo?.split(",")[0]} • ${o.distance} км`,
          reasons: [
            "Без ставки рентабельность маршрута считается заниженно.",
            "Уточните цену — это влияет на приоритеты.",
          ],
          existingOrderId: o.id,
          score: 50,
        })
      } else if ((o.pricePerKm ?? 0) > 0 && (o.pricePerKm ?? 0) < 30) {
        proposals.push({
          id: `profit_boost:${o.id}:low_ppk`,
          type: "profit_boost",
          status: "open",
          title: "Низкая цена за км",
          subtitle: `${o.pricePerKm} ₽/км • ${o.routeFrom?.split(",")[0]} → ${o.routeTo?.split(",")[0]}`,
          reasons: ["Проверьте возможность поднять ставку или подобрать догруз/сборку."],
          existingOrderId: o.id,
          score: 45,
        })
      }
    }

    // 3) bundle — сгруппировать похожие направления на холсте
    const byCorridor = new Map<string, OrderItem[]>()
    for (const o of canvasOrders) {
      const from = normalizeCity(o.routeFrom)
      const to = normalizeCity(o.routeTo)
      if (!from || !to) continue
      const key = `${from}→${to}`
      const arr = byCorridor.get(key) ?? []
      arr.push(o)
      byCorridor.set(key, arr)
    }

    for (const [key, list] of byCorridor.entries()) {
      const ungrouped = list.filter((o: any) => !o.groupId)
      if (ungrouped.length < 2) continue

      const totalWeight = ungrouped.reduce((s: any, o: any) => s + o.weight, 0)
      const totalPrice = ungrouped.reduce((s: any, o: any) => s + o.price, 0)

      proposals.push({
        id: `bundle:${key}`,
        type: "bundle",
        status: "open",
        title: `Собрать группу: ${key}`,
        subtitle: `${ungrouped.length} груз(а) • ${(totalWeight / 1000).toFixed(1)}т • ${totalPrice.toLocaleString()} ₽`,
        reasons: [
          "Группа поможет оценить экономику сборного рейса (дистанция берётся по максимуму).",
        ],
        orderIds: ungrouped.map((o: any) => o.id),
        score: 65,
      })
    }

    // 4) dogruz — кандидаты из ATI под текущий маршрут
    if (routeOrders.length > 0) {
      const candidates = atiOrders
        .filter((a: any) => !usedAtiIds.has(a.id))
        .map((a: any) => {
          const fromCity = normalizeCity(a.from)
          const toCity = normalizeCity(a.to)

          const pricePerKm = a.distance > 0 && a.price > 0 ? Math.round(a.price / a.distance) : 0

          let score = 0
          const reasons: string[] = []

          if (fromCity && routeCities.has(fromCity)) {
            score += 4
            reasons.push("Погрузка на вашем коридоре")
          }
          if (toCity && routeCities.has(toCity)) {
            score += 4
            reasons.push("Выгрузка на вашем коридоре")
          }

          if (pricePerKm > 0) {
            if (pricePerKm >= Math.max(30, routeCalculation.pricePerKm)) {
              score += 2
              reasons.push(`Экономика: ${pricePerKm} ₽/км`)
            } else if (pricePerKm < 25) {
              score -= 1
              reasons.push(`Ниже среднего: ${pricePerKm} ₽/км`)
            }
          }

          if (availableCapacityKg != null) {
            if (a.weight <= availableCapacityKg) {
              score += 3
              reasons.push(
                `Влезает по ёмкости (≈ ${(availableCapacityKg / 1000).toFixed(1)}т свободно)`,
              )
            } else {
              score -= 6
              reasons.push("Похоже, не влезает по ёмкости")
            }
          } else {
            reasons.push("Проверьте грузоподъёмность при назначении ТС")
          }

          if (a.loadingDate) {
            reasons.push(
              `Дата погрузки: ${new Date(a.loadingDate).toLocaleDateString("ru-RU")}`,
            )
          }

          return { a, score, reasons, pricePerKm }
        })
        .sort((x, y) => y.score - x.score)
        .slice(0, 10)

      for (const c of candidates) {
        proposals.push({
          id: `dogruz:${c.a.id}`,
          type: "dogruz",
          status: "open",
          title: `${c.a.from?.split(",")[0]} → ${c.a.to?.split(",")[0]}`,
          subtitle: `${c.a.cargo} • ${(c.a.weight / 1000).toFixed(1)}т • ${c.a.distance} км • ${
            c.a.price > 0 ? `${c.a.price.toLocaleString()} ₽` : "Договорная"
          }${c.pricePerKm ? ` • ${c.pricePerKm} ₽/км` : ""}`,
          reasons: c.reasons.slice(0, 4),
          atiOrderId: c.a.id,
          score: c.score,
        })
      }
    }

    // статусы: sent/hidden/snoozed
    const now = Date.now()
    return proposals.map((p: any) => {
      if (sentProposalIds.has(p.id)) return { ...p, status: "sent" as const }
      if (hiddenProposalIds.has(p.id)) return { ...p, status: "hidden" as const }
      const until = snoozedUntilById[p.id]
      if (until && until > now) return { ...p, status: "snoozed" as const }
      return p
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    atiOrders,
    usedAtiIds,
    routeOrders,
    routeCalculation.totalWeight,
    routeCalculation.pricePerKm,
    capacityHint,
    availableCapacityKg,
    activeSheet.orders,
    hiddenProposalIds,
    sentProposalIds,
    snoozedUntilById,
    timeTick,
  ])

  const openProposals = autoProposals.filter((p: any) => p.status === "open")

  // ==================== ОФОРМЛЕНИЕ РЕЙСА: ПОДБОР МАШИНЫ ====================
  const handleAssembleRoute = async (): Promise<void> => {
    if (routeOrders.length === 0) return
    setShowVehicleDialog(true)
    setLoadingVehicles(true)

    try {
      const res = await fetch("/api/fleet")
      const data = await res.json()

      if (!data.success) {
        throw new Error(data.error || "Ошибка загрузки автопарка")
      }

      const vehiclesRaw = Array.isArray(data.vehicles) ? data.vehicles : []

      const vehicles: VehicleWithDriver[] = vehiclesRaw.map((v: any) => ({
        id: v.id,
        plate: v.plate,
        type: v.type,
        brand: v.brand ?? "",
        model: v.model ?? "",
        capacity: v.capacity ?? 0,
        volume: v.volume ?? undefined,
        status: v.status,
        nextAvailableAt: null,
        driver: v.driver
          ? {
              id: v.driver.id,
              name: v.driver.name,
              phone: v.driver.phone,
              status: v.driver.status,
            }
          : undefined,
      }))

      setAvailableVehicles(vehicles)

      const totalWeight = routeCalculation.totalWeight
      const candidates = vehicles.filter((v: any) => v.status === "available" && v.capacity >= totalWeight,
      )

      if (candidates.length > 0) {
        const best = [...candidates].sort((a, b) => a.capacity - b.capacity)[0]
        setSelectedVehicle(best)
      } else {
        setSelectedVehicle(null)
      }
    } catch (e: any) {
      console.error("Failed to load fleet:", e)
      toast.error(e.message || "Ошибка загрузки автопарка")
      setAvailableVehicles([])
      setSelectedVehicle(null)
    } finally {
      setLoadingVehicles(false)
    }
  }

  const confirmRoute = async (): Promise<void> => {
    if (!selectedVehicle) {
      toast.error("Выберите машину")
      return
    }

    const fits = selectedVehicle.capacity >= routeCalculation.totalWeight
    if (!fits) {
      toast.error("Выбранная машина не подходит по грузоподъёмности")
      return
    }

    if (selectedVehicle.status !== "available") {
      toast.error("Машина сейчас занята или на ТО")
      return
    }

    setSavingRoute(true)

    try {
      const res = await fetch("/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleId: selectedVehicle.id,
          driverId: selectedVehicle.driver?.id,
          // заказы, которые уже есть у организации, привязываются к рейсу по id
          orderIds: routeOrders
            .map((o: any) => o.orderId)
            .filter((value: unknown): value is string => typeof value === "string" && !!value),
          // грузы без заказа (например, из живого поиска ATI) создаются на месте
          orders: routeOrders
            .filter((o: any) => !o.orderId)
            .map((o: any) => ({
              atiCacheId: o.atiCacheId,
              routeFrom: o.routeFrom,
              routeTo: o.routeTo,
              distance: o.distance,
              weight: o.weight,
              price: o.price,
              cargo: o.cargo,
              clientCompany: o.clientCompany,
              clientPhone: o.clientPhone,
              groupId: o.groupId,
            })),
          totalPrice: routeCalculation.totalPrice,
          totalDistance: routeCalculation.effectiveDistance,
          totalWeight: routeCalculation.totalWeight,
        }),
      })

      const data = (await res.json()) as {
        success?: boolean
        error?: string
        code?: string
      }

      if (data.success) {
        toast.success(
          `Рейс оформлен! Машина: ${selectedVehicle.plate}${
            selectedVehicle.driver
              ? `, водитель: ${selectedVehicle.driver.name}`
              : ""
          }`,
        )

        updateSheet((s) => ({
          ...s,
          orders: s.orders.filter((o: any) => !o.inRouteOrder),
          groups: s.groups.filter((g: any) => !routeOrders.some((o: any) => o.groupId === g.id)),
        }))

        setShowVehicleDialog(false)
        setSelectedVehicle(null)
        setMode("select")
      } else if (data.code === "orders_not_agreed") {
        toast.error("На холст попадают только согласованные заказы", {
          description: data.error || "Проведите согласование, затем соберите рейс снова",
          duration: 8000,
        })
      } else {
        toast.error(data.error || "Ошибка сохранения рейса")
      }
    } catch {
      toast.error("Ошибка связи с сервером")
    } finally {
      setSavingRoute(false)
    }
  }

  // ==================== РЕНДЕР ====================
  return (
    <TooltipProvider>
      <div className="flex h-[calc(100vh-200px)] min-h-[500px] bg-slate-950 text-white overflow-hidden rounded-xl border border-slate-800 relative select-none w-full">
        {/* Боковая панель ATI */}
        <div className="w-64 flex-shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col">
          <div className="p-4 border-b border-slate-800">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-orange-500" />
                <h3 className="font-semibold">Грузы ATI</h3>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => void loadAtiOrders()}
                disabled={loadingAti}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loadingAti && "animate-spin")} />
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              {loadingAti ? "Загрузка..." : `${atiOrders.length} грузов`}
            </p>
          </div>

          <ScrollArea className="flex-1 px-3 py-3">
            {loadingAti ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
              </div>
            ) : atiOrders.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Нет грузов</p>
                <p className="text-xs mt-1">
                  Возьмите груз в работу на странице{" "}
                  <Link href="/search" className="text-orange-400 hover:underline">
                    «Поиск грузов»
                  </Link>
                </p>
              </div>
            ) : (
              <div className="space-y-2 pr-4">
                {atiOrders.map((order: any) => {
                  const isUsed = usedAtiIds.has(order.id)
                  // на холст берём только согласованные заказы (канон — lib/orders/stages.ts)
                  const canTakeToCanvas = isOrderRouteable(order.status)

                  return (
                    <div
                      key={order.id}
                      className={cn(
                        "relative w-[210px] p-3 rounded-lg border bg-slate-900/70 hover:bg-slate-900 transition-colors group box-border",
                        "border-slate-700 hover:border-orange-400/60",
                        isUsed && "opacity-80 border-slate-700 bg-slate-900",
                      )}
                    >
                      {isUsed && (
                        <div className="absolute left-2 top-1 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/40 text-[10px] text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" />
                          На холсте
                        </div>
                      )}

                      {!isUsed && (
                        <div
                          className={cn(
                            "absolute left-2 top-1 px-1.5 py-0.5 rounded-full border text-[10px]",
                            canTakeToCanvas
                              ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300"
                              : "bg-amber-500/10 border-amber-500/40 text-amber-300",
                          )}
                          title={
                            canTakeToCanvas
                              ? "Заказ согласован — можно брать в рейс"
                              : "Сначала согласование: на холст попадают только согласованные заказы"
                          }
                        >
                          {order.statusLabel || orderStatusLabel(order.status)}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => void removeFromAtiList(order.id)}
                        className="absolute top-1 right-1 p-1 rounded hover:bg-red-500/20 opacity-0 group-hover:opacity-100"
                        title="Вернуть в базу"
                      >
                        <X className="h-3 w-3 text-red-400" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setNegotiationOrderId(order.orderId ?? order.id)}
                        className="absolute top-1 right-7 p-1 rounded hover:bg-orange-500/20 opacity-0 group-hover:opacity-100"
                        title="Согласование: переговоры, торг, лента"
                      >
                        <MessagesSquare className="h-3 w-3 text-orange-300" />
                      </button>

                      <div
                        className="cursor-pointer mt-3"
                        onClick={() => {
                          if (isUsed) {
                            const existing = activeSheet.orders.find(
                              (o: any) => o.orderId === order.id || o.atiCacheId === order.id,
                            )
                            if (existing) {
                              setHighlightOrderId(existing.id)
                              window.setTimeout(() => setHighlightOrderId(null), 2500)
                            }
                            toast.message("Этот груз уже на холсте")
                            return
                          }
                          if (!canTakeToCanvas) {
                            toast.message("Заказ ещё не согласован", {
                              description:
                                "Откройте карточку заказа и проведите согласование — тогда его можно взять в рейс",
                              duration: 6000,
                            })
                            return
                          }
                          addOrderFromAti(order)
                        }}
                      >
                        <div className="flex items-center gap-1.5 mb-1.5 pr-4">
                          <Building2 className="h-3 w-3 text-slate-400" />
                          <span className="text-xs text-slate-300 font-medium truncate">
                            {order.company}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-sm font-medium mb-1.5">
                          <span className="truncate max-w-[80px]">
                            {order.from?.split(",")[0]}
                          </span>
                          <ArrowRight className="h-3 w-3 text-slate-500" />
                          <span className="truncate max-w-[80px] text-right">
                            {order.to?.split(",")[0]}
                          </span>
                        </div>
                        {order.phone && (
                          <div className="flex items-center gap-1 text-[10px] text-emerald-400 mb-1.5">
                            <Phone className="h-3 w-3" />
                            <span className="font-mono truncate">{order.phone}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-400 truncate max-w-[120px]">
                            {order.cargo} • {(order.weight / 1000).toFixed(1)}т
                          </span>
                          <Badge
                            variant="outline"
                            className="text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                          >
                            {order.price > 0 ? `${(order.price / 1000).toFixed(0)}к` : "Договорная"}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Главная область */}
        <div className="flex-1 flex flex-col relative min-w-0">
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40">
            <div className="bg-slate-900/95 backdrop-blur-sm border border-slate-700 rounded-xl shadow-2xl p-1.5 flex items-center gap-1">
              <div className="flex bg-slate-950 rounded-lg p-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => {
                        setMode("select")
                        setConnectingFrom(null)
                        setActiveGroupId(null)
                      }}
                      className={cn(
                        "px-3 py-1.5 rounded-md flex items-center gap-1.5 text-sm",
                        mode === "select"
                          ? "bg-blue-600 text-white"
                          : "text-slate-400 hover:text-white",
                      )}
                    >
                      <MousePointer2 className="h-4 w-4" />
                      Выбор
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Перемещение</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => {
                        setMode("connect")
                        setActiveGroupId(null)
                      }}
                      className={cn(
                        "px-3 py-1.5 rounded-md flex items-center gap-1.5 text-sm",
                        mode === "connect"
                          ? "bg-blue-600 text-white"
                          : "text-slate-400 hover:text-white",
                      )}
                    >
                      <Link2 className="h-4 w-4" />
                      Связь
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Соединить стрелкой</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => {
                        setMode("group")
                        setShowCreateGroupDialog(true)
                      }}
                      className={cn(
                        "px-3 py-1.5 rounded-md flex items-center gap-1.5 text-sm",
                        mode === "group"
                          ? "bg-purple-600 text-white"
                          : "text-slate-400 hover:text-white",
                      )}
                    >
                      <Layers className="h-4 w-4" />
                      Группа
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Объединить грузы в сборный рейс</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => {
                        setMode("route")
                        setActiveGroupId(null)
                      }}
                      className={cn(
                        "px-3 py-1.5 rounded-md flex items-center gap-1.5 text-sm",
                        mode === "route"
                          ? "bg-orange-600 text-white"
                          : "text-slate-400 hover:text-white",
                      )}
                    >
                      <Route className="h-4 w-4" />
                      Маршрут
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Собрать маршрут</TooltipContent>
                </Tooltip>
              </div>
              <Separator orientation="vertical" className="h-6 bg-slate-700 mx-1" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-slate-400 hover:text-yellow-400"
                    onClick={() => setShowAddNoteDialog(true)}
                  >
                    <StickyNote className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Заметка</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-red-400 hover:text-red-300"
                    onClick={clearCanvas}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Очистить лист</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {mode === "connect" && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30">
              <div className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2 animate-pulse">
                <Info className="h-4 w-4" />
                {connectingFrom ? "Кликните на вторую карточку" : "Кликните на первую карточку"}
              </div>
            </div>
          )}
          {mode === "route" && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30">
              <div className="bg-orange-600 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2">
                <Truck className="h-4 w-4" />
                Кликайте по карточкам для добавления в маршрут
              </div>
            </div>
          )}
          {mode === "group" && activeGroupId && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30">
              <div className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2">
                <Layers className="h-4 w-4" />
                Кликайте на карточки для добавления в группу
                <button
                  type="button"
                  onClick={() => {
                    setMode("select")
                    setActiveGroupId(null)
                  }}
                  className="ml-2 px-2 py-0.5 bg-white/20 rounded text-xs"
                >
                  Готово
                </button>
              </div>
            </div>
          )}

          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div
              ref={canvasRef}
              className={cn(
                "flex-1 relative overflow-hidden",
                mode === "route" && "bg-slate-950",
                mode === "connect" && "bg-blue-950/20",
                mode === "group" && "bg-purple-950/20",
              )}
              style={{
                backgroundImage: "radial-gradient(circle, #334155 1px, transparent 1px)",
                backgroundSize: "24px 24px",
              }}
              onClick={() => {
                if (mode === "connect" && connectingFrom) setConnectingFrom(null)
              }}
            >
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none"
                style={{ zIndex: 5 }}
              >
                <defs>
                  <marker
                    id="arrowhead"
                    markerWidth="10"
                    markerHeight="7"
                    refX="9"
                    refY="3.5"
                    orient="auto"
                  >
                    <polygon points="0 0, 10 3.5, 0 7" fill="#fb923c" />
                  </marker>
                </defs>
                <g style={{ pointerEvents: "all" }}>{renderConnections()}</g>
              </svg>

              {activeSheet.groups.map((group: any) => {
                const groupOrders = activeSheet.orders.filter((o: any) => o.groupId === group.id)
                return (
                  <GroupContainer
                    key={group.id}
                    group={group}
                    orders={groupOrders}
                    onRemoveGroup={() => removeGroup(group.id)}
                  />
                )
              })}

              {activeSheet.orders.map((order: any) => (
                <DraggableOrderCard
                  key={order.id}
                  order={order}
                  mode={mode}
                  isConnecting={!!connectingFrom}
                  isConnectionStart={connectingFrom === order.id}
                  isHighlighted={highlightOrderId === order.id}
                  allOrders={activeSheet.orders}
                  group={activeSheet.groups.find((g: any) => g.id === order.groupId)}
                  attachedNotes={attachedNotesByOrderId.get(order.id) ?? []}
                  onDoubleClick={() => setSelectedOrderForEdit(order)}
                  onConnectStart={() => handleConnectStart(order.id)}
                  onConnectEnd={() => handleConnectEnd(order.id)}
                  onRemove={() => removeOrder(order.id)}
                  onRouteToggle={() => toggleOrderInRoute(order.id)}
                  onSetRoutePosition={(pos) => setOrderRoutePosition(order.id, pos)}
                  onSendDocuments={() => setSelectedOrderForDocs(order)}
                  onAddToGroup={() => addOrderToGroup(order.id)}
                  onRemoveFromGroup={() => removeOrderFromGroup(order.id)}
                  onRemoveAttachedNote={(noteId) => removeNote(noteId)}
                />
              ))}

              {activeSheet.notes
                .filter((note: any) => !note.orderId)
                .map((note: any) => (
                  <DraggableNote
                    key={note.id}
                    note={note}
                    mode={mode}
                    onEdit={(text) => updateNoteText(note.id, text)}
                    onRemove={() => removeNote(note.id)}
                  />
                ))}

              {activeSheet.orders.length === 0 && activeSheet.notes.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center text-slate-600">
                    <Package className="h-16 w-16 mx-auto mb-4 opacity-20" />
                    <p className="text-lg mb-2">Холст пуст</p>
                    <p className="text-sm">Добавьте заказы из панели ATI слева</p>
                  </div>
                </div>
              )}
            </div>
          </DndContext>

          {mode === "route" && routeOrders.length > 0 && (
            <div className="h-64 bg-slate-900 border-t border-slate-700 flex flex-shrink-0 z-20">
              <div className="flex-1 p-4 overflow-auto">
                <div className="flex items-center gap-2 mb-3">
                  <Truck className="h-5 w-5 text-orange-500" />
                  <h3 className="font-semibold">
                    Маршрут ({routeOrders.length} заказов)
                  </h3>
                  {routeCalculation.hasGroups && (
                    <Badge
                      variant="outline"
                      className="text-purple-400 border-purple-500/30"
                    >
                      <Layers className="h-3 w-3 mr-1" />
                      С группами
                    </Badge>
                  )}
                </div>
                <div className="space-y-2">
                  {routeOrders.map((order: any, idx: any) => {
                    const group = activeSheet.groups.find((g: any) => g.id === order.groupId)
                    const groupColor = group
                      ? GROUP_COLORS.find((c: any) => c.id === group.color)
                      : null

                    return (
                      <div
                        key={order.id}
                        className={cn(
                          "flex items-center gap-3 p-2 bg-slate-800 rounded-lg border",
                          groupColor ? groupColor.border : "border-slate-700",
                        )}
                      >
                        <div className="w-6 h-6 rounded-full bg-orange-500 text-white text-sm font-bold flex items-center justify-center">
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400 truncate">
                              {order.clientCompany || "Заказ"}
                            </span>
                            {group && (
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px] px-1",
                                  groupColor?.text,
                                  groupColor?.border,
                                )}
                              >
                                <Layers className="h-2.5 w-2.5 mr-0.5" />
                                {group.name}
                              </Badge>
                            )}
                          </div>
                          <span className="text-sm">
                            {order.routeFrom?.split(",")[0]} →{" "}
                            {order.routeTo?.split(",")[0]}
                          </span>
                        </div>
                        <span className="text-xs text-slate-500">
                          {order.distance} км
                        </span>
                        <span className="text-emerald-400 font-medium">
                          {order.price > 0
                            ? `${order.price.toLocaleString()}₽`
                            : "Договорная"}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleOrderInRoute(order.id)}
                          className="p-1 hover:bg-red-500/20 rounded"
                        >
                          <X className="h-4 w-4 text-slate-400 hover:text-red-400" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="w-72 p-4 border-l border-slate-700 flex flex-col">
                <div className="space-y-2 flex-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Дистанция</span>
                    <div className="text-right">
                      <span className="font-medium">
                        {routeCalculation.effectiveDistance.toLocaleString()} км
                      </span>
                      {routeCalculation.savedDistance > 0 && (
                        <div className="text-[10px] text-green-400">
                          экономия {routeCalculation.savedDistance} км (группы)
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Вес</span>
                    <span>
                      {(routeCalculation.totalWeight / 1000).toFixed(1)} т
                    </span>
                  </div>

                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Ставка</span>
                    <Badge
                      variant={
                        routeCalculation.pricePerKm >= 45
                          ? "default"
                          : routeCalculation.pricePerKm >= 30
                            ? "secondary"
                            : "destructive"
                      }
                    >
                      {routeCalculation.pricePerKm} ₽/км
                    </Badge>
                  </div>

                  <Separator className="bg-slate-700" />

                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Итого:</span>
                    <span className="text-2xl font-bold text-orange-500">
                      {routeCalculation.totalPrice.toLocaleString()} ₽
                    </span>
                  </div>

                  {etaPreview && (
                    <>
                      <Separator className="bg-slate-700" />

                      <div className="space-y-2 text-xs mt-1">
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            Прогноз ETA
                          </span>
                          <div className="text-right">
                            <div className="text-sm font-medium text-slate-100">
                              {formatEtaDuration(etaPreview.durationWithTrafficSec)}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              план: {formatEtaDuration(etaPreview.durationBaseSec)}
                            </div>
                          </div>
                        </div>

                        <div className="flex justify-between items-start">
                          <span className="text-slate-400">Прогноз расходов</span>
                          <div className="text-right text-[11px] text-slate-300">
                            <div>Топливо: {etaPreview.fuelCost.toLocaleString()} ₽</div>
                            <div>Платные: {etaPreview.tollsCost.toLocaleString()} ₽</div>
                            <div className="font-medium">
                              Итого: {etaPreview.totalCost.toLocaleString()} ₽
                            </div>
                          </div>
                        </div>

                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">Риск опоздания</span>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[11px]",
                              etaPreview.riskLevel === "low" &&
                                "text-emerald-400 border-emerald-500/50",
                              etaPreview.riskLevel === "medium" &&
                                "text-amber-300 border-amber-400/50",
                              etaPreview.riskLevel === "high" &&
                                "text-red-300 border-red-500/60",
                              etaPreview.riskLevel === "critical" &&
                                "bg-red-600/80 border-red-500 text-white",
                            )}
                          >
                            {etaPreview.riskLevel === "low" && "Низкий"}
                            {etaPreview.riskLevel === "medium" && "Средний"}
                            {etaPreview.riskLevel === "high" && "Высокий"}
                            {etaPreview.riskLevel === "critical" && "Критический"}
                            <span className="ml-1 opacity-80">
                              {Math.round(etaPreview.delayProbability)}%
                            </span>
                          </Badge>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <Button
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => void handleAssembleRoute()}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Оформить рейс
                </Button>
              </div>
            </div>
          )}

          <div className="h-10 bg-slate-950 border-t border-slate-800 flex items-end px-4 gap-1 flex-shrink-0">
            {sheets.map((sheet: any) => (
              <button
                key={sheet.id}
                type="button"
                onClick={() => setActiveSheetId(sheet.id)}
                className={cn(
                  "px-4 py-2 text-xs font-medium rounded-t-lg border-t border-x",
                  activeSheetId === sheet.id
                    ? "bg-slate-950 text-white border-slate-700"
                    : "bg-slate-900 text-slate-500 border-transparent hover:text-slate-300",
                )}
              >
                {sheet.name}
              </button>
            ))}
          </div>
        </div>

        {/* Панель Автопредложений (справа) */}
        <div
          className={cn(
            "flex-shrink-0 bg-slate-900 border-l border-slate-800 flex flex-col transition-all duration-200",
            autoPanelCollapsed ? "w-12" : "w-80",
          )}
        >
          <div className="p-4 border-b border-slate-800 flex items-start justify-between gap-2">
            <button
              type="button"
              className={cn(
                "flex items-center gap-2 min-w-0",
                autoPanelCollapsed && "flex-col items-center gap-1 w-full",
              )}
              onClick={() => setAutoPanelCollapsed(false)}
              title={autoPanelCollapsed ? "Открыть автопредложения" : undefined}
            >
              <div className="h-8 w-8 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-slate-200" />
              </div>
              {!autoPanelCollapsed && (
                <div className="min-w-0">
                  <div className="font-semibold text-white">Автопредложения</div>
                  <div className="text-xs text-slate-500">
                    {openProposals.length} активных • рынок идей
                  </div>
                </div>
              )}
              {autoPanelCollapsed && (
                <div className="text-[10px] text-slate-400">{openProposals.length}</div>
              )}
            </button>

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-400"
              onClick={() => setAutoPanelCollapsed((v) => !v)}
              title={autoPanelCollapsed ? "Развернуть" : "Свернуть"}
            >
              {autoPanelCollapsed ? (
                <ChevronLeft className="h-4 w-4 rotate-180" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </div>

          {!autoPanelCollapsed && (
            <>
              <div className="px-4 pt-3">
                <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-slate-400">
                      Свободная ёмкость
                      <div className="text-sm text-white font-medium mt-0.5">
                        {routeOrders.length === 0
                          ? "Маршрут не собран"
                          : capacityHint
                            ? `${((availableCapacityKg ?? 0) / 1000).toFixed(1)} т`
                            : "не рассчитана"}
                      </div>
                      {capacityHint && (
                        <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                          {capacityHint.vehicleLabel}
                        </div>
                      )}
                    </div>

                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8"
                      onClick={() => void calculateCapacityHintFromFleet()}
                      disabled={loadingCapacityHint || routeOrders.length === 0}
                    >
                      {loadingCapacityHint ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Truck className="h-4 w-4 mr-2" />
                      )}
                      Рассчитать
                    </Button>
                  </div>
                </div>
              </div>

              <ScrollArea className="flex-1 px-3 py-3">
                {openProposals.length === 0 ? (
                  <div className="text-center py-10 text-slate-500">
                    <Sparkles className="h-10 w-10 mx-auto mb-2 opacity-30" />
                    <div className="text-sm">Пока нет предложений</div>
                    <div className="text-xs mt-1">
                      Соберите маршрут или загрузите грузы ATI
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 pr-4">
                    {(
                      [
                        "dogruz",
                        "bundle",
                        "docs_missing",
                        "profit_boost",
                        "vehicle_match",
                        "risk_delay",
                        "reroute",
                      ] as AutoProposalType[]
                    ).map((type: any) => {
                      const items = openProposals.filter((p: any) => p.type === type)
                      if (items.length === 0) return null

                      const collapsed = !!(collapsedProposalTypes as any)[type]
                      const meta = (AUTOPROPOSAL_TYPE_META as any)[type]

                      return (
                        <div
                          key={type}
                          className="rounded-xl border border-slate-800 bg-slate-950/30"
                        >
                          <button
                            type="button"
                            className="w-full px-3 py-2 flex items-center justify-between"
                            onClick={() =>
                              setCollapsedProposalTypes((prev) => ({
                                ...prev,
                                [type]: !(prev as any)[type],
                              }))
                            }
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Badge
                                variant="outline"
                                className={cn("text-[11px]", meta.badgeClass)}
                              >
                                {meta.label}
                              </Badge>
                              <span className="text-xs text-slate-500 truncate">
                                {meta.hint}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-400">
                                {items.length}
                              </span>
                              <ChevronRight
                                className={cn(
                                  "h-4 w-4 text-slate-500 transition-transform",
                                  !collapsed && "rotate-90",
                                )}
                              />
                            </div>
                          </button>

                          {!collapsed && (
                            <div className="px-3 pb-3 space-y-2">
                              {items.map((p: any) => {
                                const canAddFromAti =
                                  p.atiOrderId &&
                                  atiOrders.some((a: any) => a.id === p.atiOrderId)
                                const isAlreadyOnCanvas = p.atiOrderId
                                  ? usedAtiIds.has(p.atiOrderId)
                                  : false

                                return (
                                  <div
                                    key={p.id}
                                    className="p-3 rounded-lg border border-slate-800 bg-slate-900/40"
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="text-sm font-medium text-white truncate">
                                          {p.title}
                                        </div>
                                        {p.subtitle && (
                                          <div className="text-xs text-slate-400 mt-0.5">
                                            {p.subtitle}
                                          </div>
                                        )}
                                      </div>

                                      {p.score != null && (
                                        <Badge
                                          variant="outline"
                                          className="text-[10px] border-slate-700 text-slate-300"
                                        >
                                          {p.score}
                                        </Badge>
                                      )}
                                    </div>

                                    {p.reasons && p.reasons.length > 0 && (
                                      <ul className="mt-2 space-y-1 text-[11px] text-slate-400">
                                        {p.reasons.slice(0, 4).map((r: any, idx: any) => (
                                          <li key={idx} className="flex gap-2">
                                            <span className="mt-[6px] h-1 w-1 rounded-full bg-slate-600 flex-shrink-0" />
                                            <span className="min-w-0">{r}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    )}

                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {p.type === "dogruz" && (
                                        <>
                                          <Button
                                            size="sm"
                                            className="h-8 bg-slate-200 text-slate-950 hover:bg-white"
                                            disabled={!canAddFromAti}
                                            onClick={() => {
                                              const ati = atiOrders.find((a: any) => a.id === p.atiOrderId,
                                              )
                                              if (!ati) return

                                              if (isAlreadyOnCanvas) {
                                                const existing = activeSheet.orders.find((o: any) => o.atiCacheId === ati.id,
                                                )
                                                if (existing) {
                                                  setHighlightOrderId(existing.id)
                                                  window.setTimeout(
                                                    () => setHighlightOrderId(null),
                                                    2500,
                                                  )
                                                }
                                                toast.message("Этот груз уже на холсте")
                                                return
                                              }

                                              addOrderFromAti(ati)
                                              toast.success("Добавлено в холст")
                                            }}
                                          >
                                            В холст
                                          </Button>

                                          <Button
                                            size="sm"
                                            variant="secondary"
                                            className="h-8"
                                            onClick={() => {
                                              markSent(p.id, true)
                                              pushUndo("Отправлено на подтверждение", () =>
                                                markSent(p.id, false),
                                              )
                                              toast.success(
                                                "Отправлено логисту на подтверждение (MVP)",
                                              )
                                            }}
                                          >
                                            <Send className="h-4 w-4 mr-2" />
                                            На подтверждение
                                          </Button>
                                        </>
                                      )}

                                      {p.type === "bundle" &&
                                        p.orderIds &&
                                        p.orderIds.length >= 2 && (
                                          <Button
                                            size="sm"
                                            variant="secondary"
                                            className="h-8"
                                            onClick={() => {
                                              const ids = p.orderIds ?? []
                                              const existingOrders = activeSheet.orders.filter((o: any) =>
                                                ids.includes(o.id),
                                              )
                                              if (existingOrders.length < 2) return

                                              const name = `Bundle: ${
                                                existingOrders[0].routeFrom?.split(",")[0]
                                              } → ${
                                                existingOrders[0].routeTo?.split(",")[0]
                                              } (${existingOrders.length})`

                                              const newGroupId = `group-${Date.now()}`
                                              const newGroup: OrderGroup = {
                                                id: newGroupId,
                                                name,
                                                color: "purple",
                                                orderIds: existingOrders.map((o: any) => o.id),
                                              }

                                              updateSheet((s) => ({
                                                ...s,
                                                groups: [...s.groups, newGroup],
                                                orders: s.orders.map((o: any) =>
                                                  ids.includes(o.id)
                                                    ? { ...o, groupId: newGroupId }
                                                    : o,
                                                ),
                                              }))

                                              toast.success("Группа создана")
                                              setHidden(p.id, true)
                                              pushUndo(
                                                "Группа создана (предложение скрыто)",
                                                () => setHidden(p.id, false),
                                              )
                                            }}
                                          >
                                            <Layers className="h-4 w-4 mr-2" />
                                            Создать группу
                                          </Button>
                                        )}

                                      {(p.type === "docs_missing" ||
                                        p.type === "profit_boost") &&
                                        p.existingOrderId && (
                                          <Button
                                            size="sm"
                                            variant="secondary"
                                            className="h-8"
                                            onClick={() => {
                                              const o = activeSheet.orders.find((x: any) => x.id === p.existingOrderId,
                                              )
                                              if (!o) return
                                              setSelectedOrderForEdit(o)
                                            }}
                                          >
                                            <Eye className="h-4 w-4 mr-2" />
                                            Открыть
                                          </Button>
                                        )}

                                      {p.type === "vehicle_match" &&
                                        p.id === "vehicle_match:need_capacity" && (
                                          <Button
                                            size="sm"
                                            variant="secondary"
                                            className="h-8"
                                            onClick={() =>
                                              void calculateCapacityHintFromFleet()
                                            }
                                            disabled={
                                              loadingCapacityHint ||
                                              routeOrders.length === 0
                                            }
                                          >
                                            <Truck className="h-4 w-4 mr-2" />
                                            Рассчитать ёмкость
                                          </Button>
                                        )}

                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-8 text-slate-400 hover:text-slate-100"
                                        onClick={() => {
                                          snooze(p.id, AUTOPROPOSALS_SNOOZE_MINUTES)
                                          pushUndo(
                                            `Отложено на ${AUTOPROPOSALS_SNOOZE_MINUTES} мин`,
                                            () => unsnooze(p.id),
                                          )
                                          toast.message("Предложение отложено")
                                        }}
                                      >
                                        <Clock className="h-4 w-4 mr-2" />
                                        Отложить
                                      </Button>

                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-8 text-slate-400 hover:text-red-300"
                                        onClick={() => {
                                          setHidden(p.id, true)
                                          pushUndo("Предложение скрыто", () =>
                                            setHidden(p.id, false),
                                          )
                                        }}
                                      >
                                        <X className="h-4 w-4 mr-2" />
                                        Скрыть
                                      </Button>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </ScrollArea>

              {undoBanner && (
                <div className="px-3 pb-3">
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 flex items-center justify-between gap-2">
                    <div className="text-xs text-slate-400 truncate">
                      {undoBanner.label}
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7"
                      onClick={() => {
                        undoBanner.undo()
                        setUndoBanner(null)
                        toast.message("Действие отменено")
                      }}
                    >
                      <Undo2 className="h-4 w-4 mr-2" />
                      Undo
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Модальные окна */}

        <Dialog
          open={!!selectedOrderForEdit}
          onOpenChange={() => setSelectedOrderForEdit(null)}
        >
          <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-3xl max-h-[90vh] overflow-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Edit3 className="h-5 w-5 text-blue-400" />
                Заказ: детальное редактирование
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                Отредактируйте параметры груза, окна погрузки/выгрузки и
                комментарии. Все изменения сохраняются только в песочнице.
              </DialogDescription>
            </DialogHeader>
            {selectedOrderForEdit ? (
              <OrderEditForm
                order={selectedOrderForEdit}
                onSave={saveOrderEdit}
                onCancel={() => setSelectedOrderForEdit(null)}
                onOpenNegotiation={(orderId) => {
                  setSelectedOrderForEdit(null)
                  setNegotiationOrderId(orderId)
                }}
              />
            ) : null}
          </DialogContent>
        </Dialog>

        <SendDocumentsDialog
          order={selectedOrderForDocs}
          onClose={() => setSelectedOrderForDocs(null)}
        />

        <Dialog open={showAddNoteDialog} onOpenChange={setShowAddNoteDialog}>
          <DialogContent className="bg-slate-900 border-slate-700 text-white sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Новая заметка</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Textarea
                value={newNoteText}
                onChange={(e) => setNewNoteText(e.target.value)}
                placeholder="Текст..."
                className="bg-slate-800 border-slate-600"
                rows={4}
              />
              <div className="flex gap-2">
                {(Object.keys(NOTE_COLORS) as NoteItem["color"][]).map((color: any) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setNewNoteColor(color)}
                    className={cn(
                      "w-8 h-8 rounded-lg border-2",
                      (NOTE_COLORS as any)[color].split(" ")[0],
                      newNoteColor === color
                        ? "border-white scale-110"
                        : "border-transparent",
                    )}
                  />
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowAddNoteDialog(false)}>
                Отмена
              </Button>
              <Button onClick={addNote} disabled={!newNoteText.trim()}>
                Добавить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showCreateGroupDialog} onOpenChange={setShowCreateGroupDialog}>
          <DialogContent className="bg-slate-900 border-slate-700 text-white sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-purple-400" />
                Новая группа грузов
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                Объединяйте несколько заказов с похожим направлением в один
                сборный рейс для оценки рентабельности.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label>Название группы</Label>
                <Input
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="Например: Москва → СПб (3 груза)"
                  className="bg-slate-800 border-slate-600 mt-1"
                />
              </div>
              <div>
                <Label>Цвет</Label>
                <div className="flex gap-2 mt-2">
                  {GROUP_COLORS.map((color: any) => (
                    <button
                      key={color.id}
                      type="button"
                      onClick={() => setNewGroupColor(color.id)}
                      className={cn(
                        "w-10 h-10 rounded-lg border-2 flex items-center justify-center",
                        color.bg,
                        newGroupColor === color.id
                          ? "border-white scale-110"
                          : color.border,
                      )}
                    >
                      {newGroupColor === color.id && (
                        <CheckCircle2 className={cn("h-5 w-5", color.text)} />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowCreateGroupDialog(false)}>
                Отмена
              </Button>
              <Button
                onClick={createGroup}
                disabled={!newGroupName.trim()}
                className="bg-purple-600 hover:bg-purple-700"
              >
                Создать
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showVehicleDialog} onOpenChange={setShowVehicleDialog}>
          <DialogContent className="bg-slate-900 border-slate-700 text-white sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Car className="h-5 w-5 text-orange-400" />
                Подбор машины
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                Требуется: {(routeCalculation.totalWeight / 1000).toFixed(1)} т •{" "}
                {routeCalculation.effectiveDistance} км
                {routeCalculation.savedDistance > 0 && (
                  <span className="text-green-400 ml-2">
                    (экономия {routeCalculation.savedDistance} км)
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-4 max-h-80 overflow-auto">
              {loadingVehicles ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : availableVehicles.length === 0 ? (
                <div className="text-center_py-8 text-slate-500">
                  <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-yellow-500" />
                  <p>Нет машин в автопарке</p>
                </div>
              ) : (
                [...availableVehicles]
                  .sort((a, b) => {
                    const aAvail = a.status === "available"
                    const bAvail = b.status === "available"
                    if (aAvail !== bAvail) return aAvail ? -1 : 1

                    const aTime =
                      a.nextAvailableAt &&
                      !Number.isNaN(new Date(a.nextAvailableAt).getTime())
                        ? new Date(a.nextAvailableAt).getTime()
                        : Number.POSITIVE_INFINITY
                    const bTime =
                      b.nextAvailableAt &&
                      !Number.isNaN(new Date(b.nextAvailableAt).getTime())
                        ? new Date(b.nextAvailableAt).getTime()
                        : Number.POSITIVE_INFINITY
                    return aTime - bTime
                  })
                  .map((v: any) => {
                    const fits = v.capacity >= routeCalculation.totalWeight
                    const isAvailable = v.status === "available"
                    const nextAvailable =
                      v.nextAvailableAt &&
                      !Number.isNaN(new Date(v.nextAvailableAt).getTime())
                        ? new Date(v.nextAvailableAt)
                        : null

                    const disabled = !fits || !isAvailable

                    return (
                      <div
                        key={v.id}
                        onClick={() => {
                          if (!disabled) setSelectedVehicle(v)
                        }}
                        className={cn(
                          "p-4 rounded-lg border cursor-pointer transition-all",
                          selectedVehicle?.id === v.id
                            ? "border-emerald-500 bg-emerald-500/10"
                            : "border-slate-700 hover:border-slate-500",
                          disabled && "opacity-50 cursor-not-allowed",
                        )}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Truck className="h-4 w-4" />
                            <span className="font-medium">{v.plate}</span>
                            {selectedVehicle?.id === v.id && (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            )}
                          </div>
                          <Badge variant={fits ? "default" : "destructive"}>
                            {(v.capacity / 1000).toFixed(0)} т
                          </Badge>
                        </div>
                        <div className="text-sm text-slate-400">
                          {v.brand} {v.model} • {v.type}
                        </div>
                        {v.driver ? (
                          <div className="flex items-center gap-2 text-sm mt-1">
                            <div
                              className={cn(
                                "w-2 h-2 rounded-full",
                                v.driver.status === "available"
                                  ? "bg-green-500"
                                  : "bg-yellow-500",
                              )}
                            />
                            <span>{v.driver.name}</span>
                            {v.driver.phone && (
                              <span className="text-slate-500 text-xs">
                                ({v.driver.phone})
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="text-sm text-yellow-500 mt-1">
                            Водитель не назначен
                          </div>
                        )}
                        {!isAvailable && (
                          <div className="text-xs text-yellow-400 mt-1 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {nextAvailable
                              ? `Занята до ${nextAvailable.toLocaleString("ru-RU", {
                                  day: "2-digit",
                                  month: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}`
                              : "Сейчас занята"}
                          </div>
                        )}
                        {!fits && (
                          <div className="text-xs text-red-400 mt-1 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Не влезет
                          </div>
                        )}
                      </div>
                    )
                  })
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowVehicleDialog(false)}>
                Отмена
              </Button>
              <Button
                onClick={() => void confirmRoute()}
                disabled={!selectedVehicle || savingRoute}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {savingRoute ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                Назначить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Быстрые действия по заказу: та же карточка процесса, что и на
            /orders/[id], только в выдвижной панели — контекст песочницы не теряется */}
        {/* Фон панели — обычный для приложения: карточка процесса использует
            темы shadcn, и на тёмном холсте они бы спорили с интерфейсом */}
        <Sheet
          open={negotiationOrderId !== null}
          onOpenChange={(open) => {
            if (!open) setNegotiationOrderId(null)
          }}
        >
          <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
            <SheetHeader className="text-left">
              <SheetTitle>Согласование заказа</SheetTitle>
              <SheetDescription>
                Переговоры, торг по цене и лента записей. Полная карточка — по
                ссылке ниже.
              </SheetDescription>
            </SheetHeader>

            {negotiationOrderId && (
              <div className="mt-4 space-y-3">
                <Button type="button" size="sm" variant="outline" asChild>
                  <Link href={`/orders/${negotiationOrderId}`}>
                    Открыть полную карточку заказа
                  </Link>
                </Button>
                <OrderProcess
                  orderId={negotiationOrderId}
                  compact
                  onChanged={() => void loadAtiOrders()}
                />
              </div>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  )
}

// ==================== ВСПОМОГАТЕЛЬНЫЕ КОМПОНЕНТЫ ====================
function SendDocumentsDialog({
  order,
  onClose,
}: {
  order: OrderItem | null
  onClose: () => void
}) {
  const [selectedDocs, setSelectedDocs] = useState<string[]>(["tn", "contract"])
  const [isSending, setIsSending] = useState(false)

  const handleSend = async (): Promise<void> => {
    setIsSending(true)
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 1000)
    })
    setIsSending(false)
    onClose()
    toast.success(`Документы отправлены (${selectedDocs.length})`)
  }

  return (
    <Dialog open={!!order} onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Отправить документы</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-4">
          {DOCUMENT_TEMPLATES.map((doc: any) => (
            <label
              key={doc.id}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border cursor-pointer",
                selectedDocs.includes(doc.id)
                  ? "bg-blue-500/10 border-blue-500/50"
                  : "border-slate-700",
              )}
            >
              <Checkbox
                checked={selectedDocs.includes(doc.id)}
                onCheckedChange={() =>
                  setSelectedDocs((prev) =>
                    prev.includes(doc.id)
                      ? prev.filter((i: any) => i !== doc.id)
                      : [...prev, doc.id],
                  )
                }
              />
              <div className="flex items-center gap-2">
                {doc.icon}
                <span className="text-sm">{doc.name}</span>
              </div>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            onClick={() => void handleSend()}
            disabled={selectedDocs.length === 0 || isSending}
          >
            {isSending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Отправить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OrderEditForm({
  order,
  onSave,
  onCancel,
  onOpenNegotiation,
}: {
  order: OrderItem
  onSave: (o: OrderItem) => void
  onCancel: () => void
  /** Открыть панель согласования настоящего заказа (если элемент из песочницы). */
  onOpenNegotiation?: (orderId: string) => void
}) {
  const [formData, setFormData] = useState<OrderItem>(order)

  const handleChange = <K extends keyof OrderItem>(
    field: K,
    value: OrderItem[K],
  ): void => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  const parsedDistance = formData.distance || 0
  const parsedPrice = formData.price || 0
  const effectivePricePerKm =
    parsedDistance > 0 ? Math.round(parsedPrice / parsedDistance) : 0

  const displayPrice: number | "" = formData.price === 0 ? "" : formData.price

  return (
    <div className="space-y-6 pb-2">
      {/* Клиент и контакты */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <Label>Организация (клиент)</Label>
          <Input
            value={formData.clientCompany || ""}
            onChange={(e) => handleChange("clientCompany", e.target.value)}
            className="bg-slate-800 border-slate-600 mt-1"
            placeholder="Название компании клиента"
          />
        </div>
        <div>
          <Label>Контактное лицо</Label>
          <Input
            value={formData.clientName || ""}
            onChange={(e) => handleChange("clientName", e.target.value)}
            className="bg-slate-800 border-slate-600 mt-1"
            placeholder="Иван Иванов"
          />
        </div>
        <div>
          <Label>Телефон</Label>
          <Input
            value={formData.clientPhone || ""}
            onChange={(e) => handleChange("clientPhone", e.target.value)}
            className="bg-slate-800 border-slate-600 mt-1"
            placeholder="+7..."
          />
        </div>
      </div>

      {/* Маршрут */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>Откуда</Label>
          <Input
            value={formData.routeFrom}
            onChange={(e) => handleChange("routeFrom", e.target.value)}
            className="bg-slate-800 border-slate-600 mt-1"
            placeholder="Город, склад..."
          />
        </div>
        <div>
          <Label>Куда</Label>
          <Input
            value={formData.routeTo}
            onChange={(e) => handleChange("routeTo", e.target.value)}
            className="bg-slate-800 border-slate-600 mt-1"
            placeholder="Город, склад..."
          />
        </div>
      </div>

      {/* Числовые параметры */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <Label>Дистанция (км)</Label>
          <Input
            type="number"
            value={formData.distance}
            onChange={(e) =>
              handleChange(
                "distance",
                Number.isNaN(parseInt(e.target.value, 10))
                  ? 0
                  : parseInt(e.target.value, 10),
              )
            }
            className="bg-slate-800 border-slate-600 mt-1"
          />
        </div>
        <div>
          <Label>Цена (₽)</Label>
          <Input
            type="number"
            value={displayPrice}
            onChange={(e) => {
              const raw = e.target.value
              if (raw === "") {
                handleChange("price", 0)
                return
              }
              const parsed = parseInt(raw, 10)
              handleChange("price", Number.isNaN(parsed) ? 0 : parsed)
            }}
            className="bg-slate-800 border-slate-600 mt-1"
            placeholder="0 — договорная, введите ставку при необходимости"
          />
          {formData.price === 0 && (
            <p className="mt-1 text-[11px] text-slate-500">
              Сейчас считается договорной. Как только узнаете ставку — введите сумму,
              и она пойдёт в расчёт рентабельности.
            </p>
          )}
        </div>
        <div>
          <Label>Вес (кг)</Label>
          <Input
            type="number"
            value={formData.weight}
            onChange={(e) =>
              handleChange(
                "weight",
                Number.isNaN(parseInt(e.target.value, 10))
                  ? 0
                  : parseInt(e.target.value, 10),
              )
            }
            className="bg-slate-800 border-slate-600 mt-1"
          />
        </div>
        <div>
          <Label>Объём (м³)</Label>
          <Input
            type="number"
            value={formData.volume ?? ""}
            onChange={(e) =>
              handleChange(
                "volume",
                e.target.value === ""
                  ? undefined
                  : Number.isNaN(parseFloat(e.target.value))
                    ? undefined
                    : parseFloat(e.target.value),
              )
            }
            className="bg-slate-800 border-slate-600 mt-1"
          />
        </div>
      </div>

      {/* Окна погрузки / выгрузки */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <div className="font-semibold text-xs text-slate-400 uppercase tracking-wide">
            Погрузка
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-slate-400">Дата</Label>
              <Input
                type="date"
                value={formData.loadingDate || ""}
                onChange={(e) =>
                  handleChange("loadingDate", e.target.value || undefined)
                }
                className="bg-slate-800 border-slate-600 mt-1"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Время</Label>
              <Input
                type="time"
                value={formData.loadingTime || ""}
                onChange={(e) =>
                  handleChange("loadingTime", e.target.value || undefined)
                }
                className="bg-slate-800 border-slate-600 mt-1"
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="font-semibold text-xs text-slate-400 uppercase tracking-wide">
            Выгрузка
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-slate-400">Дата</Label>
              <Input
                type="date"
                value={formData.unloadingDate || ""}
                onChange={(e) =>
                  handleChange("unloadingDate", e.target.value || undefined)
                }
                className="bg-slate-800 border-slate-600 mt-1"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Время</Label>
              <Input
                type="time"
                value={formData.unloadingTime || ""}
                onChange={(e) =>
                  handleChange("unloadingTime", e.target.value || undefined)
                }
                className="bg-slate-800 border-slate-600 mt-1"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Груз и комментарий */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>Груз</Label>
          <Input
            value={formData.cargo}
            onChange={(e) => handleChange("cargo", e.target.value)}
            className="bg-slate-800 border-slate-600 mt-1"
            placeholder="Название груза"
          />
        </div>
        <div>
          <Label>Этап заказа</Label>
          <div className="mt-2 flex gap-2 text-[11px] text-slate-400">
            <Badge
              variant="outline"
              className={cn(
                "px-2 py-0.5",
                formData.status === "search" && "border-sky-500/50 text-sky-300",
                formData.status === "negotiation" &&
                  "border-amber-500/50 text-amber-300",
                formData.status === "agreed" &&
                  "border-emerald-500/50 text-emerald-300",
                formData.status === "in_route" &&
                  "border-orange-500/50 text-orange-300",
                formData.status === "documents" &&
                  "border-violet-500/50 text-violet-300",
                formData.status === "assigned" &&
                  "border-emerald-500/50 text-emerald-300",
                formData.status === "control" &&
                  "border-orange-500/50 text-orange-300",
                formData.status === "delivered" &&
                  "border-slate-500/50 text-slate-300",
                isOrderClosed(formData.status) && "border-red-500/50 text-red-300",
              )}
            >
              {orderStatusLabel(formData.status)}
            </Badge>
            <span className="text-slate-500">
              (этап меняют согласование и оформление рейса)
            </span>
          </div>
          {formData.orderId && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 border-slate-600 text-slate-200 hover:bg-slate-800"
                onClick={() => onOpenNegotiation?.(formData.orderId as string)}
              >
                <MessagesSquare className="h-3.5 w-3.5 mr-1.5" />
                Согласование
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-slate-300 hover:bg-slate-800"
                asChild
              >
                <Link href={`/orders/${formData.orderId}`}>Полная карточка</Link>
              </Button>
            </div>
          )}
        </div>
      </div>

      <div>
        <Label>Комментарий</Label>
        <Textarea
          value={formData.comment || ""}
          onChange={(e) => handleChange("comment", e.target.value)}
          className="bg-slate-800 border-slate-600 mt-1 min-h-[80px]"
          placeholder="Особенности погрузки, документы, ожидания клиента..."
        />
      </div>

      {/* Сводка по ставке */}
      <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm">
        <div className="flex flex-col text-xs text-slate-400">
          <span>
            Дистанция:{" "}
            <span className="text-slate-100">
              {parsedDistance.toLocaleString()} км
            </span>
          </span>
          <span>
            Ставка:{" "}
            <span className="text-slate-100">
              {parsedPrice.toLocaleString()} ₽
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Цена за км</span>
          <Badge
            variant={
              effectivePricePerKm >= 45
                ? "default"
                : effectivePricePerKm >= 30
                  ? "secondary"
                  : "destructive"
            }
          >
            {effectivePricePerKm} ₽/км
          </Badge>
        </div>
      </div>

      <div className="flex justify-end_gap-2 flex pt-4">
        <Button variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
        <Button onClick={() => onSave(formData)}>Сохранить</Button>
      </div>
    </div>
  )
}
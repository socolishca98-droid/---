"use client";

// components/clients/new-order-dialog.tsx
//
// «Новый заказ» прямо из карточки клиента — точка входа в воронку для
// компаний, которые возят постоянным клиентам (а не ищут грузы на ATI).
// Условия оплаты наследуются из карточки, маршрут и груз логист дописывает
// вручную. «Повторить заказ» подтягивает параметры прежнего рейса одним
// запросом — у постоянных клиентов заявки типовые.
//
// После создания заказ попадает в обычную воронку (этап «Согласование») —
// никаких отдельных сценариев, источник помечается как "client".

import { useCallback, useEffect, useState } from "react";
import { Loader2, PackagePlus, RotateCcw } from "lucide-react";

import { AddressInput } from "@/components/address-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";

const PAYMENT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "cash", label: "Наличные" },
  { value: "bank", label: "Безнал" },
  { value: "card", label: "Карта" },
];

const VAT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "none", label: "Без НДС" },
  { value: "vat20", label: "НДС 20%" },
  { value: "vat10", label: "НДС 10%" },
  { value: "included", label: "НДС включён" },
];

const NONE_VALUE = "__none__";

interface FormState {
  routeFrom: string;
  routeTo: string;
  distance: string;
  weight: string;
  cargoType: string;
  price: string;
  deadline: string;
  paymentType: string;
  vatType: string;
  deferredDays: string;
  requirements: string;
}

function defaultDeadline(): string {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

export interface NewOrderClient {
  id: string;
  name: string;
  contactName?: string | null;
  phone?: string | null;
  paymentType?: string | null;
  vatType?: string | null;
  deferredDays?: number | null;
}

interface NewOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: NewOrderClient | null;
  /** Id заказа, который нужно повторить (кнопка «Повторить» в истории). */
  repeatOrderId?: string | null;
  /** Вызывается после успешного создания (карточку клиента можно обновить). */
  onCreated?: () => void;
}

export function NewOrderDialog({
  open,
  onOpenChange,
  client,
  repeatOrderId,
  onCreated,
}: NewOrderDialogProps) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingRepeat, setLoadingRepeat] = useState(false);

  const set = useCallback((key: keyof FormState, value: string) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }, []);

  // Начальное состояние: условия из карточки клиента + неделя на исполнение
  useEffect(() => {
    if (!open || !client) return;
    setForm({
      routeFrom: "",
      routeTo: "",
      distance: "",
      weight: "",
      cargoType: "Груз",
      price: "",
      deadline: defaultDeadline(),
      paymentType: client.paymentType || "",
      vatType: client.vatType || "",
      deferredDays:
        client.deferredDays != null ? String(client.deferredDays) : "",
      requirements: "",
    });
  }, [open, client]);

  // «Повторить»: подтягиваем параметры прежнего заказа
  useEffect(() => {
    if (!open || !repeatOrderId) return;
    let alive = true;
    setLoadingRepeat(true);
    fetch(`/api/orders/${repeatOrderId}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!alive || !data?.success || !data.order) return;
        const order = data.order as Record<string, any>;
        setForm((prev) =>
          prev
            ? {
                ...prev,
                routeFrom: order.routeFrom || prev.routeFrom,
                routeTo: order.routeTo || prev.routeTo,
                distance:
                  order.distance != null
                    ? String(order.distance)
                    : prev.distance,
                weight:
                  order.weight != null ? String(order.weight) : prev.weight,
                cargoType: order.cargoType || prev.cargoType,
                price:
                  order.agreedPrice != null && order.agreedPrice > 0
                    ? String(order.agreedPrice)
                    : order.price != null && order.price > 0
                      ? String(order.price)
                      : prev.price,
                requirements: order.requirements || prev.requirements,
              }
            : prev,
        );
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoadingRepeat(false);
      });
    return () => {
      alive = false;
    };
  }, [open, repeatOrderId]);

  const submit = async () => {
    if (!form || !client || saving) return;
    if (!form.routeFrom.trim() || !form.routeTo.trim()) {
      toast({
        title: "Укажите маршрут",
        description: "Город погрузки и город выгрузки обязательны.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "client",
          clientId: client.id,
          clientName: client.name,
          routeFrom: form.routeFrom.trim(),
          routeTo: form.routeTo.trim(),
          distance: form.distance.trim() ? Number(form.distance) : 0,
          weight: form.weight.trim() ? Number(form.weight) : 0,
          cargoType: form.cargoType.trim() || "Груз",
          price: form.price.trim() ? Number(form.price) : null,
          deadline: form.deadline
            ? new Date(`${form.deadline}T12:00:00`).toISOString()
            : undefined,
          paymentType: form.paymentType || null,
          vatType: form.vatType || null,
          deferredDays: form.deferredDays.trim()
            ? Number(form.deferredDays)
            : null,
          requirements: form.requirements.trim() || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        toast({
          title: "Заказ не создался",
          description: data?.error || "Попробуйте ещё раз",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Заказ создан",
        description: `${form.routeFrom} → ${form.routeTo} · этап «Согласование»`,
      });
      onOpenChange(false);
      onCreated?.();
    } catch {
      toast({ title: "Ошибка соединения", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {repeatOrderId ? (
              <RotateCcw className="h-4 w-4 text-primary" />
            ) : (
              <PackagePlus className="h-4 w-4 text-primary" />
            )}
            {repeatOrderId ? "Повторить заказ" : "Новый заказ"}
          </DialogTitle>
          <DialogDescription>
            {client
              ? `Клиент: ${client.name}. Условия оплаты подтянулись из карточки — измените, если этот заказ другой.`
              : "Заказ от постоянного клиента"}
          </DialogDescription>
        </DialogHeader>

        {!form ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-order-from">Погрузка</Label>
                <AddressInput
                  value={form.routeFrom}
                  onChange={(value) => set("routeFrom", value)}
                  placeholder="Город погрузки"
                  id="new-order-from"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-order-to">Выгрузка</Label>
                <AddressInput
                  value={form.routeTo}
                  onChange={(value) => set("routeTo", value)}
                  placeholder="Город выгрузки"
                  id="new-order-to"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="new-order-distance">Расстояние, км</Label>
                <Input
                  id="new-order-distance"
                  type="number"
                  min={0}
                  value={form.distance}
                  onChange={(event) => set("distance", event.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-order-weight">Вес, кг</Label>
                <Input
                  id="new-order-weight"
                  type="number"
                  min={0}
                  value={form.weight}
                  onChange={(event) => set("weight", event.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-order-price">Ставка, ₽</Label>
                <Input
                  id="new-order-price"
                  type="number"
                  min={0}
                  value={form.price}
                  onChange={(event) => set("price", event.target.value)}
                  placeholder="—"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-order-cargo">Груз</Label>
                <Input
                  id="new-order-cargo"
                  value={form.cargoType}
                  onChange={(event) => set("cargoType", event.target.value)}
                  placeholder="Груз"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-order-deadline">Срок доставки</Label>
                <Input
                  id="new-order-deadline"
                  type="date"
                  value={form.deadline}
                  onChange={(event) => set("deadline", event.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Оплата</Label>
                <Select
                  value={form.paymentType || NONE_VALUE}
                  onValueChange={(value) =>
                    set("paymentType", value === NONE_VALUE ? "" : value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>Не задана</SelectItem>
                    {PAYMENT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>НДС</Label>
                <Select
                  value={form.vatType || NONE_VALUE}
                  onValueChange={(value) =>
                    set("vatType", value === NONE_VALUE ? "" : value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>Не задан</SelectItem>
                    {VAT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-order-deferred">Отсрочка, дн.</Label>
                <Input
                  id="new-order-deferred"
                  type="number"
                  min={0}
                  max={365}
                  value={form.deferredDays}
                  onChange={(event) => set("deferredDays", event.target.value)}
                  placeholder="0"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-order-requirements">
                Требования и примечания
              </Label>
              <Textarea
                id="new-order-requirements"
                value={form.requirements}
                onChange={(event) => set("requirements", event.target.value)}
                placeholder="Хрупкий груз, крепление, документы к выгрузке…"
                rows={2}
              />
            </div>

            {loadingRepeat && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Подтягиваем параметры прежнего заказа…
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Отмена
              </Button>
              <Button
                onClick={() => void submit()}
                disabled={saving || loadingRepeat}
              >
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <PackagePlus className="mr-2 h-4 w-4" />
                )}
                {repeatOrderId ? "Создать копию" : "Создать заказ"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// hooks/use-orders.ts

import { useState, useCallback, useEffect } from 'react'

export function useOrders() {
  const [orders, setOrders] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filters, setFilters] = useState({ status: 'all', search: '' })

  const fetchOrders = useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.status !== 'all') params.set('status', filters.status)
      if (filters.search) params.set('search', filters.search)
      
      const res = await fetch(`/api/orders?${params}`)
      const data = await res.json()
      if (data.success) setOrders(data.orders)
    } catch (e) {
      console.error(e)
    } finally {
      setIsLoading(false)
    }
  }, [filters])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  const createOrder = async (data: any) => {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    const result = await res.json()
    if (result.success) fetchOrders()
    return result
  }

  const updateOrder = async (id: string, data: any) => {
    const res = await fetch(`/api/orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    const result = await res.json()
    if (result.success) fetchOrders()
    return result
  }

  const deleteOrder = async (id: string) => {
    if (!confirm('Удалить заказ?')) return
    const res = await fetch(`/api/orders/${id}`, { method: 'DELETE' })
    const result = await res.json()
    if (result.success) fetchOrders()
  }

  return {
    orders,
    isLoading,
    filters,
    setFilters,
    createOrder,
    updateOrder,
    deleteOrder,
    refresh: fetchOrders
  }
}
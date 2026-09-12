// lib/api/driver-mobile.ts

import { prisma } from '@/lib/prisma'

// ============================================
// СМЕНА
// ============================================

export async function startShift(driverId: string, latitude?: number, longitude?: number) {
  const existing = await prisma.driverShift.findFirst({
    where: { driverId, endedAt: null }
  })
  
  if (existing) return existing
  
  const shift = await prisma.driverShift.create({
    data: {
      driverId,
      status: 'waiting',
      events: {
        create: {
          type: 'shift_start',
          latitude: latitude || 0,
          longitude: longitude || 0,
        }
      }
    }
  })
  
  await prisma.driver.update({
    where: { id: driverId },
    data: { status: 'available', latitude, longitude, lastGpsUpdate: new Date() }
  })
  
  return shift
}

export async function endShift(driverId: string, latitude?: number, longitude?: number) {
  const shift = await prisma.driverShift.findFirst({
    where: { driverId, endedAt: null }
  })
  
  if (!shift) throw new Error('Нет активной смены')
  
  const now = new Date()
  const elapsed = Math.floor((now.getTime() - shift.lastStatusChangeAt.getTime()) / 1000)
  
  const updateData: any = { endedAt: now, status: 'ended' }
  
  if (shift.status === 'driving') updateData.totalDrivingSeconds = shift.totalDrivingSeconds + elapsed
  else if (shift.status === 'resting' || shift.status === 'sleeping') updateData.totalRestingSeconds = shift.totalRestingSeconds + elapsed
  else if (shift.status === 'loading' || shift.status === 'unloading') updateData.totalLoadingSeconds = shift.totalLoadingSeconds + elapsed
  else updateData.totalWaitingSeconds = shift.totalWaitingSeconds + elapsed
  
  const updated = await prisma.driverShift.update({
    where: { id: shift.id },
    data: {
      ...updateData,
      events: {
        create: {
          type: 'shift_end',
          latitude: latitude || 0,
          longitude: longitude || 0,
        }
      }
    }
  })
  
  await prisma.driver.update({
    where: { id: driverId },
    data: { status: 'offline' }
  })
  
  return updated
}

export async function getCurrentShift(driverId: string) {
  const shift = await prisma.driverShift.findFirst({
    where: { driverId, endedAt: null },
    include: { events: { orderBy: { createdAt: 'desc' }, take: 1 } }
  })
  
  if (!shift) return null
  
  const now = new Date()
  const elapsed = Math.floor((now.getTime() - shift.lastStatusChangeAt.getTime()) / 1000)
  
  // Время в ТЕКУЩЕМ статусе
  const statusDuration = elapsed
  
  // Общее время вождения
  let currentDriving = shift.totalDrivingSeconds
  if (shift.status === 'driving') currentDriving += elapsed
  
  const totalShift = Math.floor((now.getTime() - shift.startedAt.getTime()) / 1000)
  const MAX_DRIVING = 4.5 * 60 * 60
  
  return {
    ...shift,
    statusDuration,
    currentDrivingSeconds: currentDriving,
    totalShiftSeconds: totalShift,
    drivingProgress: Math.min(100, (currentDriving / MAX_DRIVING) * 100),
    drivingRemaining: Math.max(0, MAX_DRIVING - currentDriving),
    needsRest: currentDriving >= MAX_DRIVING,
    restWarning: currentDriving >= MAX_DRIVING - 30 * 60,
  }
}

export async function updateShiftStatus(
  driverId: string, 
  newStatus: string,
  latitude?: number,
  longitude?: number
) {
  const shift = await prisma.driverShift.findFirst({
    where: { driverId, endedAt: null }
  })
  
  if (!shift) throw new Error('Нет активной смены')
  
  const now = new Date()
  const elapsed = Math.floor((now.getTime() - shift.lastStatusChangeAt.getTime()) / 1000)
  
  const updateData: any = {
    status: newStatus,
    lastStatusChangeAt: now,
  }
  
  if (shift.status === 'driving') updateData.totalDrivingSeconds = shift.totalDrivingSeconds + elapsed
  else if (shift.status === 'resting' || shift.status === 'sleeping') updateData.totalRestingSeconds = shift.totalRestingSeconds + elapsed
  else if (shift.status === 'loading' || shift.status === 'unloading') updateData.totalLoadingSeconds = shift.totalLoadingSeconds + elapsed
  else updateData.totalWaitingSeconds = shift.totalWaitingSeconds + elapsed
  
  const updated = await prisma.driverShift.update({
    where: { id: shift.id },
    data: {
      ...updateData,
      events: {
        create: {
          type: `status_${newStatus}`,
          latitude: latitude || 0,
          longitude: longitude || 0,
        }
      }
    }
  })
  
  // Обновляем статус водителя
  const driverStatus = newStatus === 'driving' ? 'busy' : 
                       newStatus === 'sleeping' ? 'offline' : 'available'
  
  await prisma.driver.update({
    where: { id: driverId },
    data: { status: driverStatus, latitude, longitude, lastGpsUpdate: new Date() }
  })
  
  // Уведомление логисту
  await prisma.notification.create({
    data: {
      userId: 'all_logists',
      userRole: 'logist',
      type: `driver_${newStatus}`,
      title: getStatusTitle(newStatus),
      message: 'Водитель сменил статус',
      driverId,
      priority: 'normal'
    }
  })
  
  return updated
}

// GPS
export async function updateDriverLocation(driverId: string, latitude: number, longitude: number) {
  await prisma.driver.update({
    where: { id: driverId },
    data: { latitude, longitude, lastGpsUpdate: new Date() }
  })
}

// SOS
export async function sendSos(driverId: string, type: string, lat: number, lon: number, message?: string) {
  const sos = await prisma.sosAlert.create({
    data: {
      driverId,
      type,
      latitude: lat,
      longitude: lon,
      message,
      status: 'active',
    }
  })
  
  // Получаем имя водителя
  const driver = await prisma.driver.findUnique({ where: { id: driverId } })
  
  await prisma.notification.create({
    data: {
      userId: 'all_logists',
      userRole: 'logist',
      type: 'sos_alert',
      title: '🆘 SOS СИГНАЛ!',
      message: `${driver?.name || 'Водитель'}: ${getSosLabel(type)}`,
      driverId,
      sosId: sos.id,
      priority: 'critical',
    }
  })
  
  return sos
}

export async function cancelSos(sosId: string, driverId: string) {
  const sos = await prisma.sosAlert.findFirst({
    where: { id: sosId, driverId, status: 'active' }
  })
  if (!sos) throw new Error('SOS не найден')
  
  return prisma.sosAlert.update({
    where: { id: sosId },
    data: { status: 'false_alarm', resolvedAt: new Date() }
  })
}

// Helpers
function getStatusTitle(status: string) {
  const titles: Record<string, string> = {
    driving: '🚗 Водитель поехал',
    loading: '📦 На погрузке',
    unloading: '📤 На выгрузке',
    fueling: '⛽ Заправка',
    resting: '☕ Перерыв',
    sleeping: '🛏️ Отдых',
    waiting: '⏳ Ожидание',
  }
  return titles[status] || 'Статус изменён'
}

function getSosLabel(type: string) {
  const labels: Record<string, string> = {
    accident: 'ДТП',
    breakdown: 'Поломка',
    medical: 'Здоровье',
    other: 'ЧП',
  }
  return labels[type] || type
}
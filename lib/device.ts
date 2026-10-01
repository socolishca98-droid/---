/**
 * lib/device.ts — определение мобильного устройства.
 *
 * Серверная часть: по user-agent (редиректы "/" и "/login").
 * Клиентская часть: user-agent + ширина экрана + тач (форма входа).
 * Планшет iPadOS маскируется под Mac, поэтому на клиенте добавляем
 * проверку «узкий экран + тач».
 */

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Mobi/i;

/** Серверная проверка по заголовку user-agent. */
export function isMobileUserAgent(ua: string | null | undefined): boolean {
  return Boolean(ua && MOBILE_UA.test(ua));
}

/** Клиентская проверка: UA, либо узкий экран с тачем. */
export function isMobileDevice(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined")
    return false;
  if (MOBILE_UA.test(navigator.userAgent)) return true;
  const narrow = window.innerWidth < 820;
  const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  return narrow && touch;
}

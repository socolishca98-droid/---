// components/dashboard/map/styles.ts

export const mapStyles = `
  /* ============================================
     PREMIUM LOGISTICS TMS MAP SYSTEM
     Sophisticated Dark Glassmorphic Theme
     ============================================ */

  /* === LEAFLET BASE CONTAINER === */
  .leaflet-container {
    background-color: #0d0f14 !important;
    font-family: inherit;
    outline: none;
  }

  /* === ТОЧКИ ЗАГРУЗКИ / ВЫГРУЗКИ (Минималистичные неоновые жетоны) === */
  .wp-container {
    filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.6));
    transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .wp-container:hover {
    transform: scale(1.15);
    z-index: 9999 !important;
  }

  .wp {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .wp-dot {
    position: relative;
    width: 28px;
    height: 28px;
    background: #111319;
    border: 2px solid var(--c);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 800;
    color: var(--c);
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.5), inset 0 0 6px rgba(0, 0, 0, 0.8);
    transition: all 0.2s ease;
    cursor: pointer;
  }

  .wp-dot:hover {
    box-shadow: 0 0 16px var(--c);
  }

  .wp-num {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: -0.5px;
  }

  .wp-arrow {
    position: absolute;
    bottom: -3px;
    right: -3px;
    width: 13px;
    height: 13px;
    background: var(--c);
    border: 1.5px solid #111319;
    border-radius: 50%;
    font-size: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-weight: 800;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
  }

  /* === ПОПАПЫ ТОЧЕК МАРШРУТА (Glass Card) === */
  .wp-popup-wrap .leaflet-popup-content-wrapper {
    background: rgba(18, 20, 28, 0.95) !important;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.08) !important;
    border-radius: 16px !important;
    padding: 0 !important;
    box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.7), 0 0 1px rgba(255, 255, 255, 0.1) !important;
    overflow: hidden;
  }

  .wp-popup-wrap .leaflet-popup-content {
    margin: 0 !important;
  }

  .wp-popup-wrap .leaflet-popup-tip {
    background: rgba(18, 20, 28, 0.95) !important;
    border: 1px solid rgba(255, 255, 255, 0.08) !important;
  }

  .wp-popup {
    min-width: 220px;
    max-width: 280px;
  }

  .wp-popup-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(255, 255, 255, 0.02);
  }

  .wp-popup-type {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.2px;
  }

  .wp-popup-num {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    color: #fff;
  }

  .wp-popup-addr {
    padding: 12px 16px;
    font-size: 12px;
    color: #d1d5db;
    line-height: 1.5;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .wp-popup-info {
    padding: 10px 16px;
    font-size: 11px;
    color: #9ca3af;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .wp-popup-info:last-child {
    border-bottom: none;
  }

  /* === БАЗА / ШТАБ (High-Tech Pulse Beacon) === */
  .base-marker {
    filter: drop-shadow(0 0 20px rgba(249, 115, 22, 0.45));
    transition: transform 0.2s ease;
  }

  .base-marker:hover {
    transform: scale(1.1);
  }

  .base-container {
    position: relative;
    width: 60px;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .base-pulse-1,
  .base-pulse-2 {
    position: absolute;
    width: 44px;
    height: 44px;
    border: 1.5px solid #f97316;
    border-radius: 50%;
    animation: basePulseGlow 3s cubic-bezier(0.2, 0.8, 0.2, 1) infinite;
  }

  .base-pulse-2 {
    animation-delay: 1.5s;
  }

  @keyframes basePulseGlow {
    0% { opacity: 0.8; transform: scale(0.8); }
    100% { opacity: 0; transform: scale(2.2); }
  }

  .base-core {
    position: relative;
    z-index: 10;
    width: 42px;
    height: 42px;
    background: #12141c;
    border: 2px solid #f97316;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 24px rgba(249, 115, 22, 0.35), inset 0 0 12px rgba(249, 115, 22, 0.15);
  }

  .base-core svg {
    width: 20px;
    height: 20px;
    stroke: #f97316;
  }

  .base-label {
    position: absolute;
    bottom: -6px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(18, 20, 28, 0.95);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(249, 115, 22, 0.5);
    padding: 3px 10px;
    border-radius: 9999px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.3px;
    color: #fb923c;
    white-space: nowrap;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  }

  /* === ВОДИТЕЛИ (Телематические метки) === */
  .driver-marker {
    transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .driver-marker:hover {
    transform: scale(1.15);
    z-index: 9999 !important;
  }

  .driver-container {
    position: relative;
    width: 44px;
    height: 52px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .driver-pulse {
    position: absolute;
    top: 2px;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    animation: driverPulseAnim 2.2s cubic-bezier(0.2, 0.8, 0.2, 1) infinite;
  }

  @keyframes driverPulseAnim {
    0% { opacity: 0.6; transform: scale(0.9); }
    100% { opacity: 0; transform: scale(1.8); }
  }

  .driver-core {
    position: relative;
    z-index: 10;
    width: 38px;
    height: 38px;
    background: #111319;
    border: 2px solid;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.5);
    transition: border-color 0.2s;
  }

  .driver-core svg {
    width: 18px;
    height: 18px;
  }

  .driver-pointer {
    width: 0;
    height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 6px solid;
    margin-top: -1px;
    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
  }

  /* Выбранный водитель: кольцо вокруг метки — связь «панель ↔ машина на карте» */
  .driver-ring {
    position: absolute;
    top: -4px;
    width: 50px;
    height: 50px;
    border: 2px solid;
    border-radius: 50%;
    opacity: 0.85;
    box-shadow: 0 0 18px rgba(0, 0, 0, 0.45);
    animation: driverRingAnim 2.6s ease-in-out infinite;
  }

  @keyframes driverRingAnim {
    0%, 100% { transform: scale(1); opacity: 0.85; }
    50% { transform: scale(1.14); opacity: 0.45; }
  }

  .driver-container.selected .driver-core {
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.6), 0 0 0 3px rgba(255, 255, 255, 0.08);
  }

  @media (prefers-reduced-motion: reduce) {
    .driver-ring,
    .driver-pulse {
      animation: none !important;
    }
  }

  /* === POPUP ВОДИТЕЛЯ === */
  .custom-popup .leaflet-popup-content-wrapper {
    background: rgba(18, 20, 28, 0.95) !important;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.08) !important;
    border-radius: 16px !important;
    padding: 0 !important;
    overflow: hidden;
    box-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.8) !important;
  }

  .custom-popup .leaflet-popup-content {
    margin: 0 !important;
  }

  .custom-popup .leaflet-popup-tip-container {
    display: none;
  }

  .popup-content {
    padding: 16px;
    min-width: 220px;
  }

  .popup-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }

  .popup-avatar {
    width: 38px;
    height: 38px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 800;
    color: #fff;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .popup-name {
    font-size: 13px;
    font-weight: 700;
    color: #f3f4f6;
  }

  .popup-vehicle {
    font-size: 11px;
    color: #9ca3af;
    margin-top: 2px;
  }

  .popup-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 9999px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin-bottom: 12px;
    border: 1px solid transparent;
  }

  .popup-status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .popup-route {
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 10px;
    padding: 10px 12px;
  }

  .popup-route-from,
  .popup-route-to {
    font-size: 11px;
    color: #d1d5db;
    line-height: 1.4;
  }

  .popup-route-arrow {
    text-align: center;
    color: #6b7280;
    font-size: 11px;
    padding: 2px 0;
  }

  /* === СДВИГ КОНТРОЛОВ, КОГДА РАСКРЫТА ПАНЕЛЬ ВОДИТЕЛЕЙ ===
     Панель занимает 21rem у правого края; на узком окне она и так на всю
     ширину, поэтому сдвигаем только там, где для кнопок остаётся место. */
  @media (min-width: 1024px) {
    .map-drawer-open .leaflet-bottom.leaflet-right {
      right: 21rem;
      transition: right 300ms cubic-bezier(0.22, 1, 0.36, 1);
    }
  }

  /* === LEAFLET ZOOM CONTROLS (Floating Glass) === */
  .leaflet-control-zoom {
    border: 1px solid rgba(255, 255, 255, 0.08) !important;
    border-radius: 14px !important;
    overflow: hidden;
    box-shadow: 0 16px 32px rgba(0, 0, 0, 0.6) !important;
    backdrop-filter: blur(16px);
    margin-right: 16px !important;
    margin-bottom: 24px !important;
  }

  .leaflet-control-zoom a {
    background: rgba(18, 20, 28, 0.9) !important;
    color: #9ca3af !important;
    border: none !important;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
    width: 36px !important;
    height: 36px !important;
    line-height: 36px !important;
    font-size: 16px !important;
    font-weight: 300 !important;
    transition: all 0.15s ease;
  }

  .leaflet-control-zoom a:hover {
    background: rgba(30, 34, 48, 0.95) !important;
    color: #f97316 !important;
  }

  .leaflet-control-zoom a:last-child {
    border-bottom: none !important;
  }

  /* === SCROLLBAR === */
  .custom-scrollbar::-webkit-scrollbar {
    width: 4px;
  }

  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }

  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 9999px;
  }

  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.25);
  }

  /* === Слой пробок: тултипы, попапы и маркеры инцидентов ===
     className у Leaflet попадает на корень попапа/тултипа, поэтому все
     правила пишем потомкам — иначе стили не применяются вовсе. */
  .leaflet-tooltip.traffic-leaflet-tooltip {
    background: rgba(14, 16, 23, 0.96) !important;
    backdrop-filter: blur(16px) !important;
    -webkit-backdrop-filter: blur(16px) !important;
    border: 1px solid rgba(255, 255, 255, 0.12) !important;
    border-radius: 12px !important;
    color: #f3f4f6 !important;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.7) !important;
    padding: 8px 10px !important;
  }

  .leaflet-tooltip.traffic-leaflet-tooltip::before {
    display: none !important;
  }

  .traffic-tooltip {
    display: grid;
    gap: 3px;
    min-width: 190px;
    max-width: 260px;
    font-size: 11px;
    line-height: 1.45;
    pointer-events: none;
  }

  .traffic-tooltip__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 2px;
  }

  .traffic-tooltip__title {
    font-weight: 700;
    font-size: 11.5px;
    color: #f9fafb;
  }

  .traffic-tooltip__delay {
    flex-shrink: 0;
    padding: 1px 6px;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 800;
    color: #fecdd3;
    background: rgba(225, 29, 72, 0.22);
    border: 1px solid rgba(244, 63, 94, 0.35);
  }

  .traffic-tooltip__delay--ok {
    color: #bbf7d0;
    background: rgba(34, 197, 94, 0.18);
    border-color: rgba(34, 197, 94, 0.35);
  }

  .traffic-tooltip__row {
    color: #cbd5e1;
  }

  .traffic-tooltip__row strong {
    color: #f1f5f9;
    font-weight: 600;
  }

  .traffic-tooltip__row--muted {
    color: #94a3b8;
    font-size: 10.5px;
  }

  .traffic-tooltip__note {
    margin-top: 3px;
    padding-top: 3px;
    border-top: 1px dashed rgba(255, 255, 255, 0.14);
    color: #94a3b8;
    font-size: 10px;
  }

  .leaflet-div-icon.traffic-incident-div-icon {
    background: transparent !important;
    border: none !important;
  }

  .traffic-incident-marker {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 52px;
    height: 28px;
    cursor: pointer;
    transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .traffic-incident-marker:hover {
    transform: scale(1.12);
  }

  .traffic-incident-beacon {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 26px;
    height: 26px;
    margin: -13px 0 0 -13px;
    border-radius: 50%;
    border: 1.5px solid;
    opacity: 0.7;
    animation: trafficBeaconPulse 2.4s cubic-bezier(0, 0, 0.2, 1) infinite;
  }

  @keyframes trafficBeaconPulse {
    70%,
    100% {
      transform: scale(1.9);
      opacity: 0;
    }
  }

  .traffic-incident-badge {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 7px;
    border-radius: 9px;
    background: rgba(15, 17, 23, 0.96);
    border: 1.5px solid;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.75);
  }

  .traffic-incident-emoji {
    font-size: 12px;
    line-height: 1;
  }

  .traffic-incident-delay {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: -0.2px;
    color: #fecdd3;
  }

  .traffic-popup-wrap .leaflet-popup-content-wrapper {
    background: rgba(18, 20, 28, 0.97) !important;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.1) !important;
    border-radius: 16px !important;
    box-shadow: 0 20px 48px rgba(0, 0, 0, 0.75) !important;
    color: #f3f4f6 !important;
  }

  .traffic-popup-wrap .leaflet-popup-content {
    margin: 12px 14px !important;
    line-height: 1.45 !important;
    font-size: 12px;
  }

  .traffic-popup-wrap .leaflet-popup-tip {
    background: rgba(18, 20, 28, 0.97) !important;
    border: 1px solid rgba(255, 255, 255, 0.1) !important;
  }

  .traffic-popup {
    display: grid;
    gap: 5px;
    min-width: 220px;
  }

  .traffic-popup__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-weight: 800;
    font-size: 12.5px;
  }

  .traffic-popup__delay {
    flex-shrink: 0;
    padding: 1px 6px;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 800;
    color: #fecdd3;
    background: rgba(225, 29, 72, 0.22);
    border: 1px solid rgba(244, 63, 94, 0.35);
  }

  .traffic-popup__row {
    font-size: 11.5px;
    color: #94a3b8;
  }

  .traffic-popup__row strong {
    color: #e2e8f0;
    font-weight: 600;
  }

  .traffic-popup__text {
    margin: 0;
    font-size: 11px;
    color: #cbd5e1;
    line-height: 1.45;
  }

  /* === Подложка, пока тайлы карты не загрузились === */
  /* Подложка статичная: раньше она «дышала» (opacity 0.96 ↔ 0.82), и пока
     тайлы ехали, карта выглядела мигающей. Теперь просто ровный фон. */
  .map-tiles-veil {
    background:
      radial-gradient(120% 90% at 50% 0%, rgba(255, 107, 53, 0.06), transparent 60%),
      linear-gradient(180deg, #0b0d13 0%, #0a0a0f 60%, #090a10 100%);
  }

  @media (prefers-reduced-motion: reduce) {
    .map-tiles-veil,
    .traffic-incident-beacon {
      animation: none !important;
    }
  }
`

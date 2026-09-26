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

  /* === ТАЙЛЫ ПОДКЛАДКИ ===
     Основной источник — Esri: CARTO с 2025 года требует ключ и без него отдаёт
     «API KEY REQUIRED». Тема «Графит» отличается от «Тёмной» обесцвечиванием,
     поэтому слои не сливаются, хотя приходят с одного сервера.
     Фильтр вешаем на контейнер слоя (leaflet-layer), а не на каждый тайл:
     так он считается один раз и не мигает при подгрузке плиток. */

  .map-tiles-graphite {
    filter: saturate(0.12) contrast(1.06) brightness(0.96);
  }

  /* Тайлы OpenStreetMap светлые — переворачиваем их под тёмный интерфейс */
  .map-tiles-osm-dark {
    filter: invert(1) hue-rotate(180deg) saturate(0.4) brightness(0.82) contrast(1.08);
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

  /* === TRAFFIC TOOLTIP & INCIDENTS === */
  .leaflet-tooltip.traffic-leaflet-tooltip {
    background: rgba(14, 16, 23, 0.96) !important;
    backdrop-filter: blur(16px) !important;
    -webkit-backdrop-filter: blur(16px) !important;
    border: 1px solid rgba(255, 255, 255, 0.12) !important;
    border-radius: 12px !important;
    color: #f3f4f6 !important;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.7) !important;
    padding: 6px 10px !important;
  }

  .leaflet-tooltip.traffic-leaflet-tooltip::before {
    display: none !important;
  }

  .traffic-tooltip {
    background: rgba(15, 17, 23, 0.96);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 8px 12px;
    color: #f3f4f6;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.7);
    pointer-events: none;
  }

  .leaflet-div-icon.traffic-incident-div-icon {
    background: transparent !important;
    border: none !important;
  }

  .traffic-incident-marker {
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .traffic-incident-marker:hover {
    transform: scale(1.25);
  }

  .traffic-incident-beacon {
    position: absolute;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    animation: trafficBeaconPulse 2s cubic-bezier(0, 0, 0.2, 1) infinite;
    opacity: 0.75;
  }

  @keyframes trafficBeaconPulse {
    75%, 100% {
      transform: scale(2.2);
      opacity: 0;
    }
  }

  .leaflet-popup-content-wrapper.traffic-popup {
    background: rgba(18, 20, 28, 0.96) !important;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.08) !important;
    color: #fff !important;
    border-radius: 16px !important;
    box-shadow: 0 20px 48px rgba(0, 0, 0, 0.75) !important;
  }

  .traffic-popup .leaflet-popup-content {
    margin: 14px 16px !important;
    line-height: 1.4 !important;
  }

  .traffic-popup .leaflet-popup-tip {
    background: rgba(18, 20, 28, 0.96) !important;
    border: 1px solid rgba(255, 255, 255, 0.08) !important;
  }
`

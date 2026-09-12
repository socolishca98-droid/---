// components/dashboard/map/styles.ts

export const mapStyles = `
  /* ============================================
     TMS MAP — CLEAN & COMPACT
     ============================================ */

  /* === ТОЧКИ ЗАГРУЗКИ/ВЫГРУЗКИ (компактные) === */
  .wp-container {
    filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.4));
  }

  .wp {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .wp-dot {
    position: relative;
    width: 32px;
    height: 32px;
    background: #18181b;
    border: 2.5px solid var(--c);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    color: var(--c);
    transition: all 0.15s ease;
    cursor: pointer;
  }

  .wp-dot:hover {
    transform: scale(1.15);
    box-shadow: 0 0 12px var(--c);
  }

  .wp-num {
    font-size: 13px;
    font-weight: 700;
  }

  .wp-arrow {
    position: absolute;
    bottom: -2px;
    right: -2px;
    width: 14px;
    height: 14px;
    background: var(--c);
    border-radius: 50%;
    font-size: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-weight: 700;
  }

  /* Popup точки */
  .wp-popup-wrap .leaflet-popup-content-wrapper {
    background: #18181b;
    border-radius: 12px;
    padding: 0;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }

  .wp-popup-wrap .leaflet-popup-content {
    margin: 0;
  }

  .wp-popup-wrap .leaflet-popup-tip {
    background: #18181b;
  }

  .wp-popup {
    min-width: 180px;
  }

  .wp-popup-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 2px solid;
  }

  .wp-popup-type {
    font-size: 13px;
    font-weight: 600;
  }

  .wp-popup-num {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    color: #fff;
  }

  .wp-popup-addr {
    padding: 12px 14px;
    font-size: 13px;
    color: #a1a1aa;
    line-height: 1.5;
    border-bottom: 1px solid #27272a;
  }

  .wp-popup-info {
    padding: 8px 14px;
    font-size: 12px;
    color: #71717a;
    border-bottom: 1px solid #27272a;
  }

  .wp-popup-info:last-child {
    border-bottom: none;
  }

  /* === БАЗА === */
  .base-marker {
    filter: drop-shadow(0 0 16px rgba(255, 107, 53, 0.4));
  }

  .base-container {
    position: relative;
    width: 56px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .base-pulse-1,
  .base-pulse-2 {
    position: absolute;
    width: 40px;
    height: 40px;
    border: 2px solid #FF6B35;
    border-radius: 50%;
    animation: basePulse 2.5s ease-out infinite;
  }

  .base-pulse-2 {
    animation-delay: 1.25s;
  }

  @keyframes basePulse {
    0% { opacity: 0.6; transform: scale(0.9); }
    100% { opacity: 0; transform: scale(1.8); }
  }

  .base-core {
    position: relative;
    z-index: 10;
    width: 40px;
    height: 40px;
    background: #18181b;
    border: 2.5px solid #FF6B35;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 20px rgba(255, 107, 53, 0.3);
  }

  .base-core svg {
    width: 18px;
    height: 18px;
    stroke: #FF6B35;
  }

  .base-label {
    position: absolute;
    bottom: -2px;
    left: 50%;
    transform: translateX(-50%);
    background: #18181b;
    border: 1.5px solid #FF6B35;
    padding: 3px 10px;
    border-radius: 8px;
    font-size: 10px;
    font-weight: 600;
    color: #FF6B35;
    white-space: nowrap;
  }

  /* === ВОДИТЕЛИ === */
  .driver-marker {
    transition: transform 0.15s ease;
  }

  .driver-marker:hover {
    transform: scale(1.1);
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
    width: 40px;
    height: 40px;
    border-radius: 50%;
    animation: driverPulse 1.8s ease-out infinite;
  }

  @keyframes driverPulse {
    0% { opacity: 0.5; transform: scale(1); }
    100% { opacity: 0; transform: scale(1.5); }
  }

  .driver-core {
    position: relative;
    z-index: 10;
    width: 40px;
    height: 40px;
    background: #18181b;
    border: 2.5px solid;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .driver-core svg {
    width: 18px;
    height: 18px;
  }

  .driver-pointer {
    width: 0;
    height: 0;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-top: 7px solid;
    margin-top: -1px;
  }

  /* === POPUP ВОДИТЕЛЯ === */
  .custom-popup .leaflet-popup-content-wrapper {
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 14px;
    padding: 0;
    overflow: hidden;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  }

  .custom-popup .leaflet-popup-content {
    margin: 0;
  }

  .custom-popup .leaflet-popup-tip-container {
    display: none;
  }

  .popup-content {
    padding: 14px;
    min-width: 200px;
  }

  .popup-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }

  .popup-avatar {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 700;
    color: #fff;
  }

  .popup-name {
    font-size: 14px;
    font-weight: 600;
    color: #fafafa;
  }

  .popup-vehicle {
    font-size: 11px;
    color: #71717a;
    margin-top: 2px;
  }

  .popup-status {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border-radius: 16px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    margin-bottom: 10px;
  }

  .popup-status-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
  }

  .popup-route {
    background: #0f0f11;
    border-radius: 10px;
    padding: 10px;
  }

  .popup-route-from,
  .popup-route-to {
    font-size: 11px;
    color: #d4d4d8;
    line-height: 1.4;
  }

  .popup-route-arrow {
    text-align: center;
    color: #52525b;
    font-size: 11px;
    padding: 4px 0;
  }

  /* === ZOOM === */
  .leaflet-control-zoom {
    border: none !important;
    border-radius: 10px !important;
    overflow: hidden;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4) !important;
  }

  .leaflet-control-zoom a {
    background: #18181b !important;
    color: #a1a1aa !important;
    border: none !important;
    border-bottom: 1px solid #27272a !important;
    width: 36px !important;
    height: 36px !important;
    line-height: 36px !important;
    font-size: 16px !important;
    transition: all 0.1s ease;
  }

  .leaflet-control-zoom a:hover {
    background: #27272a !important;
    color: #FF6B35 !important;
  }

  .leaflet-control-zoom a:last-child {
    border-bottom: none !important;
  }

  /* === SCROLLBAR === */
  .custom-scrollbar::-webkit-scrollbar {
    width: 5px;
  }

  .custom-scrollbar::-webkit-scrollbar-track {
    background: #0f0f11;
  }

  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: #3f3f46;
    border-radius: 3px;
  }
`
// lib/sandbox/placement.ts
//
// Куда ставить новую карточку на холсте песочницы.
//
// Было: x = 100 + Math.random() * 50, y = 100 + Math.random() * 50 — квадрат
// 50×50 px, а карточка заказа — 230×178. Вторая карточка почти всегда ложилась
// ровно на первую: логист видел один груз вместо двух, кликал по верхней и
// «маршрут не собирался» — остальные грузы были под ней.
//
// Здесь карточки раскладываются по сетке видимой части холста, свободное место
// выбирается по расстоянию до уже стоящих карточек. Функция чистая: тесты
// проверяют её без браузера.

/** Габариты карточки заказа в песочнице (w-[230px] и высота с подписями). */
export const CARD_WIDTH = 230
export const CARD_HEIGHT = 178

/** Отступ между карточками и от края холста. */
export const CARD_GAP = 14
const PADDING = 18

export type CardPosition = { x: number; y: number }

/**
 * Свободное место для новой карточки.
 *
 * `existing` — уже стоящие карточки (их x/y), `area` — видимая часть холста.
 * Если места в сетке не осталось (холст маленький, карточек много), позиция
 * всё равно не повторяет существующую: добавляем каскадный сдвиг.
 */
export function nextCardPosition(
  existing: CardPosition[],
  area: { width: number; height: number },
): CardPosition {
  const stepX = CARD_WIDTH + CARD_GAP
  const stepY = CARD_HEIGHT + CARD_GAP

  // Холст может быть ещё не измерен — считаем по минимальному разумному размеру,
  // чтобы карточки не улетели за край.
  const width = Number.isFinite(area.width) && area.width > 0 ? area.width : 520
  const height = Number.isFinite(area.height) && area.height > 0 ? area.height : 520

  const columns = Math.max(1, Math.floor((width - PADDING * 2 + CARD_GAP) / stepX))
  const rows = Math.max(1, Math.floor((height - PADDING * 2 + CARD_GAP) / stepY))

  const cells: CardPosition[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      cells.push({
        x: PADDING + column * stepX,
        y: PADDING + row * stepY,
      })
    }
  }

  // Свободные ячейки — те, чей прямоугольник не пересекается ни с одной карточкой.
  const isFree = (cell: CardPosition) =>
    existing.every((card) => !overlaps(cell, card))

  const freeCells = cells.filter(isFree)
  if (freeCells.length > 0) {
    return freeCells[0]
  }

  // Мест нет: берём ячейку, дальше всего отстоящую от уже занятых, и сдвигаем
  // каскадом — карточки будут видны, пусть и внахлёст.
  let best = cells[0]
  let bestDistance = -1
  for (const cell of cells) {
    const nearest = existing.length > 0 ? Math.min(...existing.map((card) => distance(cell, card))) : Infinity
    if (nearest > bestDistance) {
      bestDistance = nearest
      best = cell
    }
  }

  const stacked = existing.filter((card) => overlaps(best, card)).length
  return {
    x: best.x + (stacked % 5) * 10,
    y: best.y + (stacked % 5) * 10,
  }
}

/** Пересекаются ли карточки, если одну поставить в `position`. */
function overlaps(position: CardPosition, card: CardPosition): boolean {
  return (
    position.x < card.x + CARD_WIDTH &&
    position.x + CARD_WIDTH > card.x &&
    position.y < card.y + CARD_HEIGHT &&
    position.y + CARD_HEIGHT > card.y
  )
}

function distance(a: CardPosition, b: CardPosition): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

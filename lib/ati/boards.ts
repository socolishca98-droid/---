// lib/ati/boards.ts
//
// Персональные площадки организации в ATI.SU. Поиск грузов через официальное
// API возможен только по площадкам, которые видны аккаунту организации
// (GET /v2/boards/public/boards/canView) — отсюда кабинет показывает, какие
// именно площадки питают живой поиск и плановые сканы.

import { atiFetch, atiHeaders, ATI_API_BASE } from "./http"

export type AtiBoard = {
  id: string
  name: string
  /** loads | trucks — что размещается на площадке */
  boardType: string | null
  /** input | output | exchange — направление обмена */
  direction: string | null
}

/**
 * Площадки, на которых аккаунт организации видит грузы. Один запрос;
 * темп и ретрай 429 обеспечивает atiFetch. Ошибка ATI не роняет вызывающего:
 * возвращаем пустой список и текст ошибки отдельным полем.
 */
export async function fetchBoards(
  token: string,
  organizationId: string,
): Promise<{ boards: AtiBoard[]; error: string | null }> {
  try {
    const res = await atiFetch(
      `${ATI_API_BASE}/v2/boards/public/boards/canView`,
      {
        headers: atiHeaders(token),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
      organizationId,
    )
    if (!res.ok) {
      return { boards: [], error: `ATI.SU ответил ${res.status}` }
    }
    const data: any = await res.json()
    const rows = Array.isArray(data) ? data : data?.boards ?? data?.items ?? []
    const boards = rows
      .map((row: any) => ({
        id: String(row?.id ?? row?.Id ?? ""),
        name: String(row?.name ?? row?.title ?? row?.board_name ?? "Площадка"),
        boardType: row?.board_type ?? row?.BoardType ?? null,
        direction: row?.board_exchange_direction ?? row?.direction ?? null,
      }))
      .filter((board: AtiBoard) => board.id.length > 0)
    return { boards, error: null }
  } catch (error) {
    return {
      boards: [],
      error: error instanceof Error ? error.message : "не удалось получить площадки",
    }
  }
}

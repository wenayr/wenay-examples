export type BoardPoint = {task: string, x: number, y: number}
export type tBoardSurface = 'tasks' | 'canvas'
export type tBoardDrag = {kind: 'task', id: string, revision: number, col: string, before: string, x: number, y: number} |
    {kind: 'note', id: string, revision: number, x: number, y: number}
export type BoardActivity = {cursor: BoardPoint | null, selected: string, surface?: tBoardSurface, drag?: tBoardDrag | null}
export type BoardParticipant = BoardActivity & {id: string, account: string, name: string}
export type BoardPresence = {self: string, participants: BoardParticipant[]}

export const BOARD_TTL = 10000
export const BOARD_INTERVAL = 80

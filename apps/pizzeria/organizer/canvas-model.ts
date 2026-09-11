export const CANVAS_SIZE = {width: 1600, height: 1000}
export const NOTE_COLORS = ['sand', 'mint', 'sky', 'rose'] as const
export type CanvasNote = {id: string, text: string, color: typeof NOTE_COLORS[number], x: number, y: number, width: number, height: number, revision: number, createdBy: string}
export type CanvasLink = {id: string, from: string, to: string}
export type CanvasState = {notes: Record<string, CanvasNote>, links: Record<string, CanvasLink>}
export function emptyCanvas(): CanvasState {return {notes: {}, links: {}}}
export function notePosition(deps: {x: number, y: number, width: number, height: number}) {
    return {x: Math.max(0, Math.min(CANVAS_SIZE.width - deps.width, Math.round(deps.x))),
        y: Math.max(0, Math.min(CANVAS_SIZE.height - deps.height, Math.round(deps.y)))}
}

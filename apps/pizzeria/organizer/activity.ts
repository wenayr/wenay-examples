import type {WorkView} from './model'
import {CANVAS_SIZE} from './canvas-model'
import type {BoardActivity, tBoardDrag} from './collaboration-model'

// Product policy: no private target ids, stale previews or automatic task manipulation.
// Курсор передаётся в долях карточки: за её пределами он бессмыслен.
function relativePoint(cursor: {task: unknown, x: number, y: number}) {
    if (typeof cursor.task != 'string' || !cursor.task.trim()) return false
    if (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) return false
    const horizontal = cursor.x >= 0 && cursor.x <= 1
    return horizontal && cursor.y >= 0 && cursor.y <= 1
}

function insideCanvas(value: {x: number, y: number}) {
    if (value.x < 0 || value.y < 0) return false
    return value.x <= CANVAS_SIZE.width && value.y <= CANVAS_SIZE.height
}

export function projectActivity(deps: {activity: BoardActivity, source: WorkView, viewer: WorkView}): BoardActivity {
    const {activity, source, viewer} = deps
    const surface = activity.surface ?? 'tasks'
    const a = surface == 'canvas' ? source.canvas?.notes ?? {} : source.tasks
    const b = surface == 'canvas' ? viewer.canvas?.notes ?? {} : viewer.tasks
    const visible = (id: string) => Object.hasOwn(a, id) && Object.hasOwn(b, id)
    let drag: tBoardDrag | null = null
    const candidate = activity.drag
    if (candidate && visible(candidate.id) && a[candidate.id].revision == candidate.revision) {
        if (candidate.kind == 'note' && surface == 'canvas') {
            const note = source.canvas!.notes[candidate.id]
            const placed = candidate.x >= 0 && candidate.y >= 0
            const inside = candidate.x + note.width <= CANVAS_SIZE.width
                && candidate.y + note.height <= CANVAS_SIZE.height
            if (placed && inside) drag = {...candidate}
        }
        if (candidate.kind == 'task' && surface == 'tasks') {
            const task = source.tasks[candidate.id]
            const column = source.columns.find(column => column.key == candidate.col)
            // Свою задачу двигает исполнитель или автор, чужую — только менеджер.
            const own = task.assignee == source.me || task.createdBy == source.me
            const allowed = source.manage || own
            if (column && !task.automatic && allowed) {
                drag = {
                    ...candidate,
                    before: candidate.before != candidate.id && visible(candidate.before) && column.items.includes(candidate.before) ? candidate.before : ''
                }
            }
        }
    }
    return {surface, selected: visible(activity.selected) ? activity.selected : '',
        cursor: activity.cursor && visible(activity.cursor.task) ? {...activity.cursor} : null, drag}
}

export function cleanActivity(activity: BoardActivity): BoardActivity {
    const text = (value: unknown) => typeof value == 'string' && value.length <= 200
    const surface = activity?.surface == null || ['tasks', 'canvas'].includes(activity.surface)
    if (!activity || !text(activity.selected) || !surface) {
        throw new Error('Invalid board activity')
    }
    const cursor = activity.cursor
    if (cursor != null && !relativePoint(cursor)) throw new Error('Invalid board point')
    const value = activity.drag
    let drag: tBoardDrag | null = null
    if (value != null) {
        const identified = text(value.id) && Number.isInteger(value.revision) && value.revision >= 1
        const positioned = Number.isFinite(value.x) && Number.isFinite(value.y)
        if (!identified || !positioned) throw new Error('Invalid drag')
        // Перенос карточки описывается колонкой, соседом и небольшим смещением.
        const nearby = Math.abs(value.x) <= 64 && Math.abs(value.y) <= 64
        if (value.kind == 'task' && nearby) {
            if (!text(value.col) || !text(value.before)) throw new Error('Invalid drag')
            drag = {
                kind: 'task',
                id: value.id,
                revision: value.revision,
                col: value.col,
                before: value.before,
                x: value.x,
                y: value.y
            }
        } else if (value.kind == 'note' && insideCanvas(value)) {
            drag = {kind: 'note', id: value.id, revision: value.revision, x: value.x, y: value.y}
        } else throw new Error('Invalid drag')
    }
    return {
        surface: activity.surface ?? 'tasks',
        selected: activity.selected,
        cursor: cursor ? {task: cursor.task, x: cursor.x, y: cursor.y} : null,
        drag
    }
}

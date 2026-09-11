import type {WorkView} from './model'
import {CANVAS_SIZE} from './canvas-model'
import type {BoardActivity, tBoardDrag} from './collaboration-model'

// Product policy: no private target ids, stale previews or automatic task manipulation.
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
            if (candidate.x >= 0 && candidate.y >= 0 && candidate.x + note.width <= CANVAS_SIZE.width && candidate.y + note.height <= CANVAS_SIZE.height) drag = {...candidate}
        }
        if (candidate.kind == 'task' && surface == 'tasks') {
            const task = source.tasks[candidate.id]
            const column = source.columns.find(column => column.key == candidate.col)
            if (column && !task.automatic && (source.manage || task.assignee == source.me || task.createdBy == source.me)) {
                drag = {...candidate, before: candidate.before != candidate.id && visible(candidate.before) && column.items.includes(candidate.before) ? candidate.before : ''}
            }
        }
    }
    return {surface, selected: visible(activity.selected) ? activity.selected : '',
        cursor: activity.cursor && visible(activity.cursor.task) ? {...activity.cursor} : null, drag}
}

export function cleanActivity(activity: BoardActivity): BoardActivity {
    const text = (value: unknown) => typeof value == 'string' && value.length <= 200
    if (!activity || !text(activity.selected) || (activity.surface != null && !['tasks', 'canvas'].includes(activity.surface))) throw new Error('Invalid board activity')
    const cursor = activity.cursor
    if (cursor != null && (!text(cursor.task) || !Number.isFinite(cursor.x) || !Number.isFinite(cursor.y) || cursor.x < 0 || cursor.x > 1 || cursor.y < 0 || cursor.y > 1)) throw new Error('Invalid board point')
    const value = activity.drag
    let drag: tBoardDrag | null = null
    if (value != null) {
        if (!text(value.id) || !Number.isInteger(value.revision) || value.revision < 1 || !Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new Error('Invalid drag')
        if (value.kind == 'task' && text(value.col) && text(value.before) && Math.abs(value.x) <= 64 && Math.abs(value.y) <= 64) {
            drag = {kind: 'task', id: value.id, revision: value.revision, col: value.col, before: value.before, x: value.x, y: value.y}
        } else if (value.kind == 'note' && value.x >= 0 && value.y >= 0 && value.x <= CANVAS_SIZE.width && value.y <= CANVAS_SIZE.height) {
            drag = {kind: 'note', id: value.id, revision: value.revision, x: value.x, y: value.y}
        } else throw new Error('Invalid drag')
    }
    return {surface: activity.surface ?? 'tasks', selected: activity.selected, cursor: cursor ? {task: cursor.task, x: cursor.x, y: cursor.y} : null, drag}
}

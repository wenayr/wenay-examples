import {createHash} from 'node:crypto'
import {Command} from 'wenay-common2'
import {schemaCommand, type ServiceCommandCtx} from 'wenay-common2/service'
import {WORK_COLUMNS, type WorkTask, type TaskState} from './task-model'

export type TaskHost = {accounts: Record<string, {roles: string[]}>, organizer: TaskState}

type TaskSource = {id: string, label: string, kind?: NonNullable<WorkTask['source']>['kind']}

type TaskDeps<S> = {staffRoles: readonly string[], sources?: (state: S) => TaskSource[]}

// Дата срока должна существовать: 2026-02-30 разбирается, но нормализуется в другой день.
function realDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    if (!Number.isFinite(Date.parse(value))) return false
    return new Date(value).toISOString().slice(0, 10) == value
}

// Shared application behavior: the host supplies its already-authorized task scope.
export function createTaskCommands<S extends TaskHost>(deps: TaskDeps<S>) {
    const staff = deps.staffRoles

    function manage(roles: readonly string[]) {
        return roles.includes('manager') || roles.includes('owner')
    }
    function isStaff(roles: readonly string[]) {
        return roles.some(role => staff.includes(role))
    }
    // Свою задачу ведёт исполнитель или автор, чужую — только менеджер.
    function own(ctx: ServiceCommandCtx<S>, task: WorkTask) {
        if (manage(ctx.roles)) return true
        return task.assignee == ctx.account || task.createdBy == ctx.account
    }
    function editable(ctx: ServiceCommandCtx<S>, id: string, revision: number) {
        const task = ctx.state.organizer.tasks[id]
        if (!task || !own(ctx, task)) throw new Error('Нет доступа к задаче')
        if (task.automatic) throw new Error('Автоматическая задача обновляется из источника')
        if (task.revision != revision) {
            throw new Error('Задача уже изменена. Откройте свежую карточку и повторите действие')
        }
        return task
    }

    return {
        workSaveTask: schemaCommand({
            id: 'string', revision: 'number', title: 'string', description: 'string',
            assignee: 'string', due: 'string', priority: {enum: ['normal', 'high']},
            sourceId: 'string',
            checklist: {array: {object: {title: 'string', done: 'boolean'}}, optional: true}
        }, {
            allow: staff,
            validate(input) {
                if (!input.title.trim() || input.title.length > 160 || input.description.length > 3000) {
                    throw new Error('Название до 160 и описание до 3000 символов')
                }
                if (input.due && !realDate(input.due)) {
                    throw new Error('Укажите существующую дату срока')
                }
                if (!input.checklist) return
                const malformed = input.checklist.some(function bad(item) {
                    return !item.title.trim() || item.title.length > 200
                })
                if (input.checklist.length > 30 || malformed) {
                    throw new Error('До 30 пунктов проверки, каждый от 1 до 200 символов')
                }
            },
            apply(ctx: ServiceCommandCtx<S>, input) {
                const previous = input.id ? editable(ctx, input.id, input.revision) : null
                if (previous?.status == 'done') {
                    throw new Error('Верните задачу в работу перед редактированием результата')
                }
                const items = input.checklist ?? previous?.checklist ?? []
                const checklist = items.map(item => ({title: item.title.trim(), done: item.done}))
                if (input.assignee && !isStaff(ctx.state.accounts[input.assignee]?.roles ?? [])) {
                    throw new Error('Исполнитель должен быть сотрудником')
                }
                if (!manage(ctx.roles) && input.assignee != ctx.account) {
                    throw new Error('Назначать задачи другим может менеджер')
                }
                const known = deps.sources?.(ctx.state) ?? []
                const source = input.sourceId ? known.find(value => value.id == input.sourceId) : undefined
                if (input.sourceId && !source) throw new Error('Источник задачи недоступен')

                const receipt = Command.commandReceiptKey(ctx.account, ctx.requestId)
                const id = previous?.id ?? 'task-' + createHash('sha256').update(receipt).digest('hex')
                const completion = previous?.completedAt
                    ? {completedAt: previous.completedAt, completedBy: previous.completedBy}
                    : {}
                const origin = source
                    ? {source: {kind: source.kind ?? 'order', id: source.id, label: source.label}}
                    : {}
                const task: WorkTask = {
                    id,
                    title: input.title.trim(),
                    description: input.description.trim(),
                    assignee: input.assignee,
                    due: input.due,
                    priority: input.priority,
                    status: previous?.status ?? 'todo',
                    createdBy: previous?.createdBy ?? ctx.account,
                    revision: (previous?.revision ?? 0) + 1,
                    checklist,
                    ...completion,
                    ...origin
                }
                ctx.state.organizer.tasks[id] = task
                if (!previous) ctx.state.organizer.columns.todo.push(id)
                return {id, revision: task.revision}
            },
        }),
        workCheckTask: schemaCommand({
            id: 'string', revision: 'number', index: 'number', done: 'boolean'
        }, {
            allow: staff,
            apply(ctx: ServiceCommandCtx<S>, input) {
                const task = editable(ctx, input.id, input.revision)
                if (!Number.isInteger(input.index) || !task.checklist?.[input.index]) {
                    throw new Error('Пункт проверки не найден')
                }
                if (task.status == 'done') {
                    throw new Error('Верните задачу в работу перед изменением проверки')
                }
                task.checklist[input.index].done = input.done
                task.revision++
                return {id: task.id, revision: task.revision}
            },
        }),
        workMoveTask: schemaCommand({
            id: 'string', revision: 'number',
            status: {enum: ['todo', 'doing', 'done']}, beforeId: 'string'
        }, {
            allow: staff,
            apply(ctx: ServiceCommandCtx<S>, input) {
                const task = editable(ctx, input.id, input.revision)
                if (input.status == 'done' && task.checklist?.some(item => !item.done)) {
                    throw new Error('Отметьте все пункты проверки перед завершением задачи')
                }
                const work = ctx.state.organizer
                const misplaced = input.beforeId == task.id
                    || !work.columns[input.status].includes(input.beforeId)
                if (input.beforeId && misplaced) {
                    throw new Error('Порядок колонки изменился. Повторите перенос')
                }
                for (const column of WORK_COLUMNS) {
                    work.columns[column.key] = work.columns[column.key].filter(id => id != task.id)
                }
                const destination = work.columns[input.status]
                const at = input.beforeId ? destination.indexOf(input.beforeId) : destination.length
                destination.splice(at, 0, task.id)
                if (input.status == 'done' && task.status != 'done') {
                    task.completedAt = Date.now()
                    task.completedBy = ctx.account
                }
                if (input.status != 'done') {
                    delete task.completedAt
                    delete task.completedBy
                }
                task.status = input.status
                task.revision++
                return {id: task.id, revision: task.revision}
            },
        }),
    }
}

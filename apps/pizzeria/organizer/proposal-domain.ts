import {createHash} from 'node:crypto'
import {Command} from 'wenay-common2'
import {schemaCommand, type ServiceCommandCtx} from 'wenay-common2/service'
import type {WorkHost} from './domain'
import type {WorkTask} from './model'

// Дата срока должна существовать: 2026-02-30 разбирается, но нормализуется в другой день.
function realDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    if (!Number.isFinite(Date.parse(value))) return false
    return new Date(value).toISOString().slice(0, 10) == value
}

export function createProposalCommands<S extends WorkHost>(deps: {allow: readonly string[]}) {
    return {workApplyProposal: schemaCommand({proposal: 'string', items: {array: {object: {title: 'string', due: 'string', assignee: 'string'}}}}, {
        allow: deps.allow,
        validate(input) {
            if (!input.proposal || input.proposal.length > 200) throw new Error('Неизвестное предложение')
            if (!input.items.length || input.items.length > 10) throw new Error('Подтвердите от 1 до 10 задач')
            for (const item of input.items) {
                if (!item.title.trim() || item.title.length > 160) throw new Error('Название задачи: 1–160 символов')
                if (item.due && !realDate(item.due)) throw new Error('Уточните дату срока')
            }
        },
        apply(ctx: ServiceCommandCtx<S>, input) {
            const key = createHash('sha256').update(Command.commandReceiptKey(ctx.account, input.proposal)).digest('hex')
            const signature = JSON.stringify(input.items)
            const previous = ctx.state.organizer.proposals?.[key]
            if (previous) {
                if (previous.signature != signature) throw new Error('Это предложение уже подтверждено с другим содержимым')
                return {ids: previous.ids}
            }
            const manager = ctx.roles.includes('owner') || ctx.roles.includes('manager')
            const tasks = input.items.map((item, index): WorkTask => {
                if (!manager && item.assignee != ctx.account) throw new Error('Можно назначать задачи только себе')
                if (!ctx.state.accounts[item.assignee]?.roles.some(role => deps.allow.includes(role))) throw new Error('Выберите действующего сотрудника')
                const id = 'task-' + createHash('sha256').update(Command.commandReceiptKey(ctx.account, ctx.requestId) + ':' + index).digest('hex')
                return {
                    id,
                    ...item,
                    title: item.title.trim(),
                    description: 'Подтверждено из предложения',
                    priority: 'normal',
                    status: 'todo',
                    createdBy: ctx.account,
                    revision: 1,
                    checklist: []
                }
            })
            for (const task of tasks) {
                ctx.state.organizer.tasks[task.id] = task
                ctx.state.organizer.columns.todo.push(task.id)
            }
            ctx.state.organizer.proposals ??= {}
            ctx.state.organizer.proposals[key] = {ids: tasks.map(task => task.id), signature}
            return {ids: tasks.map(task => task.id)}
        },
    })}
}

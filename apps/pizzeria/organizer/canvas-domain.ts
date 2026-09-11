import {createHash} from 'node:crypto'
import {Command} from 'wenay-common2'
import {schemaCommand, type ServiceCommandCtx} from 'wenay-common2/service'
import {CANVAS_SIZE, NOTE_COLORS, emptyCanvas} from './canvas-model'
import type {WorkHost} from './domain'

export function createCanvasCommands<S extends WorkHost>(deps: {allow: readonly string[]}) {
    function canvas(ctx: ServiceCommandCtx<S>) {return ctx.state.organizer.canvas ??= emptyCanvas()}
    function note(ctx: ServiceCommandCtx<S>, id: string, revision: number) {
        const item = canvas(ctx).notes[id]
        if (!Object.hasOwn(canvas(ctx).notes, id) || !item) throw new Error('Заметка удалена или недоступна')
        if (item.revision != revision) throw new Error('Заметка уже изменена другим участником. Откройте свежую версию')
        return item
    }
    function dimensions(width: number, height: number) {
        const wide = Number.isInteger(width) && width >= 180 && width <= 420
        const tall = Number.isInteger(height) && height >= 120 && height <= 400
        if (!wide || !tall) throw new Error('Размер заметки: ширина 180–420, высота 120–400')
    }
    function position(x: number, y: number, width: number, height: number) {
        const placed = Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0
        const inside = x + width <= CANVAS_SIZE.width && y + height <= CANVAS_SIZE.height
        if (!placed || !inside) throw new Error('Заметка должна оставаться внутри доски')
    }
    return {
        canvasSave: schemaCommand({
            id: 'string',
            revision: 'number',
            text: 'string',
            color: {enum: NOTE_COLORS},
            width: 'number',
            height: 'number',
            x: 'number',
            y: 'number'
        }, {
            allow: deps.allow,
            apply(ctx: ServiceCommandCtx<S>, input) {
                if (!input.text.trim() || input.text.length > 2000) throw new Error('Текст заметки: от 1 до 2000 символов')
                dimensions(input.width, input.height)
                const board = canvas(ctx)
                const old = input.id ? note(ctx, input.id, input.revision) : null
                if (!old && Object.keys(board.notes).length >= 100) throw new Error('На этой доске можно разместить до 100 заметок')
                const x = old?.x ?? input.x, y = old?.y ?? input.y
                position(x, y, input.width, input.height)
                const id = old?.id ?? 'note-' + createHash('sha256').update(Command.commandReceiptKey(ctx.account, ctx.requestId)).digest('hex')
                board.notes[id] = {id, text: input.text.trim(), color: input.color, width: input.width, height: input.height,
                    x, y, revision: (old?.revision ?? 0) + 1, createdBy: old?.createdBy ?? ctx.account}
                return {id, revision: board.notes[id].revision}
            },
        }),
        canvasMove: schemaCommand({id: 'string', revision: 'number', x: 'number', y: 'number'}, {
            allow: deps.allow, apply(ctx: ServiceCommandCtx<S>, input) {
                const item = note(ctx, input.id, input.revision)
                position(input.x, input.y, item.width, item.height)
                item.x = input.x
                item.y = input.y
                item.revision++
                return {id: item.id, revision: item.revision}
            },
        }),
        canvasDelete: schemaCommand({id: 'string', revision: 'number'}, {
            allow: deps.allow, apply(ctx: ServiceCommandCtx<S>, input) {
                const item = note(ctx, input.id, input.revision)
                const board = canvas(ctx)
                delete board.notes[item.id]
                for (const link of Object.values(board.links)) if (link.from == item.id || link.to == item.id) delete board.links[link.id]
                return {id: item.id}
            },
        }),
        canvasConnect: schemaCommand({from: 'string', to: 'string'}, {
            allow: deps.allow, apply(ctx: ServiceCommandCtx<S>, input) {
                const board = canvas(ctx)
                const both = Object.hasOwn(board.notes, input.from) && Object.hasOwn(board.notes, input.to)
                if (input.from == input.to || !both) {
                    throw new Error('Выберите две существующие разные заметки')
                }
                const id = 'link-' + createHash('sha256').update(input.from + '\0' + input.to).digest('hex')
                if (!board.links[id] && Object.keys(board.links).length >= 300) throw new Error('На этой доске можно создать до 300 связей')
                board.links[id] = {id, from: input.from, to: input.to}
                return {id}
            },
        }),
        canvasUnlink: schemaCommand({id: 'string'}, {
            allow: deps.allow, apply(ctx: ServiceCommandCtx<S>, input) {
                delete canvas(ctx).links[input.id]
                return {id: input.id}
            },
        }),
    }
}

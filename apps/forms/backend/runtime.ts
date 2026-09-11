import {randomBytes, randomUUID} from 'node:crypto'
import path from 'node:path'
import {Command, createAsyncQueue} from 'wenay-common2'
import type {Store} from 'wenay-common2/observe'
import type {ServiceResourceContext} from 'wenay-common2/service'
import type {createServiceLeader} from 'wenay-common2/service/server'
import {createFormsService, formsDefinition} from './service'
import {formAccess, publicForm, hash, EDITORS} from './domain'
import {STAFF, type FormsState, type Answers} from './model'
import {createFormsExports} from './exports-resource'
import {createFormsGrouping} from './grouping-resource'

export type FormsLeader = ReturnType<typeof createServiceLeader<typeof formsDefinition>>
// Страница ответов: номер версии 0 означает «все», размер ограничен сотней.
function validPage(input: {version: number, offset: number, limit: number}) {
    if (!Number.isInteger(input.version) || input.version < 0) return false
    if (!Number.isInteger(input.offset) || input.offset < 0 || input.offset > 5000) return false
    return Number.isInteger(input.limit) && input.limit >= 1 && input.limit <= 100
}

export function createFormsRuntime(deps: {directory?: string, now?: () => number} = {}) {
    const service = createFormsService(deps), now = deps.now ?? Date.now
    const exports = createFormsExports({directory: deps.directory ?? path.resolve('forms-data', 'exports'), now})
    const grouping = createFormsGrouping({directory: path.join(deps.directory ?? path.resolve('forms-data', 'exports'), 'grouping'), now})
    let store: Store<FormsState> | null = null
    let corridor: FormsLeader['corridor'] | null = null
    const queue = createAsyncQueue(1)
    const editor = {allow: STAFF, placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        function active() {
            ctx.signal.throwIfAborted()
            if (!store || !corridor) throw new Error('Сервис закрыт')
        }
        function detail(input: {orgId: string, id: string}) {
            active()
            const {form} = formAccess(store!.state, ctx.principal.account, input.orgId, input.id)
            const {tokenHash, ...value} = form
            return {...value, fields: value.fields.map(field => ({...field, choices: [...field.choices]})),
                versions: value.versions.map(version => ({...version, fields: version.fields.map(field => ({...field, choices: [...field.choices]}))}))}
        }
        async function publish(input: {orgId: string, id: string, revision: number, requestId: string}) {
            if (queue.size >= 4) throw new Error('Очередь публикации заполнена')
            return queue.add(async function issuePublicLink() {
                active()
                formAccess(store!.state, ctx.principal.account, input.orgId, input.id, EDITORS)
                if (typeof input.requestId != 'string' || !input.requestId || input.requestId.length > 120) throw new Error('Некорректный requestId публикации')
                const publication = hash(Command.commandReceiptKey(ctx.principal.account, input.requestId))
                const previous = store!.state.publications?.[publication]
                if (previous) {
                    const same = previous.orgId == input.orgId
                        && previous.formId == input.id
                        && previous.revision == input.revision
                    if (!same) throw new Error('Запрос публикации уже использован с другими параметрами')
                    return {id: previous.formId, version: previous.version, token: null as string | null}
                }
                const token = randomBytes(32).toString('base64url')
                const result = await corridor!.system.formPublish('publish-' + publication, {
                    orgId: input.orgId,
                    id: input.id,
                    revision: input.revision,
                    actor: ctx.principal.account,
                    tokenHash: hash(token),
                    publication
                })
                active()
                formAccess(store!.state, ctx.principal.account, input.orgId, input.id, EDITORS)
                return {id: result.id, version: result.version, token: token as string | null}
            })
        }
        return {facade: {control: {detail, publish}}, close() {}}
    }}
    const publicform = {allow: ['respondent'], placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        function active() {
            ctx.signal.throwIfAborted()
            if (!store || !corridor) throw new Error('Сервис закрыт')
            return publicForm(store.state, ctx.principal.account)
        }
        function current() {
            const {form, version} = active()
            return {id: form.id, ...version, retentionDays: form.retentionDays, fields: version.fields.map(field => ({...field, choices: [...field.choices]}))}
        }
        async function submit(input: {version: number, nonce: string, answers: Answers}) {
            const {form} = active()
            const answersJson = JSON.stringify(input.answers)
            if (typeof answersJson != 'string' || Buffer.byteLength(answersJson) > 32768) throw new Error('Ответ до 32 KiB')
            return corridor!.fragment(ctx.principal.account).answerSubmit(randomUUID(), {
                formId: form.id,
                version: input.version,
                nonce: input.nonce,
                answersJson
            })
        }
        return {facade: {control: {current, submit}}, close() {}}
    }}
    const answers = {allow: STAFF, placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        function list(input: {orgId: string, formId: string, version: number, offset: number, limit: number}) {
            ctx.signal.throwIfAborted()
            if (!store) throw new Error('Сервис закрыт')
            const {form} = formAccess(store.state, ctx.principal.account, input.orgId, input.formId)
            if (!validPage(input)) {
                throw new Error('До 100 ответов на странице, version 0 означает все')
            }
            const live = Object.values(store.state.submissions).filter(function mine(value) {
                if (value.formId != form.id || value.expiresAt <= now()) return false
                return !input.version || value.version == input.version
            })
            const all = live.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
            const items = all.slice(input.offset, input.offset + input.limit).map(value => ({...value, answers: {...value.answers}}))
            const after = input.offset + items.length
            return {
                items,
                total: all.length,
                next: after < all.length ? after : null,
                answersRevision: form.answersRevision
            }
        }
        return {facade: {control: {list}}, close() {}}
    }}
    return {definition: {...service.definition, resources: {editor, publicform, answers, exports: exports.resource, grouping: grouping.resource}},
        mount(deps: {store: Store<FormsState>, corridor: FormsLeader['corridor']}) {
            store = deps.store
            corridor = deps.corridor
            const closeExports = exports.mount({store, execute: corridor.system})
            const closeGrouping = grouping.mount(store)
            return async function close() {
                closeGrouping()
                await closeExports()
                await queue.onIdle()
                store = null
                corridor = null
            }
        }}
}
export type FormsDefinition = ReturnType<typeof createFormsRuntime>['definition']

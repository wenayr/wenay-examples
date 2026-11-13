import {createHash, randomBytes, timingSafeEqual} from 'node:crypto'
import {Command, createAsyncQueue} from 'wenay-common2'
import {buildInputValidate, schemaCommand, SYSTEM_ACCOUNT, type ServiceCommandCtx, type ServiceResourceContext} from 'wenay-common2/service'
import type {Store} from 'wenay-common2/observe'
import {PRODUCT_SCOPES, type SupportState, type ProductKey} from './model'

type Ctx = ServiceCommandCtx<SupportState>
type IssueInput = {requestId: string, orgId: string, label: string, scopes: ProductKey['scopes'], days: number}
type OwnerAccess = (state: SupportState, account: string, orgId: string) => unknown
const issueInput = {requestId: 'string', orgId: 'string', label: 'string', scopes: {array: {enum: PRODUCT_SCOPES}}, days: 'number'} as const
const validateIssue = buildInputValidate(issueInput)

export function requireProductKey(state: SupportState, account: string, orgId?: string, at = Date.now()) {
    const id = account.startsWith('product:') ? account.slice(8) : ''
    const key = state.productKeys && Object.hasOwn(state.productKeys, id) ? state.productKeys[id] : undefined
    const live = !!key && !key.revokedAt && key.expiresAt > at
    const tenant = orgId == undefined || key?.orgId == orgId
    const placed = live && Object.hasOwn(state.organizations, key.orgId) && tenant
    if (!placed || !key.scopes.includes('knowledge:search')) throw new Error('Ключ поиска недействителен или не разрешает эту организацию')
    return key
}

export function productRoles(state: SupportState, account: string, at = Date.now()) {
    try {return [...requireProductKey(state, account, undefined, at).scopes]} catch {return []}
}

export function verifyProductSecret(state: SupportState, account: string, secret: string, at = Date.now()) {
    try {
        const key = requireProductKey(state, account, undefined, at)
        if (!/^[\w-]{43}$/.test(secret)) return false
        const actual = createHash('sha256').update(secret).digest()
        const expected = Buffer.from(key.hash, 'hex')
        return expected.length == actual.length && timingSafeEqual(actual, expected)
    } catch {return false}
}

export function createProductCredentials(deps: {now?: () => number, authorizeOwner: OwnerAccess}) {
    const now = deps.now ?? Date.now
    let store: Store<SupportState> | null = null
    const queue = createAsyncQueue(1)
    const commands = {
        productKeyRegister: schemaCommand({
            id: 'string', orgId: 'string', actor: 'string', label: 'string', hash: 'string',
            scopes: {array: {enum: PRODUCT_SCOPES}}, days: 'number'
        }, {allow: ['system'], apply(ctx: Ctx, input) {
            if (ctx.account != SYSTEM_ACCOUNT) throw new Error('Только сервер может зарегистрировать ключ')
            deps.authorizeOwner(ctx.state, input.actor, input.orgId)
            const hashed = /^[a-f0-9]{64}$/.test(input.id) && /^[a-f0-9]{64}$/.test(input.hash)
            const named = !!input.label.trim() && input.label.length <= 100
            const scoped = input.scopes.length == 1 && input.scopes[0] == 'knowledge:search'
            const bounded = Number.isInteger(input.days) && input.days >= 1 && input.days <= 90
            const valid = hashed && named && scoped && bounded
            if (!valid) throw new Error('Название до 100 символов, право поиска и срок от 1 до 90 дней')
            if (ctx.state.productKeys && Object.hasOwn(ctx.state.productKeys, input.id)) throw new Error('Запрос выпуска уже использован')
            if (Object.keys(ctx.state.productKeys ?? {}).length >= 100) throw new Error('До 100 ключей поиска на стенде')
            const at = now()
            ctx.state.productKeys ??= {}
            ctx.state.productKeys[input.id] = {
                id: input.id, orgId: input.orgId, label: input.label.trim(), hash: input.hash, scopes: [...input.scopes],
                createdBy: input.actor, createdAt: at, expiresAt: at + input.days * 86400_000, revokedAt: 0
            }
            return {id: input.id, expiresAt: at + input.days * 86400_000}
        }}),
        productKeyRevoke: schemaCommand({orgId: 'string', id: 'string'}, {allow: ['owner'], limit: {perMinute: 30}, apply(ctx: Ctx, input) {
            deps.authorizeOwner(ctx.state, ctx.account, input.orgId)
            const key = ctx.state.productKeys && Object.hasOwn(ctx.state.productKeys, input.id) ? ctx.state.productKeys[input.id] : undefined
            if (!key || key.orgId != input.orgId) throw new Error('Ключ недоступен')
            key.revokedAt ||= now()
            return {id: key.id}
        }})
    }
    type Register = (requestId: string, input: Parameters<typeof commands.productKeyRegister.apply>[1]) => Promise<unknown>
    let register: Register | undefined
    function authorized(ctx: ServiceResourceContext, orgId: string) {
        ctx.signal.throwIfAborted()
        if (!store) throw new Error('Ключи поиска отключены')
        deps.authorizeOwner(store.state, ctx.principal.account, orgId)
        return store.state
    }
    const resource = {allow: ['owner'], placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        function list(input: {orgId: string}) {
            const state = authorized(ctx, input.orgId)
            return Object.values(state.productKeys ?? {}).filter(key => key.orgId == input.orgId).map(({hash, ...key}) => ({...key, scopes: [...key.scopes]}))
        }
        async function issue(input: IssueInput) {
            if (queue.size >= 4) throw new Error('Очередь выпуска ключей заполнена')
            return queue.add(async function createKey() {
                const state = authorized(ctx, input.orgId)
                // Проверка той же публичной схемой, которая описывает сервисные команды.
                validateIssue(input)
                if (!input.requestId || input.requestId.length > 120) throw new Error('requestId: от 1 до 120 символов')
                if (!register) throw new Error('Регистрация ключей не подключена')
                const id = createHash('sha256').update(Command.commandReceiptKey(ctx.principal.account, input.requestId)).digest('hex')
                const old = state.productKeys && Object.hasOwn(state.productKeys, id) ? state.productKeys[id] : undefined
                if (old) {
                    const same = old.orgId == input.orgId && old.createdBy == ctx.principal.account && old.label == input.label.trim()
                    const duration = old.expiresAt - old.createdAt == input.days * 86400_000
                    if (!same || !duration || JSON.stringify(old.scopes) != JSON.stringify(input.scopes)) {
                        throw new Error('Запрос выпуска уже использован с другими параметрами')
                    }
                    return {id, account: 'product:' + id, secret: null as string | null, expiresAt: old.expiresAt}
                }
                const secret = randomBytes(32).toString('base64url')
                const hash = createHash('sha256').update(secret).digest('hex')
                await register('product-issue-' + id, {
                    id, orgId: input.orgId, actor: ctx.principal.account, label: input.label, scopes: input.scopes, days: input.days, hash
                })
                authorized(ctx, input.orgId)
                const created = store!.state.productKeys![id]
                return {id, account: 'product:' + id, secret: secret as string | null, expiresAt: created.expiresAt}
            })
        }
        return {facade: {control: {issue, list}}, close() {}}
    }}
    return {commands, resource, mount(deps: {store: Store<SupportState>, register?: Register}) {
        store = deps.store
        register = deps.register
        return function close() {
            store = null
            register = undefined
        }
    }}
}

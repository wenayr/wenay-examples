import {createHash, randomBytes, timingSafeEqual} from 'node:crypto'
import {Command, createAsyncQueue} from 'wenay-common2'
import {buildInputValidate, schemaCommand, SYSTEM_ACCOUNT, type ServiceCommandCtx, type ServiceResourceContext} from 'wenay-common2/service'
import type {Store} from 'wenay-common2/observe'
import {PRODUCT_SCOPES, type DocumentState} from './model'

const issueSchema = {requestId: 'string', orgId: 'string', label: 'string', scopes: {array: {enum: PRODUCT_SCOPES}}, days: 'number'} as const
const validateIssue = buildInputValidate(issueSchema)
const validateReference = buildInputValidate({orgId: 'string', id: 'string'})
type OwnerAccess = (state: DocumentState, account: string, orgId: string) => unknown

export function requireProductKey(state: DocumentState, account: string, orgId?: string, at = Date.now()) {
    const id = account.startsWith('product:') ? account.slice(8) : ''
    const key = state.productKeys && Object.hasOwn(state.productKeys, id) ? state.productKeys[id] : undefined
    const live = !!key && !key.revokedAt && key.expiresAt > at
    const tenant = orgId == undefined || key?.orgId == orgId
    const placed = live && tenant && Object.hasOwn(state.organizations, key.orgId)
    if (!placed || key.scopes.length != 1 || key.scopes[0] != 'documents:extract') throw new Error('Ключ извлечения недействителен для организации')
    return key
}

export function productRoles(state: DocumentState, account: string, at = Date.now()) {
    try {return [...requireProductKey(state, account, undefined, at).scopes]} catch {return []}
}

export function verifyProductSecret(state: DocumentState, account: string, secret: string, at = Date.now()) {
    try {
        const key = requireProductKey(state, account, undefined, at)
        if (!/^[\w-]{43}$/.test(secret)) return false
        const actual = createHash('sha256').update(secret).digest()
        const expected = Buffer.from(key.hash, 'hex')
        return actual.length == expected.length && timingSafeEqual(actual, expected)
    } catch {return false}
}

export function createProductCredentials(deps: {now?: () => number, authorizeOwner: OwnerAccess}) {
    const now = deps.now ?? Date.now
    const queue = createAsyncQueue(1)
    let store: Store<DocumentState> | null = null
    let generation = 0
    const commands = {
        productKeyRegister: schemaCommand({id: 'string', orgId: 'string', actor: 'string', label: 'string', hash: 'string',
            scopes: {array: {enum: PRODUCT_SCOPES}}, days: 'number'}, {allow: ['system'], apply(ctx: ServiceCommandCtx<DocumentState>, input) {
            if (ctx.account != SYSTEM_ACCOUNT) throw new Error('Внутренняя регистрация ключа')
            deps.authorizeOwner(ctx.state, input.actor, input.orgId)
            const hashed = /^[a-f0-9]{64}$/.test(input.id) && /^[a-f0-9]{64}$/.test(input.hash)
            const named = !!input.label.trim() && input.label.length <= 100
            const scoped = input.scopes.length == 1 && input.scopes[0] == 'documents:extract'
            const bounded = Number.isInteger(input.days) && input.days >= 1 && input.days <= 90
            const valid = hashed && named && scoped && bounded
            if (!valid) throw new Error('Название до 100 символов, право извлечения и срок 1–90 дней')
            if (Object.hasOwn(ctx.state.productKeys ?? {}, input.id)) throw new Error('Запрос выпуска уже использован')
            if (Object.keys(ctx.state.productKeys ?? {}).length >= 100) throw new Error('До 100 ключей на стенде, включая отозванные')
            const at = now()
            ctx.state.productKeys ??= {}
            ctx.state.productKeys[input.id] = {id: input.id, orgId: input.orgId, label: input.label.trim(), hash: input.hash,
                scopes: [...input.scopes], createdBy: input.actor, createdAt: at, expiresAt: at + input.days * 86400_000, revokedAt: 0}
            return {id: input.id}
        }}),
        productKeyRevoke: schemaCommand({orgId: 'string', id: 'string', actor: 'string'}, {
            allow: ['system'], apply(ctx: ServiceCommandCtx<DocumentState>, input) {
                if (ctx.account != SYSTEM_ACCOUNT) throw new Error('Внутренний отзыв ключа')
                deps.authorizeOwner(ctx.state, input.actor, input.orgId)
                const key = ctx.state.productKeys?.[input.id]
                if (!key || key.orgId != input.orgId) throw new Error('Ключ недоступен')
                key.revokedAt ||= now()
                return {id: key.id}
            }
        })
    }
    type Executor = {[K in keyof typeof commands]: (requestId: string, input: Parameters<typeof commands[K]['apply']>[1]) => Promise<unknown>}
    let execute: Executor | null = null
    const resource = {allow: ['owner'], placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        let closed = false
        const openedGeneration = generation
        const openedStore = store
        const openedExecute = execute
        function authorized(orgId: string) {
            ctx.signal.throwIfAborted()
            const mounted = openedGeneration == generation && openedStore == store && openedExecute == execute
            if (closed || !mounted) throw new Error('Ресурс ключей закрыт')
            if (!store || !execute) throw new Error('Ресурс ключей закрыт')
            deps.authorizeOwner(store.state, ctx.principal.account, orgId)
            return store.state
        }
        function list(input: {orgId: string}) {
            buildInputValidate({orgId: 'string'})(input)
            return Object.values(authorized(input.orgId).productKeys ?? {}).filter(key => key.orgId == input.orgId)
                .map(({hash, ...key}) => ({...key, scopes: [...key.scopes]}))
        }
        async function issue(input: import('wenay-common2/service').InferInput<typeof issueSchema>) {
            const deadline = AbortSignal.timeout(12000)
            validateIssue(input)
            input = {...input, scopes: [...input.scopes]}
            Object.freeze(input.scopes)
            Object.freeze(input)
            if (!input.requestId || input.requestId.length > 120) throw new Error('requestId: от 1 до 120 символов')
            if (queue.size >= 4) throw new Error('Очередь выпуска ключей заполнена')
            return queue.add(async function createKey() {
                deadline.throwIfAborted()
                const state = authorized(input.orgId)
                const id = createHash('sha256').update(Command.commandReceiptKey(ctx.principal.account, input.requestId)).digest('hex')
                const old = state.productKeys?.[id]
                if (old) {
                    const same = old.orgId == input.orgId && old.createdBy == ctx.principal.account && old.label == input.label.trim()
                    const duration = old.expiresAt - old.createdAt == input.days * 86400_000
                    if (!same || !duration || JSON.stringify(old.scopes) != JSON.stringify(input.scopes)) throw new Error('Изменены параметры повтора выпуска')
                    return {id, account: 'product:' + id, secret: null as string | null, expiresAt: old.expiresAt}
                }
                const secret = randomBytes(32).toString('base64url')
                const hash = createHash('sha256').update(secret).digest('hex')
                await execute!.productKeyRegister('product-issue-' + id, {id, orgId: input.orgId, actor: ctx.principal.account,
                    label: input.label, scopes: input.scopes, days: input.days, hash})
                deadline.throwIfAborted()
                const created = authorized(input.orgId).productKeys![id]
                if (created.createdBy != ctx.principal.account || created.hash != hash) throw new Error('Регистрация ключа изменилась')
                return {id, account: 'product:' + id, secret: secret as string | null, expiresAt: created.expiresAt}
            })
        }
        async function revoke(input: {orgId: string, id: string}) {
            const deadline = AbortSignal.timeout(12000)
            validateReference(input)
            input = Object.freeze({...input})
            authorized(input.orgId)
            const key = store!.state.productKeys?.[input.id]
            if (!key || key.orgId != input.orgId) throw new Error('Ключ недоступен')
            // Bound to the target, current owner is checked before native receipt and after its response.
            const request = 'product-revoke-' + createHash('sha256').update(JSON.stringify([ctx.principal.account, input.orgId, input.id])).digest('hex')
            await execute!.productKeyRevoke(request, {...input, actor: ctx.principal.account})
            deadline.throwIfAborted()
            const current = authorized(input.orgId).productKeys?.[input.id]
            if (!current || current.orgId != input.orgId || !current.revokedAt) throw new Error('Отзыв ключа не подтверждён')
            return {id: current.id}
        }
        return {facade: {control: {issue, list, revoke}}, close() {closed = true}}
    }}
    return {commands, resource, mount(input: {store: Store<DocumentState>, execute: Executor}) {
        const mountedGeneration = ++generation
        store = input.store
        execute = input.execute
        return function close() {
            if (mountedGeneration != generation) return
            generation++
            store = null
            execute = null
        }
    }}
}

import {createHash, timingSafeEqual} from 'node:crypto'
import {schemaCommand, type ServiceCommandCtx, type tServicePrincipal} from 'wenay-common2/service'
import {SCOPES, type MeteringState, type tScope, type UsageEvent, type UsagePeriod} from './model'
import {USAGE_INPUTS, type UsageReceipt} from './client-contract'

type Ctx = ServiceCommandCtx<MeteringState>
function own<T>(values: Record<string, T>, id: string) {return Object.hasOwn(values, id) ? values[id] : undefined}

export function organizationAccess(state: MeteringState, account: string, orgId: string, role?: 'owner') {
    const org = own(state.organizations, orgId)
    const member = org && own(org.members, account)
    const joined = !!org && !!member && !!own(state.accounts, account)
    const matched = !role || member == role
    if (!joined || !matched) throw new Error('Нет доступа к организации')
    return org
}

export function keyAccess(state: MeteringState, account: string, at: number, scope?: tScope) {
    const key = account.startsWith('key:') ? own(state.keys, account.slice(4)) : undefined
    const live = !!key && !key.revokedAt && key.expiresAt > at
    const placed = live && !!own(state.organizations, key.orgId)
    const permitted = !scope || (!!key && key.scopes.includes(scope))
    if (!placed || !permitted) throw new Error('API-ключ недействителен или не имеет нужного права')
    return key
}

export function verifyApiSecret(state: MeteringState, account: string, secret: string, at: number) {
    try {
        const key = keyAccess(state, account, at)
        if (!/^[\w-]{43}$/.test(secret)) return false
        const actual = createHash('sha256').update(secret).digest()
        const expected = Buffer.from(key.hash, 'hex')
        return expected.length == actual.length && timingSafeEqual(actual, expected)
    } catch {return false}
}

export function meteringRoles(state: MeteringState, account: string, at = Date.now()) {
    if (account.startsWith('key:')) {
        try {return ['apiKey', ...keyAccess(state, account, at).scopes]} catch {return []}
    }
    return own(state.accounts, account) ? ['signedIn', ...new Set(Object.values(state.organizations).flatMap(org => own(org.members, account) ?? []))] : []
}

export function meteringWorkspace(state: MeteringState, principal: tServicePrincipal | null, at = Date.now()) {
    const account = principal?.account ?? ''
    const person = own(state.accounts, account)
    const organizations: {id: string, name: string, role: 'owner' | 'auditor' | 'api', monthlyUnits: number, concurrent: number}[] = []
    if (person) {
        for (const org of Object.values(state.organizations)) {
            const role = own(org.members, account)
            if (role) organizations.push({id: org.id, name: org.name, role, monthlyUnits: org.monthlyUnits, concurrent: org.concurrent})
        }
    } else {
        try {
            const key = keyAccess(state, account, at, 'usage:read')
            const org = state.organizations[key.orgId]
            organizations.push({id: org.id, name: org.name, role: 'api', monthlyUnits: org.monthlyUnits, concurrent: org.concurrent})
        } catch {}
    }
    const orgIds = new Set(organizations.map(org => org.id))
    return {
        account: {account: person?.account ?? account, name: person?.name ?? 'API'}, organizations,
        currentPeriod: new Date(at).toISOString().slice(0, 7),
        keys: person ? Object.values(state.keys).filter(key => orgIds.has(key.orgId)).map(({hash, ...key}) => ({...key, scopes: [...key.scopes]})) : [],
        periods: Object.values(state.periods).filter(period => orgIds.has(period.orgId)).map(period => ({...period})),
        events: Object.values(state.events).filter(event => orgIds.has(event.orgId)).map(({signature, ...event}) => ({...event})),
        audit: person ? state.audit.filter(entry => orgIds.has(entry.orgId)).map(entry => ({...entry})) : []
    }
}
export type MeteringWorkspace = ReturnType<typeof meteringWorkspace>

function units(value: number, allowZero = false) {
    const least = allowZero ? 0 : 1
    const inRange = Number.isSafeInteger(value) && value >= least && value <= 10000
    if (!inRange) throw new Error('Количество единиц должно быть целым числом от ' + least + ' до 10000')
}
export function eventKey(orgId: string, eventId: string) {
    if (!/^[\w:.-]{1,120}$/.test(eventId)) throw new Error('eventId: до 120 букв, цифр, точек, двоеточий и дефисов')
    return createHash('sha256').update(JSON.stringify([orgId, eventId])).digest('hex')
}

function receipt(event: UsageEvent, fresh: boolean) {
    return {id: event.id, eventId: event.eventId, orgId: event.orgId, status: event.status, period: event.period,
        units: event.units, reservedUnits: event.reservedUnits, fresh} satisfies UsageReceipt
}

export function createMeteringDomain(deps: {now?: () => number} = {}) {
    const now = deps.now ?? Date.now
    function audit(ctx: Ctx, orgId: string, action: string, id: string, at: number, actor = ctx.account) {
        ctx.state.audit.push({orgId, actor, action, id, at})
        if (ctx.state.audit.length > 1000) ctx.state.audit.splice(0, ctx.state.audit.length - 1000)
    }
    function eventFor(ctx: Ctx, eventId: string, at: number) {
        const key = keyAccess(ctx.state, ctx.account, at, 'usage:write')
        const event = own(ctx.state.events, eventKey(key.orgId, eventId))
        if (!event) throw new Error('Событие не найдено в организации ключа')
        return event
    }
    function record(ctx: Ctx, input: {eventId: string, metric: 'search' | 'document', units: number, reference: string}, reserve: boolean) {
        const at = now()
        const key = keyAccess(ctx.state, ctx.account, at, 'usage:write')
        units(input.units)
        if (input.reference.length > 200) throw new Error('Ссылка на источник до 200 символов')
        const id = eventKey(key.orgId, input.eventId)
        const signature = JSON.stringify([input.metric, input.units, input.reference, reserve])
        const previous = own(ctx.state.events, id)
        if (previous) {
            if (previous.signature != signature) throw new Error('eventId уже использован для другого содержимого')
            return receipt(previous, false)
        }
        if (Object.keys(ctx.state.events).length >= 5000) throw new Error('Журнал примера достиг 5000 событий; требуется архивирование')
        const org = ctx.state.organizations[key.orgId]
        if (ctx.state.subscriptions?.[org.id]?.status == 'cancelled') throw new Error('Тестовая подписка отключена; новые операции недоступны')
        const period = new Date(at).toISOString().slice(0, 7)
        const periodId = key.orgId + ':' + period
        const totals: UsagePeriod = own(ctx.state.periods, periodId) ?? {orgId: key.orgId, period, used: 0, reserved: 0, active: 0}
        if (totals.used + totals.reserved + input.units > org.monthlyUnits) throw new Error('Недостаточно доступной квоты периода')
        const active = Object.values(ctx.state.periods).filter(value => value.orgId == org.id).reduce((sum, value) => sum + value.active, 0)
        if (reserve && active >= org.concurrent) throw new Error('Достигнут предел параллельных операций')
        const event: UsageEvent = {id, eventId: input.eventId, orgId: key.orgId, keyId: key.id, metric: input.metric, reference: input.reference, period,
            units: reserve ? 0 : input.units,
            reservedUnits: reserve ? input.units : 0,
            signature,
            status: reserve ? 'reserved' : 'committed',
            reason: '', createdAt: at, updatedAt: at}
        if (reserve) {
            totals.reserved += input.units
            totals.active++
        }
        else totals.used += input.units
        ctx.state.periods[periodId] = {...totals}
        ctx.state.events[id] = event
        audit(ctx, key.orgId, reserve ? 'usage.reserve' : 'usage.record', id, at)
        return receipt(event, true)
    }
    function workspace(state: MeteringState, principal: tServicePrincipal | null) {
        return meteringWorkspace(state, principal, now())
    }
    return {commands: {
        keyRegister: schemaCommand({
            id: 'string', orgId: 'string', actor: 'string', label: 'string',
            hash: 'string', scopes: {array: {enum: SCOPES}}, days: 'number'
        }, {
            allow: ['system'], apply(ctx: Ctx, input) {
                if (ctx.account != 'system') throw new Error('Внутренняя операция')
                organizationAccess(ctx.state, input.actor, input.orgId, 'owner')
                const hashed = /^[a-f0-9]{64}$/.test(input.id) && /^[a-f0-9]{64}$/.test(input.hash)
                const named = !!input.label.trim() && input.label.length <= 100
                const unique = new Set(input.scopes).size == input.scopes.length
                const scoped = input.scopes.length >= 1 && input.scopes.length <= 2 && unique
                if (!hashed || !named || !scoped) throw new Error('Проверьте название, права и данные ключа')
                if (!Number.isInteger(input.days) || input.days < 1 || input.days > 90) throw new Error('Ключ действует от 1 до 90 дней')
                if (own(ctx.state.keys, input.id)) throw new Error('Этот запрос выпуска уже использован')
                if (Object.keys(ctx.state.keys).length >= 100) throw new Error('До 100 ключей на стенде')
                const at = now()
                const key = {
                    id: input.id, orgId: input.orgId, label: input.label.trim(), hash: input.hash,
                    scopes: [...input.scopes], createdBy: input.actor, createdAt: at,
                    expiresAt: at + input.days * 86400_000, revokedAt: 0
                }
                ctx.state.keys[key.id] = key
                audit(ctx, input.orgId, 'key.issue', key.id, at, input.actor)
                return {id: key.id, expiresAt: key.expiresAt}
            }
        }),
        keyRevoke: schemaCommand({orgId: 'string', id: 'string'}, {
            allow: ['owner'], limit: {perMinute: 30}, apply(ctx: Ctx, input) {
                organizationAccess(ctx.state, ctx.account, input.orgId, 'owner')
                const key = own(ctx.state.keys, input.id)
                if (!key || key.orgId != input.orgId) throw new Error('Ключ недоступен')
                key.revokedAt ||= now()
                audit(ctx, input.orgId, 'key.revoke', key.id, now())
                return {id: key.id}
            }
        }),
        budgetConfigure: schemaCommand({orgId: 'string', monthlyUnits: 'number', concurrent: 'number'}, {
            allow: ['owner'], limit: {perMinute: 30}, apply(ctx: Ctx, input) {
                const org = organizationAccess(ctx.state, ctx.account, input.orgId, 'owner')
                units(input.monthlyUnits)
                if (!Number.isInteger(input.concurrent) || input.concurrent < 1 || input.concurrent > 20) throw new Error('Параллельных операций от 1 до 20')
                const at = now(), period = new Date(at).toISOString().slice(0, 7)
                const totals = ctx.state.periods[org.id + ':' + period]
                const active = Object.values(ctx.state.periods).filter(value => value.orgId == org.id).reduce((sum, value) => sum + value.active, 0)
                const spent = !!totals && totals.used + totals.reserved > input.monthlyUnits
                if (spent || active > input.concurrent) throw new Error('Новый лимит меньше уже использованной или зарезервированной квоты')
                org.monthlyUnits = input.monthlyUnits
                org.concurrent = input.concurrent
                audit(ctx, input.orgId, 'budget.configure', org.id, at)
                return {ok: true}
            }
        }),
        usageRecord: schemaCommand(USAGE_INPUTS.usageRecord, {
            allow: ['usage:write'], limit: {perMinute: 120}, apply(ctx: Ctx, input) {return record(ctx, input, false)}
        }),
        usageReserve: schemaCommand(USAGE_INPUTS.usageReserve, {
            allow: ['usage:write'], limit: {perMinute: 120}, apply(ctx: Ctx, input) {return record(ctx, input, true)}
        }),
        usageSettle: schemaCommand(USAGE_INPUTS.usageSettle, {
            allow: ['usage:write'], limit: {perMinute: 120}, apply(ctx: Ctx, input) {
                const at = now(), event = eventFor(ctx, input.eventId, at)
                units(input.units, true)
                if (event.status == 'committed') {
                    if (event.units != input.units) throw new Error('Событие уже завершено с другим количеством единиц')
                    return receipt(event, false)
                }
                if (!['reserved', 'unknown'].includes(event.status)) throw new Error('Резерв уже освобождён')
                if (input.units > event.reservedUnits) throw new Error('Фактический расход превышает предварительный резерв')
                const totals = ctx.state.periods[event.orgId + ':' + event.period]
                totals.reserved -= event.reservedUnits
                totals.active--
                totals.used += input.units
                event.status = 'committed'
                event.units = input.units
                event.updatedAt = at
                audit(ctx, event.orgId, 'usage.settle', event.id, at)
                return receipt(event, true)
            }
        }),
        usageRelease: schemaCommand(USAGE_INPUTS.usageRelease, {
            allow: ['usage:write'], limit: {perMinute: 120}, apply(ctx: Ctx, input) {
                const at = now(), event = eventFor(ctx, input.eventId, at)
                if (!input.reason.trim() || input.reason.length > 300) throw new Error('Укажите причину освобождения до 300 символов')
                if (event.status == 'released') return receipt(event, false)
                if (!['reserved', 'unknown'].includes(event.status)) throw new Error('Учтённое потребление нельзя освободить')
                const totals = ctx.state.periods[event.orgId + ':' + event.period]
                totals.reserved -= event.reservedUnits
                totals.active--
                event.status = 'released'
                event.reason = input.reason.trim()
                event.updatedAt = at
                audit(ctx, event.orgId, 'usage.release', event.id, at)
                return receipt(event, true)
            }
        }),
        usageUncertain: schemaCommand(USAGE_INPUTS.usageUncertain, {
            allow: ['usage:write'], limit: {perMinute: 120}, apply(ctx: Ctx, input) {
                const at = now(), event = eventFor(ctx, input.eventId, at)
                if (!input.reason.trim() || input.reason.length > 300) throw new Error('Укажите причину неопределённости до 300 символов')
                if (!['reserved', 'unknown'].includes(event.status)) throw new Error('Операция уже завершена')
                if (event.status == 'unknown' && event.reason == input.reason.trim()) return receipt(event, false)
                event.status = 'unknown'
                event.reason = input.reason.trim()
                event.updatedAt = at
                audit(ctx, event.orgId, 'usage.unknown', event.id, at)
                return receipt(event, true)
            }
        })
    }, views: {workspace: {allow: ['owner', 'auditor'], project: workspace}}}
}

import {createHash} from 'node:crypto'
import {schemaCommand, type ServiceCommandCtx, type tServicePrincipal} from 'wenay-common2/service'
import {ROLES, type Booking, type BookingState, type Offering, type Receipt, type Resource} from './model'
import {remaining, slotFor, validateResource} from './schedule'

type Ctx = ServiceCommandCtx<BookingState>
const STAFF = ['owner', 'staff'] as const
function own<T>(values: Record<string, T>, id: string) {return Object.hasOwn(values, id) ? values[id] : undefined}
export function organizationAccess(state: BookingState, account: string, orgId: string, roles: readonly string[] = ROLES) {
    const org = own(state.organizations, orgId), role = org && own(org.members, account)
    const known = !!own(state.accounts, account)
    const allowed = !!role && roles.includes(role)
    if (!known || !org || !allowed) throw new Error('Нет доступа к организации')
    return {org, role}
}
export function bookingRoles(state: BookingState, account: string) {
    return own(state.accounts, account) ? ['account', ...new Set(Object.values(state.organizations).flatMap(org => own(org.members, account) ?? []))] : []
}
export function bookingAccess(state: BookingState, account: string, orgId: string, id: string) {
    const access = organizationAccess(state, account, orgId), booking = own(state.bookings, id)
    const inside = !!booking && booking.orgId == orgId
    const mine = access.role != 'customer' || booking?.customer == account
    if (!inside || !mine) throw new Error('Бронь недоступна')
    return booking
}
function text(value: string, max: number, required = true) {
    const clean = value.trim()
    if (clean.length > max || required && !clean) throw new Error('Проверьте длину текста: до ' + max + ' символов')
    return clean
}
function revision(value: {revision: number}, expected: number) {
    if (!Number.isSafeInteger(expected) || value.revision != expected) throw new Error('Запись уже изменена. Обновите версию')
}
function hash(...parts: unknown[]) {return createHash('sha256').update(JSON.stringify(parts)).digest('hex')}
function canonical(value: unknown): string {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
    if (value && typeof value == 'object') {
        const entries = Object.keys(value).sort().map(function pair(key) {
            return JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])
        })
        return '{' + entries.join(',') + '}'
    }
    return JSON.stringify(value)
}
function receipt(value: {id: string, revision?: number, status?: string}): Receipt {
    return {id: value.id, revision: value.revision ?? 0, status: value.status ?? 'saved', fresh: true}
}
function intent(ctx: Ctx, kind: string, input: {orgId: string, key: string}, apply: (id: string) => Receipt) {
    organizationAccess(ctx.state, ctx.account, input.orgId)
    text(input.key, 120)
    const id = hash(ctx.account, input.orgId, kind, input.key), signature = canonical(input), old = own(ctx.state.intents, id)
    if (old) {
        if (old.signature != signature) throw new Error('Ключ повтора использован с другими параметрами')
        return {...old.result, fresh: false}
    }
    if (Object.keys(ctx.state.intents).length >= 4000) throw new Error('Достигнут предел 4000 намерений стенда')
    const result = apply(id)
    ctx.state.intents[id] = {signature, result}
    return result
}
function serviceAccess(state: BookingState, orgId: string, id: string) {
    const service = own(state.services, id)
    if (!service || service.orgId != orgId) throw new Error('Услуга недоступна')
    return service
}
function audit(ctx: Ctx, orgId: string, action: string, target: string, at: number) {
    ctx.state.audit.push({id: hash(ctx.account, ctx.requestId, action), orgId, actor: ctx.account, action, target, at})
    if (ctx.state.audit.length > 2000) ctx.state.audit.splice(0, ctx.state.audit.length - 2000)
}
function reminders(state: BookingState, booking: Booking, at: number) {
    for (const notice of Object.values(state.notices)) if (notice.bookingId == booking.id && notice.status == 'pending') notice.status = 'cancelled'
    if (!booking.reminder || booking.status != 'confirmed') return
    const id = hash('reminder', booking.id, booking.revision)
    const zone = state.resources[booking.resourceId]?.zone ?? 'UTC'
    const shown = {
        timeZone: zone, day: 'numeric', month: 'long',
        hour: '2-digit', minute: '2-digit', timeZoneName: 'shortOffset'
    } as const
    const local = new Intl.DateTimeFormat('ru-RU', shown).format(booking.start)
    state.notices[id] = {id, orgId: booking.orgId, customer: booking.customer, bookingId: booking.id, revision: booking.revision,
        dueAt: Math.max(at, booking.start - 3600000), status: 'pending', body: 'Скоро ваша встреча: ' + local + ' · ' + zone, deliveredAt: 0}
}
type NewBooking = {id: string, customer: string, start: number, partySize: number, note: string, reminder: boolean}

function newBooking(state: BookingState, service: Offering, input: NewBooking, at: number, holdMs: number) {
    if (Object.keys(state.bookings).length >= 2000) throw new Error('Достигнут предел 2000 броней стенда')
    const slot = slotFor(state, service, input.start, input.partySize, at)
    const booking: Booking = {id: input.id, orgId: service.orgId, serviceId: service.id, resourceId: service.resourceId, customer: input.customer,
        partySize: input.partySize, start: slot.start, end: slot.end, occupiedFrom: slot.occupiedFrom, occupiedTo: slot.occupiedTo,
        status: 'held', holdUntil: Math.min(at + holdMs, slot.start), revision: 1, createdAt: at, updatedAt: at, note: input.note,
        reminder: input.reminder, depositUnits: service.depositUnits, deposit: service.depositUnits ? 'pending' : 'none'}
    state.bookings[booking.id] = booking
    return booking
}
function change(booking: Booking, at: number) {
    booking.revision++
    booking.updatedAt = at
}

// Клиент видит сотрудников и себя, но не других клиентов организации.
function visibleMembers(state: BookingState, orgId: string, account: string, staff: Set<string>) {
    return Object.entries(state.organizations[orgId].members).filter(function shown([id, role]) {
        return staff.has(orgId) || id == account || role != 'customer'
    })
}

export function bookingWorkspace(state: BookingState, principal: tServicePrincipal | null) {
    const account = principal?.account ?? ''
    const known = !!own(state.accounts, account)
    const member = Object.values(state.organizations).filter(org => known && !!own(org.members, account))
    const organizations = member.map(org => ({id: org.id, name: org.name, role: org.members[account]}))
    const orgIds = new Set(organizations.map(org => org.id))
    const staff = new Set(organizations.filter(org => org.role != 'customer').map(org => org.id))
    function visible(entry: {orgId: string, customer: string}) {return orgIds.has(entry.orgId) && (staff.has(entry.orgId) || entry.customer == account)}
    return {account: {account, name: own(state.accounts, account)?.name ?? ''}, organizations,
        people: organizations.flatMap(org => visibleMembers(state, org.id, account, staff).map(([id, role]) => ({
            orgId: org.id, account: id, name: state.accounts[id]?.name ?? id, role
        }))),
        resources: Object.values(state.resources).filter(value => orgIds.has(value.orgId)).map(value => ({
            ...value, weekly: value.weekly.map(item => ({...item})), exceptions: value.exceptions.map(item => ({
                ...item, windows: item.windows.map(window => ({...window}))
            }))
        })),
        services: Object.values(state.services).filter(value => orgIds.has(value.orgId) && (value.active || staff.has(value.orgId))).map(value => ({...value})),
        bookings: Object.values(state.bookings).filter(visible).map(value => ({...value})),
        waitlist: Object.values(state.waitlist).filter(visible).map(value => ({...value})),
        notices: Object.values(state.notices).filter(visible).map(value => ({...value})),
        audit: state.audit.filter(value => staff.has(value.orgId)).map(value => ({...value}))}
}
export type BookingWorkspace = ReturnType<typeof bookingWorkspace>

export function createBookingDomain(deps: {now?: () => number, holdMs?: number} = {}) {
    const now = deps.now ?? Date.now, holdMs = deps.holdMs ?? 300000
    if (!Number.isSafeInteger(holdMs) || holdMs < 10 || holdMs > 900000) throw new Error('Hold TTL must be between 10ms and 15min')
    const bookingInput = {orgId: 'string', id: 'string', revision: 'number', key: 'string'} as const
    function move(ctx: Ctx, input: {orgId: string, id: string, revision: number, key: string, start: number, serviceId?: string}, preserveTerms: boolean) {
        const booking = bookingAccess(ctx.state, ctx.account, input.orgId, input.id)
        const kind = preserveTerms ? 'reschedule' : 'move'
        return intent(ctx, kind, input, function applyMove() {
            revision(booking, input.revision)
            const at = now()
            if (booking.status != 'confirmed' || booking.start <= at) throw new Error('Перенести можно будущую подтверждённую бронь')
            const service = serviceAccess(ctx.state, input.orgId, preserveTerms ? input.serviceId ?? '' : booking.serviceId)
            if (preserveTerms && service.duration * 60000 != booking.end - booking.start) {
                throw new Error('Длительность новой услуги должна совпадать с сохранённой длительностью брони')
            }
            if (preserveTerms && service.depositUnits != booking.depositUnits) {
                throw new Error('Депозит новой услуги должен совпадать с сохранённым депозитом брони')
            }
            const slot = slotFor(ctx.state, service, input.start, booking.partySize, at, booking.id)
            // Resource, service and interval change together after all target checks.
            booking.serviceId = service.id
            booking.resourceId = service.resourceId
            booking.start = slot.start
            booking.end = slot.end
            booking.occupiedFrom = slot.occupiedFrom
            booking.occupiedTo = slot.occupiedTo
            change(booking, at)
            reminders(ctx.state, booking, at)
            audit(ctx, input.orgId, 'booking.' + kind, booking.id, at)
            return receipt(booking)
        })
    }
    function sweep(ctx: Ctx) {
        if (ctx.account != 'system') throw new Error('Внутренняя операция')
        const at = now()
        for (const booking of Object.values(ctx.state.bookings)) if (booking.status == 'held' && booking.holdUntil <= at) {
            booking.status = 'expired'
            change(booking, at)
            if (booking.deposit == 'paid') booking.deposit = 'refundDue'
            reminders(ctx.state, booking, at)
        }
        for (const entry of Object.values(ctx.state.waitlist)) {
            if (entry.status == 'offered' && ['expired', 'cancelled'].includes(ctx.state.bookings[entry.offerId]?.status ?? '')) {
                entry.status = 'expired'
                entry.updatedAt = at
            }
            if (entry.status == 'waiting' && entry.start <= at) {
                entry.status = 'expired'
                entry.updatedAt = at
            }
        }
        const waiting = Object.values(ctx.state.waitlist).filter(entry => entry.status == 'waiting')
        waiting.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
        for (const entry of waiting) {
            const service = own(ctx.state.services, entry.serviceId)
            if (!service || !own(ctx.state.organizations[entry.orgId].members, entry.customer)) continue
            try {
                const offered = {
                    id: hash('offer', entry.id), customer: entry.customer, start: entry.start,
                    partySize: entry.partySize, note: 'Предложение из листа ожидания', reminder: true
                }
                const booking = newBooking(ctx.state, service, offered, at, holdMs)
                entry.status = 'offered'
                entry.offerId = booking.id
                entry.updatedAt = at
                audit(ctx, entry.orgId, 'wait.offer', entry.id, at)
            } catch { /* A waiting entry never removes an existing booking when capacity is unavailable. */ }
        }
        for (const notice of Object.values(ctx.state.notices)) if (notice.status == 'pending' && notice.dueAt <= at) {
            const booking = ctx.state.bookings[notice.bookingId]
            if (booking?.status != 'confirmed' || booking.revision != notice.revision || !booking.reminder) notice.status = 'cancelled'
            else {
                notice.status = 'delivered'
                notice.deliveredAt = at
            }
        }
        return {ok: true}
    }
    return {commands: {
        resourceSave: schemaCommand({
            orgId: 'string', id: 'string', revision: 'number', name: 'string',
            staff: 'string', zone: 'string', capacity: 'number',
            weekly: {array: {object: {day: 'number', start: 'string', end: 'string'}}},
            exceptions: {array: {object: {
                date: 'string', windows: {array: {object: {start: 'string', end: 'string'}}}
            }}}
        }, {allow: STAFF, apply(ctx: Ctx, input) {
            const {org, role} = organizationAccess(ctx.state, ctx.account, input.orgId, STAFF)
            const old = own(ctx.state.resources, input.id)
            if (old && old.orgId != input.orgId) throw new Error('Ресурс недоступен')
            const ownSchedule = input.staff == ctx.account && (!old || old.staff == ctx.account)
            if (role != 'owner' && !ownSchedule) throw new Error('Можно изменять только своё расписание')
            if (!STAFF.includes(org.members[input.staff] as typeof STAFF[number])) throw new Error('Исполнитель не состоит в команде')
            if (old) revision(old, input.revision)
            else if (input.id || input.revision != 0 || Object.keys(ctx.state.resources).length >= 50) {
                throw new Error('Новый ресурс: пустой id, revision 0; не более 50 ресурсов')
            }
            const value: Resource = {
                ...input, id: old?.id ?? hash('resource', ctx.account, ctx.requestId), name: text(input.name, 100), revision: (old?.revision ?? 0) + 1
            }
            validateResource(value)
            if (old && remaining(ctx.state, value, now(), Infinity, now()) < 0) throw new Error('Новая вместимость меньше существующих броней')
            function oversized(service: {resourceId: string, capacity: number}) {
                return service.resourceId == value.id && service.capacity > value.capacity
            }
            if (Object.values(ctx.state.services).some(oversized)) throw new Error('Вместимость ниже числа участников услуги')
            ctx.state.resources[value.id] = value
            audit(ctx, input.orgId, 'resource.save', value.id, now())
            return receipt(value)
        }}),
        serviceSave: schemaCommand({
            orgId: 'string', id: 'string', revision: 'number', resourceId: 'string',
            name: 'string', description: 'string', duration: 'number', before: 'number',
            after: 'number', capacity: 'number', depositUnits: 'number', active: 'boolean'
        }, {allow: STAFF, apply(ctx: Ctx, input) {
            const {role} = organizationAccess(ctx.state, ctx.account, input.orgId, STAFF)
            const resource = own(ctx.state.resources, input.resourceId)
            const old = own(ctx.state.services, input.id)
            const placed = !!resource && resource.orgId == input.orgId
            if (!placed || (old && old.orgId != input.orgId)) throw new Error('Ресурс или услуга недоступны')
            const heldBefore = !old || ctx.state.resources[old.resourceId].staff == ctx.account
            const ownService = resource.staff == ctx.account && heldBefore
            if (role != 'owner' && !ownService) throw new Error('Можно изменять только свои услуги')
            if (old) revision(old, input.revision)
            else if (input.id || input.revision != 0 || Object.keys(ctx.state.services).length >= 100) {
                throw new Error('Новая услуга: пустой id, revision 0; до 100 услуг')
            }
            const limits = [['duration', 480], ['before', 120], ['after', 120], ['depositUnits', 10000]] as const
            for (const [key, max] of limits) {
                const least = key == 'duration' ? 15 : 0
                const inRange = Number.isInteger(input[key]) && input[key] >= least && input[key] <= max
                if (!inRange) throw new Error('Недопустимая длительность, буфер или депозит')
            }
            const fits = Number.isInteger(input.capacity) && input.capacity >= 1 && input.capacity <= resource.capacity
            if (!fits) throw new Error('Число участников превышает вместимость ресурса')
            const value = {
                ...input,
                id: old?.id ?? hash('service', ctx.account, ctx.requestId),
                name: text(input.name, 100),
                description: text(input.description, 1000, false),
                revision: (old?.revision ?? 0) + 1
            }
            ctx.state.services[value.id] = value
            audit(ctx, input.orgId, 'service.save', value.id, now())
            return receipt(value)
        }}),
        bookingHold: schemaCommand({
            orgId: 'string', key: 'string', serviceId: 'string', start: 'number',
            partySize: 'number', customer: 'string', note: 'string', reminder: 'boolean'
        }, {allow: ROLES, apply(ctx: Ctx, input) {
            const {org, role} = organizationAccess(ctx.state, ctx.account, input.orgId), customer = input.customer || ctx.account
            if (!own(org.members, customer) || role == 'customer' && customer != ctx.account) throw new Error('Нельзя записать этого клиента')
            return intent(ctx, 'hold', input, function hold(id) {
                const service = serviceAccess(ctx.state, input.orgId, input.serviceId)
                const requested = {...input, id, customer, note: text(input.note, 1000, false)}
                const booking = newBooking(ctx.state, service, requested, now(), holdMs)
                audit(ctx, input.orgId, 'booking.hold', id, now())
                return receipt(booking)
            })
        }}),
        bookingConfirm: schemaCommand(bookingInput, {allow: ROLES, apply(ctx: Ctx, input) {
            const booking = bookingAccess(ctx.state, ctx.account, input.orgId, input.id)
            return intent(ctx, 'confirm', input, function confirm() {
                revision(booking, input.revision)
                if (booking.status != 'held' || booking.holdUntil <= now()) throw new Error('Временная бронь истекла или уже завершена')
                if (!['none', 'paid'].includes(booking.deposit)) throw new Error('Сначала завершите тестовый депозит')
                booking.status = 'confirmed'
                change(booking, now())
                for (const entry of Object.values(ctx.state.waitlist)) {
                    if (entry.offerId != booking.id || entry.status != 'offered') continue
                    entry.status = 'accepted'
                    entry.updatedAt = now()
                }
                reminders(ctx.state, booking, now())
                audit(ctx, input.orgId, 'booking.confirm', booking.id, now())
                return receipt(booking)
            })
        }}),
        bookingCancel: schemaCommand(bookingInput, {allow: ROLES, apply(ctx: Ctx, input) {
            const booking = bookingAccess(ctx.state, ctx.account, input.orgId, input.id)
            return intent(ctx, 'cancel', input, function cancel() {
                revision(booking, input.revision)
                if (!['held', 'confirmed'].includes(booking.status)) throw new Error('Бронь уже завершена')
                booking.status = 'cancelled'
                change(booking, now())
                if (booking.deposit == 'paid') booking.deposit = 'refundDue'
                reminders(ctx.state, booking, now())
                audit(ctx, input.orgId, 'booking.cancel', booking.id, now())
                return receipt(booking)
            })
        }}),
        bookingMove: schemaCommand({...bookingInput, start: 'number'}, {
            allow: ROLES, apply(ctx: Ctx, input) {return move(ctx, input, false)}
        }),
        bookingReschedule: schemaCommand({...bookingInput, serviceId: 'string', start: 'number'}, {
            allow: ROLES, apply(ctx: Ctx, input) {return move(ctx, input, true)}
        }),
        reminderSet: schemaCommand({...bookingInput, enabled: 'boolean'}, {allow: ROLES, apply(ctx: Ctx, input) {
            const booking = bookingAccess(ctx.state, ctx.account, input.orgId, input.id)
            return intent(ctx, 'reminder', input, function settings() {
                revision(booking, input.revision)
                booking.reminder = input.enabled
                change(booking, now())
                reminders(ctx.state, booking, now())
                return receipt(booking)
            })
        }}),
        waitJoin: schemaCommand({
            orgId: 'string', key: 'string', serviceId: 'string', start: 'number', partySize: 'number'
        }, {allow: ROLES, apply(ctx: Ctx, input) {
            return intent(ctx, 'wait', input, function join(id) {
                const service = serviceAccess(ctx.state, input.orgId, input.serviceId)
                // Validate the requested schedule independently of occupied places.
                slotFor({...ctx.state, bookings: {}}, service, input.start, input.partySize, now())
                if (Object.keys(ctx.state.waitlist).length >= 500) throw new Error('До 500 заявок ожидания')
                function alreadyWaiting(entry: {orgId: string, customer: string, serviceId: string, start: number, status: string}) {
                    if (entry.orgId != input.orgId || entry.customer != ctx.account) return false
                    const sameSlot = entry.serviceId == input.serviceId && entry.start == input.start
                    return sameSlot && ['waiting', 'offered'].includes(entry.status)
                }
                if (Object.values(ctx.state.waitlist).some(alreadyWaiting)) throw new Error('Вы уже ожидаете это время')
                const value = {
                    id, orgId: input.orgId, serviceId: input.serviceId, customer: ctx.account,
                    start: input.start, partySize: input.partySize, status: 'waiting' as const,
                    offerId: '', createdAt: now(), updatedAt: now()
                }
                ctx.state.waitlist[id] = value
                audit(ctx, input.orgId, 'wait.join', id, now())
                return receipt(value)
            })
        }}),
        waitCancel: schemaCommand({orgId: 'string', id: 'string', key: 'string'}, {allow: ROLES, apply(ctx: Ctx, input) {
            const {role} = organizationAccess(ctx.state, ctx.account, input.orgId), entry = own(ctx.state.waitlist, input.id)
            const inside = !!entry && entry.orgId == input.orgId
            const mine = role != 'customer' || entry?.customer == ctx.account
            if (!inside || !mine) throw new Error('Заявка ожидания недоступна')
            return intent(ctx, 'wait-cancel', input, function cancel() {
                if (!['waiting', 'offered'].includes(entry.status)) throw new Error('Заявка уже завершена')
                const booking = ctx.state.bookings[entry.offerId]
                if (booking?.status == 'held') {
                    booking.status = 'cancelled'
                    change(booking, now())
                    if (booking.deposit == 'paid') booking.deposit = 'refundDue'
                }
                entry.status = 'cancelled'
                entry.updatedAt = now()
                return receipt(entry)
            })
        }}),
        depositSimulate: schemaCommand({
            orgId: 'string', id: 'string', eventId: 'string', outcome: {enum: ['paid', 'failed']}
        }, {allow: ROLES, apply(ctx: Ctx, input) {
            const booking = bookingAccess(ctx.state, ctx.account, input.orgId, input.id)
            return intent(ctx, 'test-deposit', {...input, key: input.eventId}, function deposit() {
                if (!booking.depositUnits) throw new Error('Для этой брони депозит не нужен')
                if (['paid', 'refundDue'].includes(booking.deposit)) throw new Error('Депозит уже обработан')
                if (input.outcome == 'paid' && (booking.status != 'held' || booking.holdUntil <= now())) booking.deposit = 'refundDue'
                else booking.deposit = input.outcome
                change(booking, now())
                audit(ctx, input.orgId, 'deposit.test-' + booking.deposit, booking.id, now())
                return receipt(booking)
            })
        }}),
        bookingSweep: schemaCommand({}, {allow: ['system'], apply: sweep})
    }, views: {workspace: {allow: ROLES, project: bookingWorkspace}}}
}

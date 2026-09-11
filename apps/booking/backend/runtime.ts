import {createReconciler} from 'wenay-common2'
import type {Store} from 'wenay-common2/observe'
import type {ServiceResourceContext} from 'wenay-common2/service'
import type {createServiceLeader} from 'wenay-common2/service/server'
import {createBookingService, bookingDefinition} from './service'
import {organizationAccess} from './domain'
import {availability} from './schedule'
import {ROLES, type BookingState} from './model'
import {createBookingAssistant, type PreferenceProvider} from './assistant-resource'
import path from 'node:path'

export function createBookingRuntime(deps: {now?: () => number, holdMs?: number, directory?: string, provider?: PreferenceProvider, timeoutMs?: number} = {}) {
    const service = createBookingService(deps), now = deps.now ?? Date.now
    const assistant = createBookingAssistant({...deps, directory: deps.directory ? path.join(deps.directory, 'assistant') : undefined})
    let store: Store<BookingState> | null = null
    const calendar = {allow: ROLES, placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        function read(input: {orgId: string, serviceId: string, from: string, days: number, partySize: number}) {
            ctx.signal.throwIfAborted()
            if (!store) throw new Error('Календарь не подключён')
            organizationAccess(store.state, ctx.principal.account, input.orgId)
            const service = Object.hasOwn(store.state.services, input.serviceId) ? store.state.services[input.serviceId] : undefined
            if (!service || service.orgId != input.orgId) throw new Error('Услуга недоступна')
            return availability(store.state, service, input, now())
        }
        return {facade: {control: {read}}, close() {}}
    }}
    return {definition: {...service.definition, resources: {calendar, assistant: assistant.resource}},
        mount(deps: {store: Store<BookingState>, system: ReturnType<typeof createServiceLeader<typeof bookingDefinition>>['corridor']['system']}) {
            store = deps.store
            const closeAssistant = assistant.mount(deps.store)
            const worker = createReconciler({read: () => ({
                holds: Object.values(deps.store.state.bookings).filter(value => value.status == 'held').map(value => ({id: value.id, at: value.holdUntil})),
                waits: Object.values(deps.store.state.waitlist).filter(value => value.status == 'waiting').map(value => ({id: value.id, at: value.start})),
                notices: Object.values(deps.store.state.notices).filter(value => value.status == 'pending').map(value => ({id: value.id, at: value.dueAt}))
            }), subscribe: deps.store.listen().on, async run(snapshot, ctx) {
                const events = [...snapshot.holds, ...snapshot.waits, ...snapshot.notices]
                if (snapshot.waits.length || events.some(value => value.at <= now())) {
                    ctx.signal.throwIfAborted()
                    await deps.system.bookingSweep('sweep-' + crypto.randomUUID(), {})
                }
                for (const value of events) if (value.at > now()) ctx.retry(value.id, Math.max(1, value.at - now()))
            }})
            worker.control.request()
            return async function close() {
                closeAssistant()
                await worker.close()
                store = null
            }
        }}
}
export type BookingDefinition = ReturnType<typeof createBookingRuntime>['definition']

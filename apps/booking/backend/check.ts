import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Temporal} from '@js-temporal/polyfill'
import {createServiceClient, describeService, type ServiceClient} from 'wenay-common2/service/client'
import {createBookingRuntime, type BookingDefinition} from './runtime'
import {createProcess} from './process-resource'

async function until(label: string, predicate: () => boolean | Promise<boolean>, timeout = 16000) {
    const end = Date.now() + timeout
    while (!await predicate()) {
        assert(Date.now() < end, label)
        await new Promise(resolve => setTimeout(resolve, 30))
    }
}
async function main() {
    const temporary = realpathSync(tmpdir()), directory = mkdtempSync(path.join(temporary, 'booking-network-'))
    const env = {SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: directory, BOOKING_HOLD_MS: '5000',
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')}
    let host = createProcess({script: 'server.ts', env}), url = await host.ready
    const definition = describeService(createBookingRuntime().definition)
    const clients: ServiceClient<BookingDefinition>[] = [], nodes: ReturnType<typeof createProcess>[] = []
    const resources: {close(): Promise<void>}[] = []
    let sequence = 0
    const rpc = () => 'network-' + (++sequence)
    async function client(account: string) {
        const session = createServiceClient<BookingDefinition>({
            definition,
            url,
            auth: {credentials: {account, password: account + '-pass'}},
            placement: {rng: () => 0}
        })
        clients.push(session)
        await session.ready()
        await session.views.workspace.ready
        return session
    }
    async function calendar(client: ServiceClient<BookingDefinition>) {
        const resource = client.resources.open('calendar')
        resources.push(resource)
        await until('calendar resource', () => !!resource.current())
        return resource.current()!.remote
    }
    try {
        for (const id of ['booking-a', 'booking-b']) {
            const node = createProcess({script: 'node.ts', env: {...env, SERVICE_UPSTREAM: url, SERVICE_NODE_ID: id}})
            nodes.push(node)
            await node.ready
        }
        const owner = await client('owner'), a = await client('customer'), b = await client('customer2'), outsider = await client('outsider')
        await owner.commands.resourceSave(rpc(), {...owner.views.workspace.store.state.resources.find(value => value.id == 'studio')!, capacity: 1})
        const read = await calendar(a)
        const from = Temporal.Now.instant().toZonedDateTimeISO('Europe/Berlin').toPlainDate().toString()
        const query = {orgId: 'northstar', serviceId: 'consultation', from, days: 7, partySize: 1}
        const slots = await read.control.read(query)
        assert(slots.slots.length > 0)
        const start = slots.slots[0].start
        const hold = {orgId: 'northstar', serviceId: 'consultation', start, partySize: 1, customer: '', note: 'network-private-note', reminder: true}
        const race = await Promise.allSettled([
            a.commands.bookingHold(rpc(), {...hold, key: 'race-a'}),
            b.commands.bookingHold(rpc(), {...hold, key: 'race-b'})
        ])
        assert.equal(race.filter(value => value.status == 'fulfilled').length, 1, 'authority allocates final place once across clients')
        const winnerIndex = race[0].status == 'fulfilled' ? 0 : 1
        const winner = winnerIndex == 0 ? a : b
        const loser = winnerIndex == 0 ? b : a
        const booking = (race[winnerIndex] as PromiseFulfilledResult<{id: string}>).value
        await winner.commands.bookingConfirm(rpc(), {orgId: 'northstar', id: booking.id, revision: 1, key: 'confirm-winner'})
        await until('owner sees confirmed booking', function confirmed() {
            return owner.views.workspace.store.state.bookings.some(function match(value) {
                return value.id == booking.id && value.status == 'confirmed'
            })
        })
        assert.equal(loser.views.workspace.store.state.bookings.length, 0)
        assert(!JSON.stringify(outsider.views.workspace.store.state).includes('network-private-note'))
        const waiting = await loser.commands.waitJoin(rpc(), {orgId: 'northstar', serviceId: 'consultation', start, partySize: 1, key: 'wait-next'})
        const endpoint = owner.view.endpoint()!
        assert(endpoint.nodeId != 'leader', 'serving node actually handles workspace')
        const stableStore = owner.views.workspace.store
        await nodes[endpoint.nodeId == 'booking-a' ? 0 : 1].control.stop(true)
        await until('serving failover', () => !!owner.view.endpoint() && owner.view.endpoint()!.nodeId != endpoint.nodeId)
        assert.equal(owner.views.workspace.store, stableStore)
        assert.equal((await read.control.read(query)).slots.some(value => value.start == start), false)
        await winner.commands.bookingCancel(rpc(), {orgId: 'northstar', id: booking.id, revision: 2, key: 'cancel-winner'})
        await until('waitlist gets one hold after node failure', function offered() {
            return loser.views.workspace.store.state.waitlist.some(function match(value) {
                return value.id == waiting.id && value.status == 'offered'
            })
        })
        const offerId = loser.views.workspace.store.state.waitlist.find(value => value.id == waiting.id)!.offerId
        await until('reconciler expires offer without user command', function expired() {
            return loser.views.workspace.store.state.bookings.some(function match(value) {
                return value.id == offerId && value.status == 'expired'
            })
        }, 12000)
        assert((await read.control.read(query)).slots.some(value => value.start == start), 'expired hold immediately frees availability')
        const finalInput = {...hold, key: 'stable-final'}
        const final = await a.commands.bookingHold(rpc(), finalInput)
        await a.commands.bookingConfirm(rpc(), {orgId: 'northstar', id: final.id, revision: 1, key: 'stable-confirm'})
        for (const resource of resources) await resource.close()
        for (const session of clients) session.close()
        for (const node of nodes) await node.control.stop()
        await host.control.stop()
        host = createProcess({script: 'server.ts', env})
        url = await host.ready
        const restoredOwner = await client('owner'), restoredCustomer = await client('customer')
        assert(restoredOwner.views.workspace.store.state.bookings.some(value => value.id == final.id && value.status == 'confirmed'))
        const repeat = await restoredCustomer.commands.bookingHold(rpc(), finalInput)
        assert.equal(repeat.id, final.id)
        assert.equal(repeat.fresh, false)
        assert.equal(restoredOwner.views.workspace.store.state.bookings.filter(value => value.id == final.id).length, 1)
        const restoredCalendar = await calendar(restoredCustomer)
        assert(!(await restoredCalendar.control.read(query)).slots.some(value => value.start == start))
        await assert.rejects(restoredCustomer.commands.bookingConfirm(rpc(), {orgId: 'northstar', id: offerId, revision: 1, key: 'expired-retry'}))
        console.log('PASS booking network: authority + 2 serving, atomic final-place race, private projections, serving failover, one waitlist offer, real TTL reconciler, durable confirmed booking and semantic intent after authority restart')
    } finally {
        for (const resource of resources) await resource.close().catch(() => {})
        for (const session of clients) session.close()
        for (const node of nodes) await node.control.stop()
        await host.control.stop()
        assert(path.dirname(path.resolve(directory)) == temporary && path.basename(directory).startsWith('booking-network-'))
        rmSync(directory, {recursive: true, force: true})
    }
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})

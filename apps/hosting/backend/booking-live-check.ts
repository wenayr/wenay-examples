import assert from 'node:assert/strict'
import {createServiceClient, type ServiceClient} from 'wenay-common2/service/client'
import type {BookingDefinition} from '../../booking/backend/runtime'
import {checkHostedApplication, waitForHosted} from './hosted-application-check'

async function main() {
    let owner: ServiceClient<BookingDefinition> | undefined
    let calendar: ReturnType<ServiceClient<BookingDefinition>['resources']['open']> | undefined
    let bookingId = '', generation = 0, start = 0
    const hold = () => ({
        orgId: 'northstar',
        key: 'hosted-hold',
        serviceId: 'consultation',
        start,
        partySize: 1,
        customer: 'customer',
        note: 'Сохраняем удержание через deploy',
        reminder: true
    })
    await checkHostedApplication({name: 'booking', async verify({url, iteration}) {
        assert((await fetch(url).then(response => response.text())).includes('<html'))
        if (!owner) {
            const definition = await fetch(url + '/api/client').then(response => response.json())
            owner = createServiceClient<BookingDefinition>({definition, url, auth: {credentials: {account: 'owner', password: 'owner-pass'}}})
            await owner.ready()
            await owner.views.workspace.ready
            await owner.commands.resourceSave('single-place', {
                ...owner.views.workspace.store.state.resources.find(value => value.id == 'studio')!,
                capacity: 1
            })
            const resource = owner.resources.open('calendar')
            calendar = resource
            await waitForHosted('calendar resource', () => !!resource.current())
            const read = await resource.current()!.remote.control.read({
                orgId: 'northstar',
                serviceId: 'consultation',
                from: new Date().toISOString().slice(0, 10),
                days: 7,
                partySize: 1
            })
            start = read.slots.find(value => value.start > Date.now() + 3600000)!.start
            bookingId = (await owner.commands.bookingHold('hold-first', hold())).id
        } else {
            await waitForHosted('same workspace/resource after release change', function restored() {
                if (!owner?.health.state.connected) return false
                if ((calendar?.current()?.generation ?? 0) <= generation) return false
                return owner.views.workspace.store.state.bookings.some(value => value.id == bookingId)
            })
            const current = owner.views.workspace.store.state.bookings.find(value => value.id == bookingId)!
            assert.equal(current.status, iteration == 1 ? 'held' : 'confirmed')
            assert.equal(current.start, start)
            assert.equal((await owner.commands.bookingHold('repeat-' + iteration, hold())).fresh, false)
            assert.equal(owner.views.workspace.store.state.bookings.filter(value => value.id == bookingId).length, 1)
            await assert.rejects(owner.commands.bookingHold('conflict-' + iteration, {
                ...hold(),
                key: 'conflict-' + iteration,
                customer: 'customer2'
            }), /недостаточно/)
            if (iteration == 1) await owner.commands.bookingConfirm('confirm-second', {
                orgId: 'northstar',
                id: bookingId,
                revision: current.revision,
                key: 'confirm-after-deploy'
            })
            else {
                const notice = owner.views.workspace.store.state.notices.find(value => value.bookingId == bookingId)
                assert(notice, 'confirmed reminder survived rollback')
                await owner.commands.bookingCancel('cancel-restored', {
                    orgId: 'northstar',
                    id: bookingId,
                    revision: current.revision,
                    key: 'cancel-after-rollback'
                })
            }
        }
        generation = calendar?.current()?.generation ?? 0
    }, async close() {await calendar?.close()
    owner?.close()}})
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})

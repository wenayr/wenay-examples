import assert from 'node:assert/strict'
import {createServiceLeader} from 'wenay-common2/service/server'
import {createBookingRuntime} from './runtime'
import {bookingRoles, bookingWorkspace} from './domain'
import {createBookingState} from './model'
import {daySlots, remaining, validateResource} from './schedule'
import {checkBookingReschedule} from './reschedule-check'

async function main() {
    await checkBookingReschedule()
    const sample = createBookingState(), source = sample.resources.studio, offering = sample.services.consultation
    const sunday = {...source, weekly: [{day: 7, start: '01:00', end: '04:00'}]}
    const short = {...offering, duration: 15, before: 0, after: 0}
    const spring = daySlots(sunday, short, '2026-03-29')
    assert(!spring.some(slot => slot.local.includes('T02:')), 'nonexistent local hour has no slots')
    const autumn = daySlots(sunday, short, '2026-10-25').filter(slot => slot.local == '2026-10-25T02:30')
    assert.equal(autumn.length, 2)
    assert.deepEqual(autumn.map(slot => slot.offset), ['+02:00', '+01:00'])
    assert.equal(autumn[1].start - autumn[0].start, 3600000)
    const lordHowe = {...sunday, zone: 'Australia/Lord_Howe'}
    assert(!daySlots(lordHowe, short, '2026-10-04').some(slot => slot.local == '2026-10-04T02:15'), '30 minute DST gap is respected')
    assert.equal(daySlots({...sunday, exceptions: [{date: '2026-10-25', windows: []}]}, short, '2026-10-25').length, 0)
    assert.throws(() => validateResource({...source, zone: 'not/a-zone'}))
    const overlapping = [
        {day: 1, start: '09:00', end: '12:00'},
        {day: 1, start: '11:00', end: '13:00'}
    ]
    assert.throws(() => validateResource({...source, weekly: overlapping}), /непересекающимися/)
    assert.throws(() => daySlots(source, short, '2026-02-30'))
    let clock = Date.UTC(2026, 8, 14, 6)
    const runtime = createBookingRuntime({now: () => clock, holdMs: 60000})
    const leader = createServiceLeader({definition: runtime.definition, selfUrl: () => 'http://localhost'})
    const close = runtime.mount({store: leader.line.control.store, system: leader.corridor.system})
    const state = () => leader.line.control.store.snapshot()
    const owner = leader.corridor.fragment('owner')
    const staff = leader.corridor.fragment('staff')
    const first = leader.corridor.fragment('customer')
    const second = leader.corridor.fragment('customer2')
    const outsider = leader.corridor.fragment('outsider')
    const controller = new AbortController()
    const context = (account: string) => ({
        principal: {account, roles: bookingRoles(state(), account)},
        sessionId: account,
        resourceId: 'calendar-test',
        signal: controller.signal
    })
    const calendar = runtime.definition.resources.calendar.open(context('customer'))
    let sequence = 0
    const rpc = () => 'check-' + (++sequence)
    const orgId = 'northstar'
    async function until(label: string, test: () => boolean) {
        const limit = Date.now() + 3000
        while (!test()) {
            assert(Date.now() < limit, label)
            await new Promise(resolve => setTimeout(resolve, 10))
        }
    }
    function hold(key: string, start: number) {
        return {
            orgId, key, serviceId: 'consultation', start, partySize: 1,
            customer: '', note: 'Клиентская заметка', reminder: true
        }
    }
    function action(id: string, key: string) {return {orgId, id, revision: state().bookings[id].revision, key}}
    try {
        assert.equal(runtime.definition.access.login.resolve(state(), {account: 'customer', password: 'customer-pass'}), 'customer')
        assert.equal(runtime.definition.access.login.resolve(state(), {account: '__proto__', password: 'customer-pass'}), null)
        await owner.resourceSave(rpc(), {...state().resources.studio, capacity: 1})
        await assert.rejects(first.resourceSave(rpc(), {...state().resources.studio, name: 'forged'}), /forbidden/)
        await assert.rejects(staff.resourceSave(rpc(), {...state().resources.harbor}), /доступа/)
        const foreign = runtime.definition.resources.calendar.open(context('outsider'))
        const range = {orgId, serviceId: 'consultation', from: '2026-09-14', days: 1, partySize: 1}
        assert.throws(() => foreign.facade.control.read(range), /доступа/)
        assert.throws(() => foreign.facade.control.read({...range, includeOccupied: true}), /доступа/)
        assert.throws(() => calendar.facade.control.read({orgId, serviceId: 'consultation', from: '2026-09-14', days: 15, partySize: 1}), /14 дней/)
        assert.throws(() => calendar.facade.control.read({orgId, serviceId: 'harbor', from: '2026-09-14', days: 1, partySize: 1}), /недоступна/)
        assert.throws(() => calendar.facade.control.read({...range, serviceId: 'harbor', includeOccupied: true}), /недоступна/)
        assert.equal(calendar.facade.control.read({...range, from: '2026-09-19', includeOccupied: true}).slots.length, 0, 'closed day stays empty')
        const slots = calendar.facade.control.read({orgId, serviceId: 'consultation', from: '2026-09-14', days: 1, partySize: 1}).slots
        assert(slots.length > 4)
        const start = slots[0].start
        const firstInput = hold('race-first', start), secondInput = hold('race-second', start)
        const race = await Promise.allSettled([first.bookingHold(rpc(), firstInput), second.bookingHold(rpc(), secondInput)])
        assert.equal(race.filter(value => value.status == 'fulfilled').length, 1)
        const winner = (race.find(value => value.status == 'fulfilled') as PromiseFulfilledResult<{id: string}>).value.id
        const winningClient = state().bookings[winner].customer == 'customer' ? first : second
        const winningInput = state().bookings[winner].customer == 'customer' ? firstInput : secondInput
        assert.equal((await winningClient.bookingHold(rpc(), winningInput)).fresh, false)
        await assert.rejects(winningClient.bookingHold(rpc(), {...winningInput, start: start + 3600000}), /другими параметрами/)
        const day = {orgId, serviceId: 'consultation', from: '2026-09-14', days: 1, partySize: 1}
        const free = calendar.facade.control.read(day).slots
        const note = 'buffer occupies resource through end+15min'
        assert(!free.some(slot => slot.start == start + 15 * 60000), note)
        assert(!free.some(slot => slot.start == start), 'default calendar only returns enough places')
        const withOccupied = calendar.facade.control.read({...day, includeOccupied: true}).slots
        const waitingSlot = withOccupied.find(slot => slot.start == start)
        assert.equal(waitingSlot?.available, 0, 'occupied start is selectable for waitlist')
        assert.equal(withOccupied.find(slot => slot.start == start + 45 * 60000)?.available, 0, 'occupied view retains the booking buffer')
        assert(withOccupied.every(slot => slot.start > clock && slot.start <= clock + 180 * 86400000))
        const heldCalendar = runtime.definition.resources.calendar.open(context(state().bookings[winner].customer))
        try {
            assert.throws(() => heldCalendar.facade.control.read({...day, bookingId: winner}), /подтверждённую/)
        } finally {heldCalendar.close()}
        const beforeRead = clock
        clock = start
        assert(!calendar.facade.control.read({...day, includeOccupied: true}).slots.some(slot => slot.start <= clock), 'past starts stay hidden')
        clock = beforeRead
        await assert.rejects(outsider.bookingConfirm(rpc(), action(winner, 'cross-tenant')), /доступа/)
        const otherClient = state().bookings[winner].customer == 'customer' ? second : first
        await assert.rejects(otherClient.bookingConfirm(rpc(), action(winner, 'other-customer')), /недоступна/)
        await winningClient.bookingConfirm(rpc(), action(winner, 'confirm-first'))
        assert.equal(state().bookings[winner].status, 'confirmed')
        const joined = await otherClient.waitJoin(rpc(), {orgId, key: 'wait-once', serviceId: 'consultation', start: waitingSlot!.start, partySize: 1})
        assert.equal((await otherClient.waitJoin(rpc(), {orgId, key: 'wait-once', serviceId: 'consultation', start, partySize: 1})).fresh, false)
        assert.equal(state().waitlist[joined.id].status, 'waiting')
        await winningClient.bookingCancel(rpc(), action(winner, 'cancel-first'))
        await until('released place offered once', () => state().waitlist[joined.id].status == 'offered')
        const offerId = state().waitlist[joined.id].offerId
        assert.equal(state().bookings[offerId].customer, state().waitlist[joined.id].customer)
        await leader.corridor.system.bookingSweep(rpc(), {})
        assert.equal(Object.values(state().bookings).filter(value => value.id == offerId).length, 1)
        await otherClient.bookingConfirm(rpc(), action(offerId, 'accept-wait'))
        assert.equal(state().waitlist[joined.id].status, 'accepted')
        const moveAccount = state().bookings[offerId].customer
        const moverCalendar = runtime.definition.resources.calendar.open(context(moveAccount))
        const deniedAccount = moveAccount == 'customer' ? 'customer2' : 'customer'
        const deniedCalendar = runtime.definition.resources.calendar.open(context(deniedAccount))
        const moveDay = {...day, bookingId: offerId}
        try {
            const overlapStart = start + 15 * 60000
            assert(!moverCalendar.facade.control.read(day).slots.some(slot => slot.start == overlapStart), 'new booking counts the existing reservation')
            const overlap = moverCalendar.facade.control.read(moveDay).slots.find(slot => slot.start == overlapStart)
            assert.equal(overlap?.available, 1, 'move calendar excludes only its own confirmed reservation')
            assert.throws(() => deniedCalendar.facade.control.read(moveDay), /недоступна/)
            assert.throws(() => foreign.facade.control.read(moveDay), /доступа/)
            const foreignDay = {...moveDay, orgId: 'harbor', serviceId: 'harbor'}
            assert.throws(() => foreign.facade.control.read(foreignDay), /недоступна/)
            assert.throws(() => moverCalendar.facade.control.read({...moveDay, partySize: 2}), /не соответствует/)
            const compatible = await owner.serviceSave(rpc(), {...state().services.consultation, id: '', revision: 0, name: 'Совместимая услуга'})
            const target = moverCalendar.facade.control.read({...moveDay, serviceId: compatible.id})
            assert(target.slots.some(slot => slot.start == overlapStart), 'cross-service reschedule keeps own-booking exclusion')
            await otherClient.bookingMove(rpc(), {...action(offerId, 'move-overlap'), start: overlap!.start})
            assert.equal(state().bookings[offerId].start, overlapStart)
            await otherClient.bookingMove(rpc(), {...action(offerId, 'move-return'), start})
            clock = start
            assert.throws(() => moverCalendar.facade.control.read(moveDay), /подтверждённую/)
            clock = beforeRead
        } finally {
            moverCalendar.close()
            deniedCalendar.close()
        }
        const secondSlot = start + 3600000
        const blocked = await owner.bookingHold(rpc(), {...hold('blocked', secondSlot), customer: 'customer'})
        await owner.bookingConfirm(rpc(), action(blocked.id, 'confirm-blocked'))
        const moveWithNeighbor = runtime.definition.resources.calendar.open(context(moveAccount))
        try {
            const positions = moveWithNeighbor.facade.control.read({...moveDay, includeOccupied: true}).slots
            assert.equal(positions.find(slot => slot.start == secondSlot)?.available, 0, 'excluding the moved booking keeps other reservations')
        } finally {moveWithNeighbor.close()}
        await owner.resourceSave(rpc(), {...state().resources.studio, capacity: 2})
        await owner.serviceSave(rpc(), {...state().services.consultation, capacity: 2})
        const pair = {...day, partySize: 2}
        assert(!calendar.facade.control.read(pair).slots.some(slot => slot.start == start), 'one free place is insufficient for two people')
        const partial = calendar.facade.control.read({...pair, includeOccupied: true}).slots.find(slot => slot.start == start)
        assert.equal(partial?.available, 1, 'partial capacity is returned honestly for waitlist')
        assert.equal(calendar.facade.control.read(day).slots.find(slot => slot.start == start)?.available, 1, 'one person can still book')
        await assert.rejects(first.bookingHold(rpc(), {...hold('too-large-party', start), partySize: 2}), /недостаточно/)
        await owner.serviceSave(rpc(), {...state().services.consultation, capacity: 1})
        await owner.resourceSave(rpc(), {...state().resources.studio, capacity: 1})
        const original = state().bookings[offerId]
        const left = {...original, id: 'adjacent-left', occupiedFrom: start, occupiedTo: start + 3600000, status: 'confirmed' as const}
        const right = {...original, id: 'adjacent-right', occupiedFrom: start + 3600000, occupiedTo: start + 7200000, status: 'confirmed' as const}
        const both = {...state(), bookings: {[left.id]: left, [right.id]: right}}
        const studio = {...state().resources.studio, capacity: 2}
        const capacityLeft = remaining(both, studio, start + 1800000, start + 5400000, clock)
        assert.equal(capacityLeft, 1, 'adjacent bookings do not get summed as if they overlapped')
        await assert.rejects(otherClient.bookingMove(rpc(), {...action(offerId, 'conflicting-move'), start: secondSlot}), /недостаточно/)
        assert.deepEqual(state().bookings[offerId], original, 'failed reschedule preserves all original fields')
        await otherClient.bookingMove(rpc(), {...action(offerId, 'move-free'), start: secondSlot + 3600000})
        assert.equal(state().bookings[offerId].start, secondSlot + 3600000)
        assert(Object.values(state().notices).some(notice => notice.bookingId == offerId && notice.status == 'cancelled'))
        const ownView = bookingWorkspace(state(), context('customer').principal)
        assert(ownView.bookings.every(value => value.customer == 'customer'))
        assert(ownView.people.every(value => value.account != 'customer2'))
        assert.equal(ownView.audit.length, 0)
        assert(!JSON.stringify(ownView).includes('signature'))
        assert.equal(bookingWorkspace(state(), context('outsider').principal).bookings.length, 0)
        const expired = await first.bookingHold(rpc(), hold('expiry', start + 4 * 3600000))
        clock += 60000
        await assert.rejects(first.bookingConfirm(rpc(), action(expired.id, 'late-confirm')), /истекла/)
        await leader.corridor.system.bookingSweep(rpc(), {})
        assert.equal(state().bookings[expired.id].status, 'expired')
        assert.equal((await first.bookingHold(rpc(), hold('expiry', start + 4 * 3600000))).id, expired.id, 'expired semantic intent does not recreate hold')
        assert.equal(state().bookings[expired.id].status, 'expired')
        await owner.serviceSave(rpc(), {...state().services.consultation, depositUnits: 10})
        const paid = await first.bookingHold(rpc(), hold('paid-hold', start + 4 * 3600000))
        await assert.rejects(first.bookingConfirm(rpc(), action(paid.id, 'unpaid-confirm')), /депозит/)
        const depositInput = {orgId, id: paid.id, eventId: 'deposit-success', outcome: 'paid' as const}
        await first.depositSimulate(rpc(), depositInput)
        assert.equal((await first.depositSimulate(rpc(), depositInput)).fresh, false)
        await assert.rejects(first.depositSimulate(rpc(), {...depositInput, outcome: 'failed'}), /другими параметрами/)
        await first.bookingConfirm(rpc(), action(paid.id, 'paid-confirm'))
        await first.bookingCancel(rpc(), action(paid.id, 'paid-cancel'))
        assert.equal(state().bookings[paid.id].deposit, 'refundDue')
        const late = await first.bookingHold(rpc(), hold('late-payment', start + 4 * 3600000))
        clock += 60000
        await first.depositSimulate(rpc(), {orgId, id: late.id, eventId: 'late-paid', outcome: 'paid'})
        assert.equal(state().bookings[late.id].deposit, 'refundDue')
        await assert.rejects(first.bookingConfirm(rpc(), action(late.id, 'late-payment-confirm')), /истекла/)
        await leader.corridor.system.bookingSweep(rpc(), {})
        const futureNotice = Object.values(state().notices).find(notice => notice.bookingId == offerId && notice.status == 'pending')!
        assert(futureNotice)
        clock = futureNotice.dueAt
        await leader.corridor.system.bookingSweep(rpc(), {})
        assert.equal(state().notices[futureNotice.id].status, 'delivered')
        await leader.corridor.system.bookingSweep(rpc(), {})
        assert.equal(Object.values(state().notices).filter(notice => notice.id == futureNotice.id).length, 1)
        const restoredRuntime = createBookingRuntime({now: () => clock})
        const restored = createServiceLeader({definition: {...restoredRuntime.definition, initial: state()}, selfUrl: () => 'http://localhost'})
        try {
            const restoredFirst = restored.corridor.fragment('customer')
            assert.equal((await restoredFirst.depositSimulate(rpc(), depositInput)).fresh, false, 'semantic payment event survives restored journal')
            assert.equal(restored.line.control.store.state.bookings[offerId].start, state().bookings[offerId].start)
        } finally {restored.control.close()}
        controller.abort()
        assert.throws(() => calendar.facade.control.read({orgId, serviceId: 'consultation', from: '2026-09-14', days: 1, partySize: 1}))
        console.log('PASS booking: DST gap/fold/30min transition, exceptions, range, tenant/role/privacy, atomic final-place race, buffers, TTL, semantic repeats, conflict-safe move, waitlist promotion, stale reminders and local test deposits including late payment/refund')
    } finally {calendar.close()
    await close()
    leader.control.close()}
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})


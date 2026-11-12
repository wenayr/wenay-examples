import assert from 'node:assert/strict'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServiceLeader} from 'wenay-common2/service/server'
import {createBookingRuntime} from './runtime'
import {bookingRoles} from './domain'
import {daySlots} from './schedule'

export async function checkBookingReschedule() {
    let clock = Date.UTC(2026, 2, 20, 6)
    const runtime = createBookingRuntime({now: () => clock})
    const leader = createServiceLeader({definition: runtime.definition, selfUrl: () => 'http://localhost'})
    const close = runtime.mount({store: leader.line.control.store, system: leader.corridor.system})
    const state = () => leader.line.control.store.snapshot()
    const owner = leader.corridor.fragment('owner')
    const staff = leader.corridor.fragment('staff')
    const customer = leader.corridor.fragment('customer')
    const other = leader.corridor.fragment('customer2')
    let sequence = 0
    const rpc = () => 'reschedule-check-' + (++sequence)
    const orgId = 'northstar'
    const controller = new AbortController()
    function calendar(account: string) {
        return runtime.definition.resources.calendar.open({principal: {account, roles: bookingRoles(state(), account)},
            sessionId: account, resourceId: 'reschedule-calendar', signal: controller.signal})
    }
    const ownCalendar = calendar('customer')
    const otherCalendar = calendar('customer2')
    const foreignCalendar = calendar('outsider')
    function action(id: string, key: string) {return {orgId, id, revision: state().bookings[id].revision, key}}
    async function confirm(actor: typeof customer, serviceId: string, start: number, key: string) {
        const hold = await actor.bookingHold(rpc(), {orgId, key, serviceId, start, partySize: 1, customer: '', note: 'Сохранить условия', reminder: true})
        await actor.depositSimulate(rpc(), {orgId, id: hold.id, eventId: key + '-deposit', outcome: 'paid'})
        await actor.bookingConfirm(rpc(), action(hold.id, key + '-confirm'))
        return hold.id
    }
    try {
        await owner.resourceSave(rpc(), {...state().resources.studio, capacity: 1})
        await owner.serviceSave(rpc(), {...state().services.consultation, depositUnits: 10})
        const targetResource = await owner.resourceSave(rpc(), {orgId, id: '', revision: 0, name: 'Нью-Йорк', staff: 'owner',
            zone: 'America/New_York', capacity: 1, weekly: Array.from({length: 7}, (_, day) => ({day: day + 1, start: '01:00', end: '18:00'})), exceptions: []})
        const target = await owner.serviceSave(rpc(), {...state().services.consultation, id: '', revision: 0,
            resourceId: targetResource.id, name: 'Другая студия', before: 15, after: 0})
        const sourceStart = daySlots(state().resources.studio, state().services.consultation, '2026-03-23')[0].start
        const targetSlots = daySlots(state().resources[targetResource.id], state().services[target.id], '2026-03-23')
        const targetSlot = targetSlots.find(slot => slot.local == '2026-03-23T09:00')!
        assert(targetSlot)
        const id = await confirm(customer, 'consultation', sourceStart, 'source')
        const blockedId = await confirm(other, target.id, targetSlot.start, 'block-target')
        const read = {orgId, serviceId: 'consultation', from: '2026-03-23', days: 1, partySize: 1}
        assert(!ownCalendar.facade.control.read(read).slots.some(slot => slot.start == sourceStart))
        assert(ownCalendar.facade.control.read({...read, bookingId: id}).slots.some(slot => slot.start == sourceStart))
        assert.throws(() => otherCalendar.facade.control.read({...read, bookingId: id}), /недоступна/)
        assert.throws(() => ownCalendar.facade.control.read({...read, bookingId: 'missing'}), /недоступна/)
        assert.throws(() => foreignCalendar.facade.control.read({...read, bookingId: id}), /доступа/)
        const input = {...action(id, 'move-across'), serviceId: target.id, start: targetSlot.start}
        const before = state()
        await assert.rejects(customer.bookingReschedule(rpc(), input), /недостаточно/)
        assert.deepEqual(state(), before, 'failed target allocation changes neither booking, receipts, notices nor audit')
        await assert.rejects(other.bookingReschedule(rpc(), input), /недоступна/)
        await assert.rejects(customer.bookingReschedule(rpc(), {...input, serviceId: 'harbor'}), /недоступна/)
        const badDuration = await owner.serviceSave(rpc(), {...state().services[target.id], id: '', revision: 0, duration: 60})
        const badDeposit = await owner.serviceSave(rpc(), {...state().services[target.id], id: '', revision: 0, depositUnits: 20})
        const inactive = await owner.serviceSave(rpc(), {...state().services[target.id], id: '', revision: 0, active: false})
        await assert.rejects(customer.bookingReschedule(rpc(), {...input, serviceId: badDuration.id}), /Длительность/)
        await assert.rejects(customer.bookingReschedule(rpc(), {...input, serviceId: badDeposit.id}), /Депозит/)
        await assert.rejects(customer.bookingReschedule(rpc(), {...input, serviceId: inactive.id}), /недоступна/)
        await assert.rejects(customer.bookingReschedule(rpc(), {...input, start: targetSlot.start + 1}), /расписание/)
        await assert.rejects(customer.bookingReschedule(rpc(), {...input, start: clock}), /будущее/)
        await owner.bookingCancel(rpc(), action(blockedId, 'unblock-target'))
        const commandId = rpc()
        const moved = await customer.bookingReschedule(commandId, input)
        assert.deepEqual(await customer.bookingReschedule(commandId, input), moved, 'transport requestId returns the same receipt')
        assert.equal((await customer.bookingReschedule(rpc(), input)).fresh, false, 'semantic key prevents a second transfer')
        const booking = state().bookings[id]
        assert.equal(booking.serviceId, target.id)
        assert.equal(booking.resourceId, targetResource.id)
        assert.equal(booking.start, targetSlot.start)
        assert.equal(booking.end - booking.start, before.bookings[id].end - before.bookings[id].start)
        assert.equal(booking.occupiedFrom, booking.start - 15 * 60000)
        assert.equal(booking.occupiedTo, booking.end)
        assert.equal(booking.depositUnits, 10)
        assert.equal(booking.deposit, 'paid')
        assert.equal(booking.customer, before.bookings[id].customer)
        assert.equal(booking.note, before.bookings[id].note)
        assert.equal(booking.partySize, before.bookings[id].partySize)
        assert.equal(booking.status, 'confirmed')
        assert.equal(booking.revision, moved.revision)
        const oldNotice = Object.values(before.notices).find(notice => notice.bookingId == id && notice.status == 'pending')!
        assert.equal(state().notices[oldNotice.id].status, 'cancelled')
        const newNotice = Object.values(state().notices).find(notice => notice.bookingId == id && notice.status == 'pending')!
        assert(newNotice.body.includes('America/New_York'))
        const after = state()
        await assert.rejects(customer.bookingReschedule(rpc(), {...input, key: 'stale'}), /уже изменена/)
        await assert.rejects(customer.bookingReschedule(rpc(), {...input, start: targetSlot.start + 3600000}), /Ключ повтора/)
        assert.deepEqual(state(), after)

        const restoredRuntime = createBookingRuntime({now: () => clock})
        const restored = createServiceLeader({definition: {...restoredRuntime.definition, initial: after}, selfUrl: () => 'http://localhost'})
        try {
            const repeat = await restored.corridor.fragment('customer').bookingReschedule(rpc(), input)
            assert.equal(repeat.fresh, false)
            assert.deepEqual(restored.line.control.store.snapshot().bookings[id], booking)
        } finally {restored.control.close()}
        await staff.bookingReschedule(rpc(), {...action(id, 'staff-reschedule'), serviceId: target.id, start: targetSlot.start + 3600000})
        assert.equal(state().bookings[id].customer, 'customer', 'staff can serve another customer on an organization resource')
        assert.equal(state().resources[state().bookings[id].resourceId].staff, 'owner', 'booking access is distinct from resource settings ownership')
        await owner.serviceSave(rpc(), {...state().services[target.id], duration: 60, depositUnits: 20})
        await customer.bookingMove(rpc(), {...action(id, 'legacy-move'), start: targetSlot.start + 3 * 3600000})
        assert.equal(state().bookings[id].end - state().bookings[id].start, 60 * 60000, 'legacy move retains its current-offering duration semantics')
        assert.equal(state().bookings[id].depositUnits, 10)
        assert.equal(state().bookings[id].deposit, 'paid')

        const dstResource = await owner.resourceSave(rpc(), {orgId, id: '', revision: 0, name: 'DST', staff: 'owner', zone: 'Europe/Berlin', capacity: 1,
            weekly: Array.from({length: 7}, (_, day) => ({day: day + 1, start: '01:00', end: '04:00'})), exceptions: []})
        const dstService = await owner.serviceSave(rpc(), {...state().services.consultation, id: '', revision: 0,
            resourceId: dstResource.id, before: 0, after: 0})
        const gapRead = {orgId, serviceId: dstService.id, from: '2026-03-29', days: 1, partySize: 1}
        assert(!ownCalendar.facade.control.read(gapRead).slots.some(slot => slot.local.includes('T02:')))
        clock = Date.UTC(2026, 9, 20, 6)
        const foldRead = {orgId, serviceId: dstService.id, from: '2026-10-25', days: 1, partySize: 1}
        const folds = ownCalendar.facade.control.read(foldRead).slots.filter(slot => slot.local == '2026-10-25T02:30')
        assert.deepEqual(folds.map(slot => slot.offset), ['+02:00', '+01:00'])
        const foldedId = await confirm(customer, dstService.id, folds[0].start, 'fold-first')
        await customer.bookingReschedule(rpc(), {...action(foldedId, 'fold-second'), serviceId: dstService.id, start: folds[1].start})
        assert.equal(state().bookings[foldedId].start - folds[0].start, 3600000)
        assert.equal(state().bookings[foldedId].end - state().bookings[foldedId].start, 45 * 60000)
        const unchanged = state().bookings[foldedId]
        await assert.rejects(customer.bookingReschedule(rpc(), {
            ...action(foldedId, 'fold-off-grid'), serviceId: dstService.id, start: folds[1].start + 1
        }), /расписание/)
        assert.deepEqual(state().bookings[foldedId], unchanged)
        const held = await customer.bookingHold(rpc(), {orgId, serviceId: dstService.id, start: folds[1].start + 45 * 60000,
            partySize: 1, customer: '', key: 'held-no-move', note: '', reminder: false})
        await assert.rejects(customer.bookingReschedule(rpc(), {
            ...action(held.id, 'held-reschedule'), serviceId: dstService.id, start: folds[1].start
        }), /подтверждённую/)
        await customer.bookingCancel(rpc(), action(foldedId, 'cancel-fold'))
        await assert.rejects(customer.bookingReschedule(rpc(), {
            ...action(foldedId, 'cancelled-reschedule'), serviceId: dstService.id, start: folds[1].start
        }), /подтверждённую/)
        console.log('PASS booking reschedule: cross-resource/service atomicity, stored duration/deposit, target buffers/zone, own-booking availability ACL,')
        console.log('  capacity conflict, stale revision, repeated transport/semantic receipts, restored intent, legacy move,')
        console.log('  DST gap/fold and held/cancelled denial')
    } finally {
        controller.abort()
        ownCalendar.close()
        otherCalendar.close()
        foreignCalendar.close()
        await close()
        leader.control.close()
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) == fileURLToPath(import.meta.url)) {
    checkBookingReschedule().catch(function failed(error) {
        console.error(error)
        process.exitCode = 1
    })
}

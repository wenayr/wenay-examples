import {Temporal} from '@js-temporal/polyfill'
import type {BookingState, Offering, Resource, Window} from './model'

const minute = 60000
export function civilDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Дата должна иметь вид YYYY-MM-DD')
    return Temporal.PlainDate.from(value, {overflow: 'reject'})
}
function time(value: string) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Время должно иметь вид HH:mm')
    return Temporal.PlainTime.from(value)
}
export function validateWindows(windows: Window[]) {
    if (windows.length > 8) throw new Error('Не более восьми окон за день')
    const sorted = windows.map(value => {
        time(value.start)
        time(value.end)
        return value
    }).sort((a, b) => a.start.localeCompare(b.start))
    for (let index = 0; index < sorted.length; index++) {
        const window = sorted[index]
        const overlaps = index > 0 && sorted[index - 1].end > window.start
        if (window.start < window.end && !overlaps) continue
        throw new Error('Окна должны быть непересекающимися и заканчиваться в тот же день')
    }
}
export function validateResource(value: Resource) {
    if (!Number.isInteger(value.capacity) || value.capacity < 1 || value.capacity > 20) throw new Error('Вместимость от 1 до 20')
    if (!value.zone || /^[+-]/.test(value.zone)) throw new Error('Нужен именованный часовой пояс IANA')
    Temporal.Now.instant().toZonedDateTimeISO(value.zone)
    if (value.weekly.length > 56 || value.exceptions.length > 90) throw new Error('Слишком большое расписание')
    for (const window of value.weekly) if (!Number.isInteger(window.day) || window.day < 1 || window.day > 7) throw new Error('День недели от 1 до 7')
    for (let day = 1; day <= 7; day++) validateWindows(value.weekly.filter(value => value.day == day))
    const dates = new Set<string>()
    for (const exception of value.exceptions) {
        civilDate(exception.date)
        if (dates.has(exception.date)) throw new Error('Исключение для даты уже задано')
        dates.add(exception.date)
        validateWindows(exception.windows)
    }
}

// A repeated local hour produces two distinct instants; a nonexistent wall time produces none.
function instants(date: Temporal.PlainDate, clock: Temporal.PlainTime, zone: string) {
    const local = date.toPlainDateTime(clock)
    const values = ['earlier', 'later'].map(disambiguation => local.toZonedDateTime(zone, {disambiguation: disambiguation as 'earlier' | 'later'}))
    return [...new Set(values.filter(value => value.toPlainDateTime().equals(local)).map(value => value.epochMilliseconds))]
}
export function daySlots(resource: Resource, service: Offering, day: string) {
    const date = civilDate(day)
    const exception = resource.exceptions.find(value => value.date == day)
    const windows = exception ? exception.windows : resource.weekly.filter(value => value.day == date.dayOfWeek)
    const results = new Map<number, {start: number, end: number, occupiedFrom: number, occupiedTo: number, local: string, offset: string}>()
    for (const window of windows) {
        const startTime = time(window.start), endTime = time(window.end)
        const starts = instants(date, startTime, resource.zone)
        const ends = instants(date, endTime, resource.zone)
        const from = starts[0] ?? date.toPlainDateTime(startTime).toZonedDateTime(resource.zone, {disambiguation: 'later'}).epochMilliseconds
        const until = ends.at(-1) ?? date.toPlainDateTime(endTime).toZonedDateTime(resource.zone, {disambiguation: 'earlier'}).epochMilliseconds
        const limit = date.toPlainDateTime(endTime)
        let current = date.toPlainDateTime(startTime)
        for (; Temporal.PlainDateTime.compare(current, limit) < 0; current = current.add({minutes: 15})) {
            for (const start of instants(date, current.toPlainTime(), resource.zone)) {
                const end = start + service.duration * minute, occupiedFrom = start - service.before * minute, occupiedTo = end + service.after * minute
                if (occupiedFrom < from || occupiedTo > until) continue
                const zoned = Temporal.Instant.fromEpochMilliseconds(start).toZonedDateTimeISO(resource.zone)
                const local = zoned.toPlainDateTime().toString({smallestUnit: 'minute'})
                results.set(start, {start, end, occupiedFrom, occupiedTo, local, offset: zoned.offset})
            }
        }
    }
    return [...results.values()].sort((a, b) => a.start - b.start)
}
export function activeBooking(booking: BookingState['bookings'][string], at: number) {
    return booking.status == 'confirmed' || booking.status == 'held' && booking.holdUntil > at
}
export function remaining(state: BookingState, resource: Resource, from: number, until: number, at: number, exclude = '') {
    const points: {at: number, delta: number}[] = []
    for (const booking of Object.values(state.bookings)) {
        if (booking.id == exclude || booking.resourceId != resource.id) continue
        if (!activeBooking(booking, at)) continue
        if (booking.occupiedFrom >= until || booking.occupiedTo <= from) continue
        points.push({at: Math.max(from, booking.occupiedFrom), delta: booking.partySize}, {at: Math.min(until, booking.occupiedTo), delta: -booking.partySize})
    }
    let used = 0, peak = 0
    for (const point of points.sort((a, b) => a.at - b.at || a.delta - b.delta)) {
        used += point.delta
        peak = Math.max(peak, used)
    }
    return resource.capacity - peak
}
export function slotFor(state: BookingState, service: Offering, start: number, partySize: number, at: number, exclude = '') {
    const resource = state.resources[service.resourceId]
    if (!resource || !service.active) throw new Error('Услуга недоступна')
    if (!Number.isSafeInteger(start) || start <= at || start > at + 180 * 86400000) throw new Error('Выберите будущее время в пределах 180 дней')
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > service.capacity) throw new Error('Недопустимое число участников')
    const day = Temporal.Instant.fromEpochMilliseconds(start).toZonedDateTimeISO(resource.zone).toPlainDate().toString()
    const slot = daySlots(resource, service, day).find(value => value.start == start)
    if (!slot) throw new Error('Время не входит в расписание услуги')
    if (remaining(state, resource, slot.occupiedFrom, slot.occupiedTo, at, exclude) < partySize) throw new Error('На это время недостаточно свободных мест')
    return slot
}
export function availability(state: BookingState, service: Offering, input: {from: string, days: number, partySize: number}, at: number, exclude = '') {
    const from = civilDate(input.from), resource = state.resources[service.resourceId]
    if (!resource) throw new Error('Ресурс недоступен')
    if (!Number.isInteger(input.days) || input.days < 1 || input.days > 14) throw new Error('Запрашивайте от 1 до 14 дней')
    if (!Number.isInteger(input.partySize) || input.partySize < 1 || input.partySize > service.capacity) throw new Error('Недопустимое число участников')
    const today = Temporal.Instant.fromEpochMilliseconds(at).toZonedDateTimeISO(resource.zone).toPlainDate()
    const tooEarly = Temporal.PlainDate.compare(from, today.subtract({days: 1})) < 0
    const tooLate = Temporal.PlainDate.compare(from.add({days: input.days}), today.add({days: 181})) > 0
    if (tooEarly || tooLate) throw new Error('Диапазон вне горизонта записи')
    const slots = service.active ? Array.from({length: input.days}, (_, index) => daySlots(resource, service, from.add({days: index}).toString())).flat()
        .filter(slot => slot.start > at && slot.start <= at + 180 * 86400000)
        .map(slot => ({...slot, available: Math.min(service.capacity, remaining(state, resource, slot.occupiedFrom, slot.occupiedTo, at, exclude))}))
        .filter(slot => slot.available >= input.partySize) : []
    return {serviceId: service.id, resourceId: resource.id, zone: resource.zone, generatedAt: at, slots: slots.slice(0, 1000), truncated: slots.length > 1000}
}

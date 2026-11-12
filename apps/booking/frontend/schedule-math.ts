import {Temporal} from '@js-temporal/polyfill'
import type {Booking} from '../backend/model'

export function validScheduleDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    try {
        Temporal.PlainDate.from(value, {overflow: 'reject'})
        return true
    } catch {
        return false
    }
}

export function scheduleDay(date: string, zone: string) {
    const civil = Temporal.PlainDate.from(date)
    const start = civil.toZonedDateTime(zone)
    const end = civil.add({days: 1}).toZonedDateTime(zone)
    const minutes = (end.epochMilliseconds - start.epochMilliseconds) / 60000
    const ticks = Array.from({length: Math.ceil(minutes / 60)}, function tick(_value, index) {
        const instant = start.add({hours: index})
        return {at: instant.epochMilliseconds, label: instant.toPlainTime().toString().slice(0, 5), offset: instant.offset}
    })
    return {date, start: start.epochMilliseconds, end: end.epochMilliseconds, minutes, ticks, offset: start.offset, endOffset: end.offset}
}

export type ScheduleDay = ReturnType<typeof scheduleDay>

export function dateLabel(date: string) {
    return new Intl.DateTimeFormat('ru', {weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC'})
        .format(new Date(date + 'T12:00:00Z'))
}

export function intervalLanes(bookings: Booking[], day: ScheduleDay) {
    const ends: number[] = []
    const sorted = bookings.filter(item => item.start < day.end && item.end > day.start).sort((a, b) => a.start - b.start)
    const placed = sorted.map(function place(booking) {
        let lane = ends.findIndex(end => end <= booking.start)
        if (lane < 0) lane = ends.length
        ends[lane] = booking.end
        return {booking, lane}
    })
    return {placed, count: Math.max(1, ends.length)}
}

export function positionInDay(at: number, day: ScheduleDay) {
    return (at - day.start) / (day.end - day.start) * 100
}

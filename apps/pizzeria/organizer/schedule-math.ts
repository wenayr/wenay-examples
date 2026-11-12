const dayFormat = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'long', timeZone: 'UTC'})
const weekdayFormat = new Intl.DateTimeFormat('ru-RU', {weekday: 'short', timeZone: 'UTC'})

export function localDate() {
    return new Date().toLocaleDateString('sv-SE')
}

export function validScheduleDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const parsed = new Date(value + 'T12:00:00Z')
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) == value
}

export function shiftDate(date: string, days: number) {
    if (!validScheduleDate(date) || !Number.isInteger(days)) return ''
    const shifted = new Date(date + 'T12:00:00Z')
    shifted.setUTCDate(shifted.getUTCDate() + days)
    if (!Number.isFinite(shifted.getTime())) return date
    const result = shifted.toISOString().slice(0, 10)
    // Не выводим календарь за четырёхзначный контракт даты домена.
    return validScheduleDate(result) ? result : date
}

export function weekOf(date: string) {
    if (!validScheduleDate(date)) return ''
    const day = new Date(date + 'T12:00:00Z').getUTCDay()
    return shiftDate(date, -((day + 6) % 7))
}

export function dayLabel(date: string) {
    if (!validScheduleDate(date)) return '—'
    return dayFormat.format(new Date(date + 'T12:00:00Z'))
}

export function weekdayLabel(date: string) {
    if (!validScheduleDate(date)) return '—'
    return weekdayFormat.format(new Date(date + 'T12:00:00Z'))
}

export function timeLabel(minute: number) {
    return String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0')
}

export function durationLabel(minutes: number) {
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    const parts = []
    if (hours) parts.push(hours + ' ч')
    if (rest) parts.push(rest + ' мин')
    return parts.join(' ') || '0 мин'
}

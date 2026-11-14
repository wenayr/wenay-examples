import type {PlaceQuery} from './catalog.ts'
import {packageDestinations, packageMaxTotal, packageWindowDays} from '../src/package-contract.ts'

export function numberParam(value: string | null, fallback: number, max: number, min: number) {
    if (value == null) return fallback
    if (!/^\d+$/.test(value)) throw new RangeError('Введите целое число.')
    const result = Number(value)
    if (result < min || result > max) throw new RangeError('Значение выходит за пределы диапазона.')
    return result
}

export function mapBox(params: URLSearchParams): PlaceQuery['box'] {
    const values = ['west', 'south', 'east', 'north'].map(key => params.get(key))
    if (values.every(v => v == null)) return null
    if (values.some(v => v == null || !v.trim())) throw new RangeError('Укажите все границы карты.')
    const bounds = values.map(Number)
    if (!bounds.every(Number.isFinite)) throw new RangeError('Некорректные координаты карты.')
    const [west, south, east, north] = bounds
    if (west < -180 || east > 180 || west > east) throw new RangeError('Некорректный диапазон долгот.')
    if (south < -90 || north > 90 || south > north) throw new RangeError('Некорректный диапазон широт.')
    return [west, south, east, north]
}

export function dateValue(date: string | null) {
    if (!date) throw new RangeError('Укажите обе даты.')
    const epoch = Date.parse(date + 'T00:00:00Z')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(epoch)) throw new RangeError('Некорректная дата.')
    if (new Date(epoch).toISOString().slice(0, 10) != date) throw new RangeError('Некорректная дата.')
    return date
}

export function validateTravelDates(checkIn: string | null, checkOut: string | null, today: string) {
    if (checkIn == null && checkOut == null) return
    if (!checkIn || !checkOut) throw new RangeError('Укажите обе даты поездки.')
    dateValue(checkIn)
    dateValue(checkOut)
    if (checkIn < today || checkOut <= checkIn) throw new RangeError('Проверьте порядок дат и день выезда.')
    if (Date.parse(checkOut) - Date.parse(checkIn) > 30 * 86_400_000) throw new RangeError('Поиск доступен для поездок до 30 ночей.')
}

export function packageQuery(params: URLSearchParams, destinationId: string, today: string) {
    if (!packageDestinations.some(id => id == destinationId)) throw new RangeError('Для этого направления пакетный поиск недоступен.')
    const first = dateValue(params.get('firstDeparture'))
    const last = dateValue(params.get('lastDeparture'))
    if (first < today || last < first) throw new RangeError('Проверьте даты вылета.')
    if (Date.parse(last) - Date.parse(first) >= packageWindowDays * 86_400_000) throw new RangeError('Можно выбрать до 20 дат вылета.')
    const origin = params.get('origin') ?? 'TLL'
    const currency = params.get('currency') ?? 'EUR'
    if (origin != 'TLL' || currency != 'EUR') throw new RangeError('Поиск поддерживает вылет из Таллина и цены в евро.')
    const minTotal = numberParam(params.get('minTotal'), 0, packageMaxTotal, 0)
    const maxTotal = numberParam(params.get('maxTotal'), packageMaxTotal, packageMaxTotal, 0)
    if (minTotal > maxTotal) throw new RangeError('Проверьте границы бюджета.')
    const trip = {destinationId, first, last, minTotal, maxTotal, nights: numberParam(params.get('nights'), 7, 30, 1),
        adults: numberParam(params.get('adults'), 2, 2, 2)}
    const filter = {firstDeparture: first, lastDeparture: last, minTotal, maxTotal, box: mapBox(params),
        minStars: numberParam(params.get('minStars'), 0, 5, 0), offset: numberParam(params.get('offset'), 0, Number.MAX_SAFE_INTEGER, 0),
        limit: numberParam(params.get('limit'), 12, 100, 1)}
    return {trip, filter}
}

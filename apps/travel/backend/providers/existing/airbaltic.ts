import type {ProviderAdapter} from '../../../src/provider-contract.ts'
import {balticUrl, readBalticCalendar} from '../../flights/airbaltic.ts'
import {calendarOffers, flightQuery, unsupported} from './common.ts'

export const airbalticAdapter = {
    async search(query, deps) {
        const flight = flightQuery(query)
        if (!flight) return unsupported('airbaltic', 'Укажите два аэропорта IATA и дату вылета.')
        if (flight.checkedBag) return unsupported('airbaltic', 'Календарный минимум не подтверждает включённый зарегистрированный багаж.')
        const one = {...flight, adults: 1, returnDate: null}
        const url = balticUrl(one)
        const response = await deps.fetch(url, {signal: AbortSignal.timeout(12_000), redirect: 'error'})
        if (!response.ok) throw new Error('Календарь airBaltic недоступен.')
        const checkedAt = deps.now().toISOString()
        const rows = readBalticCalendar(await response.text(), {...one, returnDate: flight.returnDate}, checkedAt.slice(0, 10))
        return {providerId: 'airbaltic', status: 'live', checkedAt, sourceUrl: url,
            description: 'Публичные минимумы за одного взрослого в одну сторону, окно ±3 даты.',
            offers: calendarOffers('airbaltic', 'airBaltic', rows, flight, checkedAt)}
    }
} satisfies ProviderAdapter

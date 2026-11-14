import type {ProviderAdapter} from '../../../src/provider-contract.ts'
import {ryanairCalendar} from '../../flights/ryanair.ts'
import {calendarOffers, flightQuery, unsupported} from './common.ts'

export const ryanairAdapter = {
    async search(query, deps) {
        const flight = flightQuery(query)
        if (!flight) return unsupported('ryanair', 'Укажите два аэропорта IATA и дату вылета.')
        const result = await ryanairCalendar(deps, flight)
        const checkedAt = result.source.updatedAt
        return {providerId: 'ryanair', status: result.source.status, checkedAt, description: result.source.description,
            sourceUrl: result.source.url, offers: checkedAt ? calendarOffers('ryanair', 'Ryanair', result.rows, flight, checkedAt) : []}
    }
} satisfies ProviderAdapter

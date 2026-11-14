import type {ProviderAdapter, ProviderOffer, ProviderQuery} from '../../../src/provider-contract.ts'
import {amount, failed, json, list, record, text, unavailable, validFlightQuery} from './common.ts'

const providerId = 'travelport-flights'
const endpoint = 'https://api.travelport.net/11/air/catalog/search/catalogproductofferings'
const docsUrl = 'https://support.travelport.com/webhelp/JSONAPIs/Airv11/Content/Air11/Search/APIRef_Search.htm'

export function travelportRequest(query: ProviderQuery, includeNdc = false) {
    const trips = [{origin: query.origin!, destination: query.destination!, date: query.departure!}]
    if (query.returnDate) trips.push({origin: query.destination!, destination: query.origin!, date: query.returnDate})
    return {CatalogProductOfferingsQueryRequest: {CatalogProductOfferingsRequest: {
        '@type': 'CatalogProductOfferingsRequestAir', offersPerPage: 30, maxNumberOfUpsellsToReturn: 0,
        contentSourceList: includeNdc ? ['GDS', 'NDC'] : ['GDS'], sortBy: 'Price-LowToHigh',
        PassengerCriteria: [{'@type': 'PassengerCriteria', passengerTypeCode: 'ADT', number: query.adults}],
        SearchCriteriaFlight: trips.map(trip => ({'@type': 'SearchCriteriaFlight', departureDate: trip.date,
            From: {value: trip.origin, cityOrAirport: 'Airport Only'}, To: {value: trip.destination, cityOrAirport: 'Airport Only'}})),
        SearchModifiersAir: {'@type': 'SearchModifiersAir', CabinPreference: [
            {'@type': 'CabinPreference', preferenceType: 'Permitted', cabins: ['Economy']}]},
        PricingModifiersAir: {'@type': 'PricingModifiersAir', currencyCode: query.currency ?? 'EUR'},
        CustomResponseModifiersAir: {'@type': 'CustomResponseModifiersAir', SearchRepresentation: 'Journey'}
    }}}
}

function minutes(value: unknown) {
    const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(text(value))
    return match ? Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0) : null
}

function productDetails(product: Record<string, unknown>, flights: Map<string, Record<string, unknown>>, adults: number) {
    const passengers = list(product.PassengerFlight)
    const matchingAdults = passengers.length == 1 && passengers[0].passengerTypeCode == 'ADT' && passengers[0].passengerQuantity == adults
    if (!matchingAdults) return null
    const cabins = list(passengers[0].FlightProduct)
    if (!cabins.length || cabins.some(cabin => cabin.cabin != 'Economy')) return null
    const segments = list(product.FlightSegment).sort((a, b) => Number(a.sequence) - Number(b.sequence))
    const resolved = segments.map(segment => flights.get(text(record(segment.Flight).FlightRef)))
    if (!resolved.length || resolved.some(flight => !flight)) return null
    const first = resolved[0]!, last = resolved.at(-1)!
    const origin = text(record(first.Departure).location), destination = text(record(last.Arrival).location)
    const date = text(record(first.Departure).date)
    const carriers = [...new Set(resolved.map(flight => text(flight!.carrier)).filter(Boolean))]
    return {origin, destination, date, carrier: carriers.join(', ') || null, stops: resolved.length - 1,
        durationMinutes: minutes(product.totalDuration)}
}

function readCandidates(body: Record<string, unknown>, query: ProviderQuery) {
    const references = list(body.ReferenceList)
    const flights = new Map(references.flatMap(reference => list(reference.Flight)).map(flight => [text(flight.id), flight]))
    const products = new Map(references.flatMap(reference => list(reference.Product)).map(product => [text(product.id), product]))
    const rows = []
    for (const offering of list(record(body.CatalogProductOfferings).CatalogProductOffering)) {
        for (const options of list(offering.ProductBrandOptions)) {
            for (const brand of list(options.ProductBrandOffering)) {
                const productRefs = list(brand.Product)
                if (productRefs.length != 1) continue
                const productId = text(productRefs[0].productRef)
                const product = products.get(productId)
                const details = product ? productDetails(product, flights, query.adults) : null
                if (!details) continue
                const price = record(brand.BestCombinablePrice)
                const value = amount(price.TotalPrice)
                const currency = text(record(price.CurrencyCode).value)
                if (!value || currency != (query.currency ?? 'EUR')) continue
                const breakdown = list(price.PriceBreakdown)
                const passengerCount = breakdown.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0)
                if (!breakdown.length || passengerCount != query.adults || breakdown.some(item => item.requestedPassengerType != 'ADT')) continue
                const codes = Array.isArray(brand.CombinabilityCode) ? brand.CombinabilityCode.map(text).filter(Boolean) : []
                rows.push({id: [offering.id, productId, record(brand.Brand).BrandRef].join('-'), details, codes, value, currency,
                    taxes: typeof price.TotalTaxes == 'number' ? true : null})
            }
        }
    }
    return rows
}

export function readTravelport(payload: unknown, query: ProviderQuery, checkedAt: string): ProviderOffer[] {
    if (query.checkedBag) return []
    const body = record(record(payload).CatalogProductOfferingsResponse)
    if (!body.CatalogProductOfferings || list(record(body.Result).Error).length) throw new Error('Источник не прислал предложения')
    const candidates = readCandidates(body, query)
    const outbound = candidates.filter(row => row.details.origin == query.origin && row.details.destination == query.destination &&
        row.details.date == query.departure)
    const inbound = candidates.filter(row => row.details.origin == query.destination && row.details.destination == query.origin &&
        row.details.date == query.returnDate)
    const incoming = new Map<string, typeof inbound[number]>()
    for (const row of inbound) {
        for (const code of row.codes) incoming.set(JSON.stringify([code, row.currency, row.value]), row)
    }
    const result: ProviderOffer[] = []
    for (const row of outbound) {
        const pairing = row.codes.map(code => incoming.get(JSON.stringify([code, row.currency, row.value]))).find(Boolean)
        if (query.returnDate && !pairing) continue
        const id = providerId + '-' + row.id + (pairing ? '-' + pairing.id : '')
        result.push({id, providerId, kind: 'flights', title: row.details.carrier ?? 'Перелёт Travelport',
            price: {amount: row.value, currency: row.currency, basis: 'party'}, accuracy: 'live-offer',
            sourceUrl: docsUrl, bookingUrl: null, checkedAt, expiresAt: null, adults: query.adults,
            departure: query.departure, returnDate: query.returnDate ?? null,
            flight: {origin: row.details.origin, destination: row.details.destination, carrier: row.details.carrier,
                stops: row.details.stops, durationMinutes: row.details.durationMinutes},
            includes: {checkedBags: null, taxes: row.taxes}, comparisonKey: null,
            conditions: 'Полная цена за всех взрослых по BestCombinablePrice. Для обратного рейса подтверждена совместимость частей маршрута. Повторная тарификация и оформление через агентский договор Travelport.'})
    }
    return result.sort((a, b) => a.price.amount - b.price.amount).slice(0, 50)
}

const adapter = {
    async search(query, deps) {
        if (!validFlightQuery(query)) return unavailable(providerId, 'Укажите конкретные аэропорты, даты и число взрослых.')
        if (query.checkedBag) return unavailable(providerId, 'Полный багаж проверяется при подробной тарификации Travelport. Уточните тариф у агентства.')
        const token = deps.env.TRAVELPORT_ACCESS_TOKEN, accessGroup = deps.env.TRAVELPORT_ACCESS_GROUP
        if (!token || !accessGroup) {
            return unavailable(providerId, 'Нужны договор TripServices Air 11, bearer token и access group агентства.', 'requires-access')
        }
        try {
            const headers = {Authorization: 'Bearer ' + token, 'XAUTH_TRAVELPORT_ACCESSGROUP': accessGroup,
                'Content-Type': 'application/json', 'Accept-Encoding': 'gzip, deflate', 'Cache-Control': 'no-cache',
                'Accept-Version': '11', 'Content-Version': '11'}
            const payload = await json(deps, endpoint, {method: 'POST', headers,
                body: JSON.stringify(travelportRequest(query, deps.env.TRAVELPORT_INCLUDE_NDC == 'true'))})
            const checkedAt = deps.now().toISOString()
            return {providerId, status: 'live', checkedAt, offers: readTravelport(payload, query, checkedAt), sourceUrl: docsUrl,
                description: 'Текущие предложения TripServices Air 11. Суммы за всех взрослых в выбранной валюте. Оформление через агентский договор.'}
        } catch (error) { return failed(providerId, error) }
    }
} satisfies ProviderAdapter

export default adapter

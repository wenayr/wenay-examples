import type {ProviderAvailability, ProviderQuery, ProviderSearch} from '../../src/provider-contract.ts'
import {
    marketCountries, type CountryMarket, type MarketCatalog, type MarketEvidence, type MarketNotice, type MarketProvider,
    type MarketRecord, type tMarketCountry
} from '../../src/market-contract.ts'
import {airportByCode} from '../flights/airports.ts'
import {europeanMarkets} from './europe.ts'
import {asianMarkets} from './asia.ts'
import {marketCities} from './locations.ts'
import {operatingModel, queryMarkets, russiaTourismNotice, ukraineAirspaceNotice} from './policy.ts'

export const marketRecords = {...europeanMarkets, ...asianMarkets}

const airlines = new Map<string, {name: string, iata: string, country: string, website: string}>()
for (const record of Object.values(marketRecords)) {
    for (const partner of record.airlines) {
        if (!partner.iata || !partner.country) continue
        airlines.set(partner.id, {name: partner.name, iata: partner.iata, country: partner.country, website: partner.website})
    }
}
export const marketAirlineDirectory = Object.fromEntries(airlines)

export interface MarketQueryCheck {
    country: string
    providerId: string
    kind: ProviderQuery['kind']
    scope: 'origin' | 'destination'
    description: string
    evidence: MarketEvidence
}

export function contextualProviderIds(query: ProviderQuery, ids: string[]) {
    const countries = queryMarkets(query)
    const related = [countries.origin, countries.destination].filter(code => !!code && code in marketRecords) as tMarketCountry[]
    const preferred = new Set(related.flatMap(code => {
        const record: MarketRecord = marketRecords[code]
        return [...record.airlines, ...record.tourism].flatMap(partner => partner.providerIds ?? [])
    }))
    return [...ids].sort((first, second) => Number(preferred.has(second)) - Number(preferred.has(first)))
}

export function marketChecks(query: ProviderQuery, result: ProviderSearch): MarketQueryCheck[] {
    const countries = queryMarkets(query)
    const entries = Object.entries(countries).filter((entry): entry is ['origin' | 'destination', string] => !!entry[1])
    const ready = result.results.filter(source => source.status == 'live' && source.offers.length)
    return ready.flatMap(source => entries.map(([scope, country]) => ({
        country, providerId: source.providerId, kind: query.kind, scope,
        description: 'Запрос ' + [query.origin, query.destination, query.departure ?? query.checkIn, query.returnDate ?? query.checkOut]
            .filter(Boolean).join(' → ') + ', взрослых ' + query.adults + '. Основания цен: ' +
            [...new Set(source.offers.map(offer => ({party: 'за группу', person: 'за человека', 'room-night': 'за номер-ночь'})[offer.price.basis]))]
                .join(', ') + '. Другие маршруты, даты и окончательные условия требуют отдельной проверки.',
        evidence: {title: 'Получены предложения на запрос, направление ' + (scope == 'origin' ? 'из страны' : 'в страну'),
            url: source.offers[0].sourceUrl, checkedAt: source.checkedAt ?? result.checkedAt},
    })))
}

function coverage(source: ProviderAvailability, code: tMarketCountry, checks: MarketQueryCheck[]): MarketProvider {
    const verified = checks.filter(check => check.country == code && check.providerId == source.id)
    let status: MarketProvider['coverage'] = 'request-check'
    let description = 'Покрытие конкретных аэропортов, объектов, дат и рынка продажи проверяется запросом. Ключ доступа сам по себе не подтверждает наличие тарифа.'
    let evidence: MarketEvidence[] = []
    if (source.id == 'rakuten') {
        status = code == 'JP' ? 'documented' : 'unavailable'
        description = code == 'JP' ? 'Документирован поиск японских гостиниц. Доступные номера и стоимость проверяет конкретный запрос.' :
            'Этот адаптер ищет гостиницы в Японии.'
        evidence = [{title: 'Rakuten Travel VacantHotelSearch', url: source.docsUrl, checkedAt: '2026-11-14'}]
    }
    if (!source.enabled || source.access == 'retired') status = 'unavailable'
    if (verified.length && status != 'unavailable') {
        status = 'query-verified'
        description = verified.map(check => check.description).join(' ')
        evidence = verified.map(check => check.evidence)
    }
    return {providerId: source.id, name: source.name, kinds: source.kinds, status: source.status, configured: source.configured,
        enabled: source.enabled, coverage: status, coverageDescription: description, evidence, docsUrl: source.docsUrl,
        activation: source.activation, onboarding: source.onboarding}
}

export function describeMarkets(sources: {items: ProviderAvailability[]}, checks: MarketQueryCheck[] = [], country?: string): MarketCatalog {
    if (country && !(country in marketCountries)) throw new RangeError('Страна отсутствует в выбранных 20 рынках.')
    const codes = country ? [country as tMarketCountry] : Object.keys(marketCountries) as tMarketCountry[]
    const items: CountryMarket[] = codes.map(code => {
        const info = marketCountries[code]
        const record: MarketRecord = marketRecords[code]
        const hubs = record.airports.flatMap(iata => {
            const airport = airportByCode(iata)
            return airport ? [{iata, city: airport.city, name: airport.name}] : []
        })
        const notices: MarketNotice[] = [...record.notices]
        if (code == 'UA' && !notices.some(notice => notice.kind == 'airspace')) notices.unshift(ukraineAirspaceNotice)
        if (code == 'RU' && !notices.some(notice => notice.kind == 'commercial')) notices.unshift(russiaTourismNotice)
        let aviationStatus: CountryMarket['aviationStatus'] = 'request-check'
        if (code == 'UA') aviationStatus = 'closed'
        if (code == 'RU') aviationStatus = 'restricted'
        return {...info, ...record, notices, code, hubs, cities: marketCities[code], aviationStatus,
            commercialStatus: code == 'RU' ? 'review-required' : 'request-check',
            providers: sources.items.map(source => coverage(source, code, checks))}
    })
    const airlines = new Set(items.flatMap(item => item.airlines.map(airline => airline.iata ?? airline.id)))
    const tourism = new Set(items.flatMap(item => item.tourism.map(partner => partner.id)))
    return {items, checkedAt: operatingModel.checkedAt,
        selection: 'Практический список 20 рынков Евразии с учётом выбранных пользователем стран, соседних рынков и крупных направлений. ' +
            'Страна назначения, страна продажи и гражданство путешественника задаются отдельно.',
        summary: {countries: items.length, airlines: airlines.size, tourismPartners: tourism.size, priceProviders: sources.items.length}}
}

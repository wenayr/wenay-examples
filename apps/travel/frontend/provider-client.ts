import {useEffect, useState} from 'react'
import type {ProviderAvailability, ProviderQuery, ProviderSearch, tProviderKind, tProviderStatus} from '../src/provider-contract.ts'
import {providerKinds} from '../src/provider-contract.ts'
import {directoryUrl} from './directory-query.ts'
import {shiftDate, validDate} from './directory-preferences.ts'
import {travelHash} from './navigation.ts'

export const providerKindNames = {
    flights: 'Перелёты', hotels: 'Отели', packages: 'Пакетные туры', deals: 'Горящие предложения',
} as const satisfies Record<tProviderKind, string>

export const providerStatusNames = {
    ready: 'Готов к проверке', sandbox: 'Тестовая среда',
    live: 'Данные получены', cached: 'Сохранённый ответ', 'requires-access': 'Подключение по договору',
    unavailable: 'Источник не ответил', 'unsupported-query': 'Уточните параметры', handoff: 'Поиск на сайте',
} as const satisfies Record<tProviderStatus, string>
const snapshots = new Map<string, ProviderSearch>()

export function providerAvailable(item: ProviderAvailability) {
    const active = item.enabled && item.configured
    return active && item.activeEnvironment != 'sandbox' && item.status != 'sandbox'
}

function optionalNumber(params: URLSearchParams, name: string) {
    const raw = params.get(name)
    if (raw === null || raw.trim() == '') return undefined
    const value = Number(raw)
    return Number.isFinite(value) ? value : undefined
}

export function providerQueryFromParams(params: URLSearchParams, kind: tProviderKind = 'hotels'): ProviderQuery {
    const today = new Date().toISOString().slice(0, 10)
    const requested = params.get('kind')
    const query: ProviderQuery = {
        kind: providerKinds.includes(requested as tProviderKind) ? requested as tProviderKind : kind,
        adults: optionalNumber(params, 'adults') ?? 2,
        currency: params.get('currency') || 'EUR',
    }
    for (const name of ['origin', 'destination', 'departure', 'checkIn', 'checkOut', 'nationality', 'bookerCountry', 'country'] as const) {
        const value = params.get(name)
        if (value) query[name] = value.slice(0, 160)
    }
    if (query.kind != 'deals') {
        if (!query.departure) query.departure = shiftDate(today, 7)
        if (!query.checkIn) query.checkIn = query.departure
        if (!query.checkOut) query.checkOut = shiftDate(query.checkIn, 7)
    }
    if (params.has('returnDate')) query.returnDate = params.get('returnDate') || null
    for (const name of ['latitude', 'longitude', 'radiusKm', 'rooms', 'nights', 'offset', 'limit'] as const) {
        const value = optionalNumber(params, name)
        if (value !== undefined) query[name] = value
    }
    if (params.has('checkedBag')) query.checkedBag = params.get('checkedBag') == 'true'
    const providers = params.get('providers')?.split(',').filter(id => /^[a-z0-9-]{1,60}$/.test(id))
    if (providers?.length) query.providers = providers
    const ages = params.get('adultAges')?.split(',').map(Number)
    const validAges = ages?.every(age => Number.isInteger(age) && age >= 18 && age <= 120)
    if (validAges && ages?.length == query.adults) query.adultAges = ages
    const references = params.get('providerRefs')
    if (references) {
        try {
            const raw: unknown = JSON.parse(references)
            if (raw && typeof raw == 'object' && !Array.isArray(raw)) {
                const refs: NonNullable<ProviderQuery['providerRefs']> = {}
                for (const [id, entry] of Object.entries(raw)) {
                    if (!/^[a-z0-9-]{1,60}$/.test(id) || !entry || typeof entry != 'object') continue
                    const ref = entry as {hotelIds?: unknown, destinationId?: unknown}
                    const hotelIds = Array.isArray(ref.hotelIds) ? ref.hotelIds.filter(value => typeof value == 'string').slice(0, 20) : undefined
                    refs[id] = {hotelIds, destinationId: typeof ref.destinationId == 'string' ? ref.destinationId.slice(0, 120) : undefined}
                }
                query.providerRefs = refs
            }
        } catch { /* Other query fields remain usable if an old saved reference cannot be read. */ }
    }
    return query
}

export function providerQueryParams(query: ProviderQuery) {
    const values: Record<string, string | number | undefined> = {kind: query.kind, adults: query.adults, currency: query.currency}
    for (const key of ['origin', 'destination', 'departure', 'returnDate', 'checkIn', 'checkOut', 'nationality', 'bookerCountry', 'country'] as const) {
        values[key] = query[key] ?? ''
    }
    for (const key of ['latitude', 'longitude', 'radiusKm', 'rooms', 'nights', 'offset', 'limit'] as const) values[key] = query[key]
    if (query.checkedBag !== undefined) values.checkedBag = String(query.checkedBag)
    if (query.providers?.length) values.providers = query.providers.join(',')
    if (query.adultAges?.length) values.adultAges = query.adultAges.join(',')
    if (query.providerRefs) values.providerRefs = JSON.stringify(query.providerRefs)
    return values
}

export function providerQueryLink(query: ProviderQuery) {
    return travelHash(query.kind == 'deals' ? 'deals' : 'prices', undefined, providerQueryParams(query))
}

export function providerQueryError(query: ProviderQuery) {
    if (!Number.isInteger(query.adults) || query.adults < 1 || query.adults > 9) return 'Укажите от одного до девяти взрослых.'
    if (query.providers && !query.providers.length) return 'Выберите хотя бы один источник.'
    if (query.adultAges) {
        const ages = query.adultAges
        const valid = ages.length == query.adults && ages.every(age => Number.isInteger(age) && age >= 18 && age <= 120)
        if (!valid) return 'Укажите возраст каждого взрослого от 18 до 120 лет.'
    }
    if (query.kind == 'deals') {
        if (query.origin && !/^[A-Z]{3}$/.test(query.origin)) return 'Выберите аэропорт вылета или оставьте все аэропорты.'
        if (query.departure && !validDate(query.departure)) return 'Проверьте выбранную дату вылета.'
        if (query.returnDate && !validDate(query.returnDate)) return 'Проверьте дату возвращения.'
        return ''
    }
    if (query.kind == 'hotels') {
        const latitude = query.latitude
        const longitude = query.longitude
        const region = latitude != null && longitude != null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
        const references = Object.values(query.providerRefs ?? {}).some(ref => ref.hotelIds?.length || ref.destinationId)
        const city = Boolean(query.destination?.trim())
        if (!region && !references && !city) return 'Укажите город, выберите район на карте или код отеля у поставщика.'
        if (!validDate(query.checkIn) || !validDate(query.checkOut) || query.checkOut <= query.checkIn) return 'Проверьте даты проживания.'
    } else {
        if (!query.origin || !/^[A-Z]{3}$/.test(query.origin)) return 'Выберите аэропорт вылета.'
        if (!query.destination) return 'Укажите направление поездки.'
        if (!validDate(query.departure)) return 'Укажите дату вылета.'
        if (query.kind == 'flights' && !/^[A-Z]{3}$/.test(query.destination)) return 'Выберите аэропорт прилёта.'
        if (query.returnDate && (!validDate(query.returnDate) || query.returnDate < query.departure)) return 'Проверьте дату возвращения.'
    }
    return ''
}

export function useProviderSearch(query: ProviderQuery | null, refresh: number) {
    const key = query ? JSON.stringify(query) : ''
    const [state, setState] = useState<{key: string, loading: boolean, data?: ProviderSearch, error?: string} | null>(null)
    useEffect(() => {
        if (!query) return
        const controller = new AbortController()
        setState({key, loading: true, data: snapshots.get(key)})
        async function load() {
            try {
                const response = await fetch(directoryUrl('provider-search'), {
                    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(query), signal: controller.signal,
                })
                const value = await response.json()
                if (controller.signal.aborted) return
                if (!response.ok) {
                    setState({key, loading: false, data: snapshots.get(key),
                        error: typeof value?.error == 'string' ? value.error : 'Не удалось выполнить поиск.'})
                    return
                }
                if (snapshots.size >= 24) snapshots.delete(snapshots.keys().next().value!)
                snapshots.set(key, value as ProviderSearch)
                setState({key, loading: false, data: value as ProviderSearch})
            } catch {
                if (!controller.signal.aborted) setState({key, loading: false, data: snapshots.get(key), error: 'Не удалось получить ответ. Повторите поиск.'})
            }
        }
        void load()
        return () => controller.abort()
    }, [key, refresh])
    return state?.key == key ? state : {key, loading: Boolean(query)}
}

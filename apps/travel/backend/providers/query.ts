import {providerKinds, type ProviderQuery} from '../../src/provider-contract.ts'
import {dateValue} from '../travel-query.ts'

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value != 'object' || Array.isArray(value)) throw new RangeError('Ожидались параметры поиска.')
    return value as Record<string, unknown>
}

export function readProviderQuery(raw: unknown, today: string): ProviderQuery {
    const input = record(raw)
    const kind = input.kind
    if (!providerKinds.some(value => value == kind)) throw new RangeError('Выберите авиабилеты, отели, туры или выгодные предложения.')
    const adults = input.adults ?? 2
    if (!Number.isInteger(adults) || Number(adults) < 1 || Number(adults) > 9) throw new RangeError('Укажите от 1 до 9 взрослых.')
    const query: ProviderQuery = {kind: kind as ProviderQuery['kind'], adults: Number(adults)}
    const fields = ['origin', 'destination', 'currency', 'nationality', 'bookerCountry', 'country'] as const
    for (const key of fields) {
        if (input[key] === undefined) continue
        const value = input[key]
        if (typeof value != 'string' || value.length > 120) throw new RangeError('Проверьте направление, валюту и страну.')
        query[key] = value.trim()
    }
    if (query.currency && !/^[A-Z]{3}$/.test(query.currency)) throw new RangeError('Укажите трёхбуквенный код валюты.')
    for (const key of ['nationality', 'bookerCountry', 'country'] as const) {
        if (query[key] && !/^[A-Z]{2}$/.test(query[key])) throw new RangeError('Страна указывается двухбуквенным кодом ISO.')
    }
    for (const key of ['departure', 'returnDate', 'checkIn', 'checkOut'] as const) {
        const value = input[key]
        if (value === null && key == 'returnDate') {
            query.returnDate = null
            continue
        }
        if (value === undefined || value === '') continue
        if (typeof value != 'string') throw new RangeError('Укажите дату в формате ГГГГ-ММ-ДД.')
        const date = dateValue(value)
        if (date < today) throw new RangeError('Дата поездки уже прошла.')
        query[key] = date
    }
    if (query.returnDate && query.departure && query.returnDate < query.departure) throw new RangeError('Обратный вылет раньше первого.')
    if (query.checkIn && query.checkOut && query.checkOut <= query.checkIn) throw new RangeError('Выезд должен быть позже заезда.')
    for (const key of ['latitude', 'longitude', 'radiusKm', 'rooms', 'nights', 'limit', 'offset'] as const) {
        if (input[key] === undefined) continue
        const value = input[key]
        if (typeof value != 'number' || !Number.isFinite(value)) throw new RangeError('Проверьте координаты и число комнат.')
        query[key] = value
    }
    if (query.latitude !== undefined && Math.abs(query.latitude) > 90) throw new RangeError('Широта вне допустимого диапазона.')
    if (query.longitude !== undefined && Math.abs(query.longitude) > 180) throw new RangeError('Долгота вне допустимого диапазона.')
    if (query.radiusKm !== undefined && query.radiusKm <= 0) throw new RangeError('Радиус поиска должен быть положительным.')
    const validRooms = Number.isInteger(query.rooms) && query.rooms! >= 1 && query.rooms! <= query.adults
    if (query.rooms !== undefined && !validRooms) {
        throw new RangeError('Число комнат должно быть целым и не превышать число взрослых.')
    }
    const validLimit = Number.isInteger(query.limit) && query.limit! >= 1 && query.limit! <= 100
    if (query.limit !== undefined && !validLimit) throw new RangeError('Лимит от 1 до 100.')
    if (query.offset !== undefined && (!Number.isSafeInteger(query.offset) || query.offset < 0)) throw new RangeError('Некорректная страница источника.')
    const validNights = Number.isInteger(query.nights) && query.nights! >= 1 && query.nights! <= 30
    if (query.nights !== undefined && !validNights) throw new RangeError('Длительность от 1 до 30 ночей.')
    if (input.checkedBag !== undefined) {
        if (typeof input.checkedBag != 'boolean') throw new RangeError('Укажите требование к багажу.')
        query.checkedBag = input.checkedBag
    }
    if (input.adultAges !== undefined) {
        const ages = input.adultAges
        if (!Array.isArray(ages) || ages.length != query.adults) throw new RangeError('Укажите возраст каждого взрослого.')
        if (!ages.every(age => Number.isInteger(age) && age >= 18 && age <= 120)) throw new RangeError('Проверьте возраст взрослых.')
        query.adultAges = ages
    }
    if (input.providers !== undefined) {
        const ids = input.providers
        if (!Array.isArray(ids) || ids.length > 40) throw new RangeError('Выберите до 40 источников.')
        if (!ids.every(id => typeof id == 'string' && /^[a-z][a-z0-9-]{0,59}$/.test(id))) throw new RangeError('Некорректный источник.')
        query.providers = [...new Set(ids)]
    }
    if (input.providerRefs !== undefined) {
        const refs = record(input.providerRefs)
        if (Object.keys(refs).length > 40) throw new RangeError('Слишком много сопоставлений отелей.')
        query.providerRefs = {}
        for (const [id, rawRef] of Object.entries(refs)) {
            if (!/^[a-z][a-z0-9-]{0,59}$/.test(id)) throw new RangeError('Некорректный источник сопоставления.')
            const ref = record(rawRef)
            const hotelIds = ref.hotelIds
            if (hotelIds !== undefined && (!Array.isArray(hotelIds) || hotelIds.length > 100)) throw new RangeError('Выберите до 100 кодов отелей.')
            const validIds = !hotelIds || hotelIds.every(value => typeof value == 'string' && value.length > 0 && value.length <= 120)
            if (!validIds) {
                throw new RangeError('Проверьте коды отелей поставщика.')
            }
            const destinationId = ref.destinationId
            if (destinationId !== undefined && (typeof destinationId != 'string' || destinationId.length > 120)) {
                throw new RangeError('Проверьте код направления поставщика.')
            }
            query.providerRefs[id] = {hotelIds, destinationId} as NonNullable<ProviderQuery['providerRefs']>[string]
        }
    }
    return query
}

export function providerParams(params: URLSearchParams) {
    const values: Record<string, unknown> = Object.fromEntries(params)
    for (const key of ['adults', 'rooms', 'nights', 'latitude', 'longitude', 'radiusKm', 'limit', 'offset']) {
        if (params.has(key)) values[key] = Number(params.get(key))
    }
    if (params.has('checkedBag')) {
        const checked = params.get('checkedBag')
        values.checkedBag = checked == 'true' || checked == 'false' ? checked == 'true' : checked
    }
    if (params.has('providers')) values.providers = params.get('providers')?.split(',').filter(Boolean)
    return values
}

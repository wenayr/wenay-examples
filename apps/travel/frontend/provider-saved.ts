import {localStorageCache} from 'wenay-react2/persist'
import type {ProviderOffer, ProviderQuery} from '../src/provider-contract.ts'
import {providerKinds} from '../src/provider-contract.ts'
import {providerQueryFromParams, providerQueryLink, providerQueryParams} from './provider-client.ts'

const key = 'wenay.travel.provider-selections.v1'
const limit = 24
export const providerSelectionEvent = 'wenay-provider-selections'

export function providerSelectionId(query: ProviderQuery, offer: Pick<ProviderOffer, 'id' | 'providerId'>) {
    return JSON.stringify([providerQueryParams(query), offer.providerId, offer.id])
}

function selection(query: ProviderQuery, offer: ProviderOffer) {
    const deadlines = [offer.expiresAt, offer.deal?.expiresAt].filter((value): value is string => Boolean(value))
    deadlines.sort((a, b) => Date.parse(a) - Date.parse(b))
    const expiresAt: string | null = deadlines.length ? deadlines[0] : null
    return {
        id: providerSelectionId(query, offer),
        query,
        title: offer.title,
        kind: offer.kind,
        providerId: offer.providerId,
        amount: offer.price.amount,
        currency: offer.price.currency,
        basis: offer.price.basis,
        priceType: offer.price.type ?? 'unknown',
        accuracy: offer.accuracy,
        checkedAt: offer.checkedAt,
        expiresAt,
        sourceUrl: offer.bookingUrl || offer.sourceUrl,
        resumeUrl: providerQueryLink(query),
    }
}
export type SavedProviderSelection = ReturnType<typeof selection>
let remembered: SavedProviderSelection[] = []
let temporary = false
let writes = Promise.resolve()

function restore(value: unknown) {
    if (!Array.isArray(value)) return []
    return value.slice(0, limit).flatMap((raw: Partial<SavedProviderSelection>) => {
        if (!raw || typeof raw != 'object') return []
        if (!raw.query || typeof raw.query != 'object') return []
        const fields = [raw.id, raw.title, raw.providerId, raw.sourceUrl, raw.checkedAt]
        if (!fields.every(field => typeof field == 'string' && field.length > 0)) return []
        if (!providerKinds.includes(raw.kind!)) return []
        if (typeof raw.amount != 'number' || !Number.isFinite(raw.amount) || raw.amount <= 0) return []
        if (typeof raw.currency != 'string' || !/^[A-Z]{3}$/.test(raw.currency)) return []
        if (!['party', 'person', 'room-night'].includes(raw.basis ?? '')) return []
        if (!Number.isFinite(Date.parse(raw.checkedAt!)) || !/^https?:\/\//.test(raw.sourceUrl!)) return []
        const source = raw.query as unknown as Record<string, unknown>
        const params = new URLSearchParams()
        const queryFields = ['kind', 'adults', 'currency', 'origin', 'destination', 'departure', 'returnDate', 'checkIn', 'checkOut',
            'nationality', 'bookerCountry', 'country', 'latitude', 'longitude', 'radiusKm', 'rooms', 'nights', 'offset', 'limit', 'checkedBag']
        for (const name of queryFields) {
            const entry = source[name]
            if (typeof entry == 'string' || typeof entry == 'number' || typeof entry == 'boolean') params.set(name, String(entry))
        }
        for (const name of ['providers', 'adultAges']) {
            if (Array.isArray(source[name])) params.set(name, source[name].join(','))
        }
        if (source.providerRefs && typeof source.providerRefs == 'object') params.set('providerRefs', JSON.stringify(source.providerRefs))
        const query = providerQueryFromParams(params)
        const expiresAt = raw.expiresAt && Number.isFinite(Date.parse(raw.expiresAt)) ? raw.expiresAt : null
        const priceType = raw.priceType == 'net' || raw.priceType == 'retail' ? raw.priceType : 'unknown'
        const accuracy = raw.accuracy == 'live-offer' || raw.accuracy == 'published-from' ? raw.accuracy : 'cached-indicative'
        return [{
            id: raw.id!, title: raw.title!, providerId: raw.providerId!, kind: raw.kind!, amount: raw.amount,
            currency: raw.currency, basis: raw.basis!, checkedAt: raw.checkedAt!, expiresAt, sourceUrl: raw.sourceUrl!,
            priceType, accuracy, query, resumeUrl: providerQueryLink(query),
        } satisfies SavedProviderSelection]
    })
}

export async function readProviderSelections() {
    try {
        if (!temporary) remembered = restore(await localStorageCache.get(key))
    } catch {
        temporary = true
    }
    return remembered
}

export function toggleProviderSelection(query: ProviderQuery, offer: ProviderOffer) {
    const item = selection(query, offer)
    return editProviderSelections(items => items.some(entry => entry.id == item.id)
        ? items.filter(entry => entry.id != item.id) : [item, ...items].slice(0, limit))
}

export function removeProviderSelection(id: string) {
    return editProviderSelections(items => items.filter(entry => entry.id != id))
}

function editProviderSelections(change: (items: SavedProviderSelection[]) => SavedProviderSelection[]) {
    async function edit() {
        remembered = change(await readProviderSelections())
        try {
            temporary = !await localStorageCache.set(key, remembered)
        } catch {
            temporary = true
        }
        window.dispatchEvent(new Event(providerSelectionEvent))
    }
    writes = writes.then(edit)
    return writes.then(() => remembered)
}

import type {FlightComparison, FlightOffer} from '../../src/flight-contract.ts'

/** An identical itinerary is comparable only when its included services and conditions are known. */
export function compareFlightOffers(offers: FlightOffer[], now: Date): FlightComparison {
    const byKey = new Map<string, FlightOffer[]>()
    for (const offer of offers) {
        const complete = offer.comparisonKey && offer.conditions && offer.operatingCarriers?.length &&
            offer.checkedBags !== null && offer.taxesIncluded === true && Date.parse(offer.expiresAt) > now.getTime()
        if (!complete || !offer.comparisonKey) continue
        const group = byKey.get(offer.comparisonKey)
        if (group) group.push(offer)
        else byKey.set(offer.comparisonKey, [offer])
    }
    const groups: FlightComparison['groups'] = []
    for (const values of byKey.values()) {
        const unique = [...new Map(values.map(offer => [offer.id, offer])).values()]
        if (unique.length < 2) continue
        const prices = unique.map(offer => offer.total)
        const lowest = Math.min(...prices), highest = Math.max(...prices)
        groups.push({key: 'same-flight-' + groups.length, offerIds: unique.map(offer => offer.id), lowest, highest, saving: highest - lowest})
    }
    return {groups, description: 'Группы объединяют те же рейсы, даты, пассажиров, класс, включённый багаж и условия изменения и возврата. ' +
        'Опубликованные ориентиры с неполными условиями сравниваются в своём списке.'}
}

import {listen} from 'wenay-common2/listen'
import type {TourOffer} from './search-tours.ts'

export interface DemoInquiry {
    readonly reference: string
    readonly offer: Readonly<TourOffer>
}

// A supplier can reuse its offer ID after a price change. Keep the terms the traveller selected.
function quoteKey(offer: TourOffer) {
    return JSON.stringify([offer.id, offer.hotelId, offer.origin, offer.destinationId, offer.departure,
        offer.tripDays, offer.travelers, offer.currency, offer.total])
}

export function createDemoInquiries() {
    const entries = new Map<string, DemoInquiry>()
    const [notify, changed] = listen<[]>()

    function create(offer: TourOffer): DemoInquiry {
        if (!offer.available || !Number.isSafeInteger(offer.total) || offer.total < 0) {
            throw new RangeError('Предложение недоступно или цена указана неверно')
        }
        const key = quoteKey(offer)
        const existing = entries.get(key)
        if (existing) return existing
        const inquiry = Object.freeze({
            reference: 'DEMO-' + String(entries.size + 1).padStart(3, '0'),
            offer: Object.freeze({...offer}),
        })
        entries.set(key, inquiry)
        notify()
        return inquiry
    }

    return {
        create,
        find: (offer: TourOffer) => entries.get(quoteKey(offer)),
        subscribe: (listener: () => void) => changed.on(listener),
    }
}

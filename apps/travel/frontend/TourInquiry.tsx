import {useSyncExternalStore} from 'react'
import {createDemoInquiries} from '../src/inquiry.ts'
import type {TourOffer} from '../src/search-tours.ts'
import {dateLabel} from './presentation.ts'
import './inquiry.css'

// One instance per loaded page, including when filtering temporarily unmounts the card.
const inquiries = createDemoInquiries()

interface TourInquiryProps {
    offer: TourOffer
    hotelName: string
}

export function TourInquiry({offer, hotelName}: TourInquiryProps) {
    const inquiry = useSyncExternalStore(inquiries.subscribe, () => inquiries.find(offer))
    const selection = inquiry?.offer
    function createInquiry() { inquiries.create(offer) }
    return <section className="tour-inquiry" aria-label="Демонстрационная заявка">
        <div role="status" aria-live="polite" aria-atomic="true">
            {inquiry && selection && <>
                <strong>Демозаявка {inquiry.reference} создана</strong>
                <p>{hotelName} · вылет {dateLabel(selection.departure)} · {
                    new Intl.NumberFormat('ru-RU', {style: 'currency', currency: selection.currency,
                        minimumFractionDigits: 0}).format(selection.total / 100)
                }</p>
            </>}
        </div>
        {!inquiry && <button type="button" disabled={!offer.available} onClick={createInquiry}>
            Создать демозаявку
        </button>}
        <small>Заявка действует до перезагрузки страницы. Без отправки партнёру, бронирования и оплаты.</small>
    </section>
}

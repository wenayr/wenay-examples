import {useEffect, useRef} from 'react'
import {Icon} from './Icons.tsx'
import {PriceCalendar} from './PriceCalendar.tsx'
import {TourInquiry} from './TourInquiry.tsx'
import type {HotelView} from './HotelCard.tsx'
import type {TourOffer} from '../src/search-tours.ts'
import {dateLabel, photo, totalLabel} from './presentation.ts'

export function HotelDetail({hotel, offer, onOffer, onClose}: {
    hotel: HotelView
    offer: TourOffer
    onOffer: (value: TourOffer) => void
    onClose: () => void
}) {
    const dialog = useRef<HTMLDialogElement>(null)
    useEffect(() => {
        const node = dialog.current
        node?.showModal()
        return () => node?.close()
    }, [])
    return <dialog className="hotel-detail" aria-labelledby="detail-title" ref={dialog} onCancel={onClose}
        onClick={event => { if (event.target == event.currentTarget) onClose() }}>
        <div className="detail-surface">
            <div className="detail-hero"><img src={photo(hotel.destinationId, hotel.hotelId)} alt=""/>
                <button type="button" className="detail-close" onClick={onClose} aria-label="Закрыть карточку отеля"><Icon name="close"/></button>
                <div><span><Icon name="pin" size={15}/>{hotel.area}</span><h2 id="detail-title">{hotel.name}</h2></div>
            </div>
            <div className="detail-content"><p className="detail-copy">{hotel.description}</p>
                <div className="detail-features">{hotel.features.map(feature => <span key={feature}>{feature}</span>)}</div>
                <PriceCalendar key={hotel.hotelId} days={hotel.calendar} selectedOfferId={offer.id} onSelect={onOffer}/>
                <section className="detail-total" aria-label="Выбранный тур" aria-live="polite">
                    <div><span>Выбранный тур</span><strong>Вылет {dateLabel(offer.departure)}</strong>
                        <small>{offer.tripDays} дней · 2 туриста · {hotel.meal}</small></div><b>{totalLabel(offer.total)}</b>
                </section>
                <TourInquiry offer={offer} hotelName={hotel.name}/>
            </div>
        </div>
    </dialog>
}

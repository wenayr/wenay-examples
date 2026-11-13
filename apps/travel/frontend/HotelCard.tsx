import type {HotelId, hotels} from '../demo/catalog.ts'
import type {searchTours} from '../src/search-tours.ts'
import {photo, dateLabel, totalLabel} from './presentation.ts'
import {Icon} from './Icons.tsx'

type HotelResult = ReturnType<typeof searchTours<HotelId>>[number]
export type HotelView = HotelResult & (typeof hotels)[HotelId]

export function HotelCard({hotel, singleDay, selected, onOpen}: {
    hotel: HotelView
    singleDay: boolean
    selected: boolean
    onOpen: (id: string) => void
}) {
    const onePrice = singleDay || hotel.inBudgetMaxTotal == hotel.best.total
    const range = onePrice ? totalLabel(hotel.best.total) : totalLabel(hotel.best.total) + ' – ' + totalLabel(hotel.inBudgetMaxTotal)
    return <article className={'hotel-card' + (selected ? ' hotel-card--selected' : '')}>
        <div className="card-photo">
            <img loading="lazy" decoding="async" src={photo(hotel.destinationId, hotel.hotelId)} alt=""/>
            <span className="demo-photo-note">Фото направления</span>
            <span className="card-stars" aria-label={hotel.stars + ' звёзд'}>{hotel.stars} <span aria-hidden="true">★</span></span>
        </div>
        <div className="card-info">
            <p className="place"><Icon name="pin" size={14}/>{hotel.area}</p>
            <h3>{hotel.name}</h3>
            <p className="card-meal">{hotel.meal}</p>
            <div className="card-bottom"><div><strong>{range}</strong><span>Лучший вылет · {dateLabel(hotel.best.departure)}</span></div>
                <button className="card-open" type="button" onClick={() => onOpen(hotel.hotelId)}
                    aria-label={'Посмотреть даты и цены: ' + hotel.name} title="Даты и цены"><Icon name="arrow" size={18}/></button>
            </div>
        </div>
    </article>
}

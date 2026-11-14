import {useEffect, useRef, type ReactNode} from 'react'
import type {SupplyDestination, SupplyHotel, SupplyOptions} from '../src/supply-contract.ts'
import type {DirectoryPreferences} from './directory-preferences.ts'
import {directoryUrl, useDirectoryQuery} from './directory-query.ts'
import {HotelOptions} from './DirectoryOffers.tsx'
import {PropertyPhoto, safeHref} from './DirectoryCard.tsx'
import {Icon} from './Icons.tsx'

export function DirectoryDetail({hotel, destination, prefs, onClose, save}: {
    save: ReactNode
    hotel: SupplyHotel
    destination: SupplyDestination
    prefs: DirectoryPreferences
    onClose: () => void
}) {
    const dialog = useRef<HTMLDialogElement>(null)
    const url = directoryUrl('options', {
        destination: destination.id, hotelId: hotel.id, checkIn: prefs.checkIn, checkOut: prefs.checkOut, adults: prefs.adults,
    })
    const options = useDirectoryQuery<SupplyOptions>(url)
    useEffect(() => {
        const node = dialog.current
        node?.showModal()
        return () => node?.close()
    }, [])
    const fmt = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'})
    return <dialog className="hotel-detail directory-detail" aria-labelledby="directory-detail-title" ref={dialog}
        onCancel={onClose} onClick={event => { if (event.target == event.currentTarget) onClose() }}>
        <PropertyPhoto key={hotel.id} hotel={hotel}/>
        <button className="detail-close" type="button" onClick={onClose} aria-label="Закрыть карточку отеля"><Icon name="close"/></button>
        <div className="detail-content">
            <p className="property-location"><Icon name="pin" size={16}/>{hotel.locality || destination.name} · {destination.country}</p>
            <h2 id="directory-detail-title">{hotel.name}</h2>
            <div className="directory-reference">
                <a href={safeHref(hotel.sourceUrl)} target="_blank" rel="noopener noreferrer">{hotel.sourceName}</a>
                {hotel.website && <a href={safeHref(hotel.website)} target="_blank" rel="noopener noreferrer">Сайт объекта ↗</a>}
            </div>
            {save}
            <h3>Даты и цены</h3>
            <p className="directory-period">{fmt.format(new Date(prefs.checkIn + 'T00:00:00Z'))} — {fmt.format(new Date(prefs.checkOut + 'T00:00:00Z'))}
                {' · Взрослых: '}{prefs.adults}</p>
            {options.data && <HotelOptions data={options.data}/>}
            {options.error && <div role="status">{options.error} <button type="button" onClick={options.retry}>Повторить</button></div>}
            {!options.error && !options.data && <div role="status">Проверяем варианты у поставщиков…</div>}
        </div>
    </dialog>
}

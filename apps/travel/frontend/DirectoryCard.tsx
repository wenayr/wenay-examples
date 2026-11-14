import {useState, type ReactNode} from 'react'
import type {SupplyHotel} from '../src/supply-contract.ts'
import {Icon} from './Icons.tsx'

export function safeHref(value: string | null | undefined) {
    if (!value) return undefined
    try {
        const url = new URL(value, window.location.href)
        if (url.protocol == 'https:' || url.protocol == 'http:') return url.href
    } catch {
        return undefined
    }
}

export function PropertyPhoto({hotel}: {hotel: SupplyHotel}) {
    const [failed, setFailed] = useState('')
    const photo = hotel.photo
    let imageSrc = safeHref(photo?.url)
    if (imageSrc && photo?.fileVersion) {
        const asset = new URL(imageSrc)
        asset.searchParams.set('v', photo.fileVersion)
        imageSrc = asset.href
    }
    if (photo && imageSrc && failed != imageSrc) {
        return <figure className="property-photo">
            <img loading="lazy" decoding="async" src={imageSrc} alt={hotel.name} onError={() => setFailed(imageSrc!)}/>
            <figcaption><a href={safeHref(photo.sourceUrl)} target="_blank" rel="noopener noreferrer">{photo.credit}</a>
                {' · '}<a href={safeHref(photo.licenseUrl)} target="_blank" rel="noopener noreferrer">{photo.license}</a></figcaption>
        </figure>
    }
    return <div className="property-no-photo"><Icon name="pin" size={25}/><span>Фото объекта пока нет</span></div>
}

export function DirectoryCard({hotel, index, selected, onOpen, onLocate, save}: {
    hotel: SupplyHotel
    save: ReactNode
    index: number
    selected: boolean
    onOpen: (hotel: SupplyHotel) => void
    onLocate: (hotel: SupplyHotel) => void
}) {
    return <article className={'property-card' + (selected ? ' is-selected' : '')} aria-label={hotel.name}>
        <PropertyPhoto hotel={hotel}/>
        <div className="property-body">
            <div className="property-location"><Icon name="pin" size={14}/>{hotel.locality || hotel.sourceName}</div>
            <h3><button type="button" onClick={() => onOpen(hotel)}>{hotel.name}</button></h3>
            {hotel.category && <p className="property-category">{hotel.category}</p>}
            <div className="property-actions">
                <button type="button" onClick={() => onOpen(hotel)}>Даты и цены <Icon name="arrow" size={14}/></button>
                <button type="button" className="locate" onClick={() => onLocate(hotel)} aria-label={'На карте: ' + hotel.name}>
                    <Icon name="map" size={15}/> {index}
                </button>
            </div>
            {save}
        </div>
    </article>
}

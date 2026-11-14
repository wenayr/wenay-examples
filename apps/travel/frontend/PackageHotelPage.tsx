import {useEffect, useRef, useState} from 'react'
import type {PackageCalendar, PackageFare, PackageHotel, PackageMarker, PackageSummary} from '../src/package-contract.ts'
import {packageCoordinatePrecisions} from '../src/package-contract.ts'
import type {SupplyDestination} from '../src/supply-contract.ts'
import {safeHref} from './DirectoryCard.tsx'
import {dateLabel} from './presentation.ts'
import type {PackagePreferences} from './package-preferences.ts'
import type {tPackageFavouriteLevel} from './package-favourites.ts'
import {PackageFavouritePicker} from './PackageFavouritePicker.tsx'
import {PriceCalendar} from './PriceCalendar.tsx'
import {Icon} from './Icons.tsx'
import {SaveTripButton} from './trip/TripPlan.tsx'
import {packageTrip} from './trip/model.ts'

const euros = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'EUR', maximumFractionDigits: 2})

export interface PackageHotelPageProps {
    hotel: PackageHotel | PackageSummary | PackageMarker
    prefs: PackagePreferences
    destination: SupplyDestination
    calendar: PackageCalendar | undefined
    selectedFare: PackageFare | undefined
    loading?: boolean
    error: string | undefined
    onRetry: () => void
    onFare: (id: string) => void
    onClose: () => void
    onLocate: () => void
    favouriteLevel: tPackageFavouriteLevel
    onFavourite: (level: tPackageFavouriteLevel) => void
}

export function PackageHotelPage({hotel, prefs, destination, calendar, selectedFare, loading = false, error,
    onRetry, onFare, onClose, onLocate, favouriteLevel, onFavourite}: PackageHotelPageProps) {
    const panel = useRef<HTMLElement>(null)
    const back = useRef<HTMLButtonElement>(null)
    const [imageIndex, setImageIndex] = useState(0)
    const [unavailablePhotos, setUnavailablePhotos] = useState<string[]>([])
    const hotelId = 'id' in hotel ? hotel.id : hotel.hotelId
    const property = calendar?.hotel ?? hotel
    const photos = 'photos' in property ? property.photos : undefined
    const suppliedGallery = photos ?? (property.photo ? [property.photo] : [])
    const gallery = suppliedGallery.filter(entry => !unavailablePhotos.includes(entry.url))
    const image = gallery[imageIndex] ?? gallery[0]
    const missingFare = Boolean(prefs.fareId && calendar && !selectedFare)
    const unconfirmedDates = calendar?.days.some(day => day.status == 'unknown')
    const name = property.name

    useEffect(() => {
        setImageIndex(0)
        setUnavailablePhotos([])
        panel.current?.scrollTo(0, 0)
        const previous = document.activeElement
        back.current?.focus({preventScroll: true})
        return () => {
            if (previous instanceof HTMLElement && previous.isConnected) previous.focus({preventScroll: true})
        }
    }, [hotelId])

    function unavailablePhoto(url: string) {
        setUnavailablePhotos(current => current.includes(url) ? current : [...current, url])
    }

    return <section className="package-map-detail" role="dialog" aria-modal="false" aria-labelledby="package-map-hotel-name" ref={panel}
        onKeyDown={event => {
            if (event.key == 'Escape') onClose()
        }}>
        <header className="package-map-detail__header">
            <button type="button" onClick={onClose} ref={back}><Icon name="arrow" size={16}/> Вернуться к карте</button>
            <button type="button" className="package-map-detail__close" aria-label="Закрыть отель и вернуться к карте" onClick={onClose}>
                <Icon name="close" size={19}/>
            </button>
        </header>
        <div className="package-map-detail__gallery">
            {image ? <img className="package-map-detail__hero" src={image.url} alt={name} decoding="async"
                onError={() => unavailablePhoto(image.url)}/> :
                <div className="package-map-detail__photo-missing"><Icon name="pin" size={30}/><span>Фотография отеля пока недоступна</span></div>}
            {gallery.length > 1 && <div className="package-map-detail__thumbnails" aria-label="Фотографии отеля">
                {gallery.map((entry, index) => <button key={entry.url} type="button" aria-label={'Фотография ' + (index + 1)}
                    aria-pressed={index == imageIndex} onClick={() => setImageIndex(index)}>
                    <img src={entry.url} alt="" loading="lazy" decoding="async" onError={() => unavailablePhoto(entry.url)}/>
                </button>)}
            </div>}
            {image && <a className="package-map-detail__credit" href={safeHref(image.sourceUrl)} target="_blank" rel="noopener noreferrer">
                {image.credit || 'Фотографии отеля'} ↗
            </a>}
        </div>
        <div className="package-map-detail__body">
            <div className="package-map-detail__heading">
                <p>{destination.name} · {property.stars == null ? 'Отель' : property.stars + ' ★'}</p>
                <h2 id="package-map-hotel-name">{name}</h2>
                <p>{prefs.adults} взрослых · {prefs.nights} ночей · вылет из Таллина</p>
            </div>
            <PackageFavouritePicker level={favouriteLevel} onChange={onFavourite}/>
            {property.latitude != null && property.longitude != null && <div className="package-map-detail__map">
                <button type="button" className="package-map-detail__location" onClick={onLocate}>
                    <Icon name="pin" size={17}/> Показать расположение на карте
                </button>
                {property.coordinateSource?.precision == 'hotel-complex' && <small>
                    {packageCoordinatePrecisions[property.coordinateSource.precision]}
                </small>}
            </div>}
            <section className="package-map-detail__prices" aria-label="Цены выбранного отеля" aria-busy={loading}>
                <h3>Даты и цены</h3>
                {calendar && <PriceCalendar days={calendar.days} selectedOfferId={selectedFare?.id ?? null} onSelect={fare => onFare(fare.id)}/>}
                {loading && <p role="status">Проверяем цены вылета…</p>}
                {error && <p className="directory-error" role="status">{error} <button type="button" onClick={onRetry}>Повторить</button></p>}
                {missingFare && <p role="status">Выбранный тариф больше не подтверждён. Выберите другой вылет.</p>}
                {!loading && calendar && !selectedFare && !missingFare && <p role="status">
                    {unconfirmedDates ? 'Проверка цен пока не завершена.' : 'Полученных тарифов в текущем бюджете нет.'}
                    {unconfirmedDates && <button type="button" onClick={onRetry}>Повторить проверку</button>}
                </p>}
                {selectedFare && <div className="package-map-detail__price">
                    <strong>{euros.format(selectedFare.total / 100)}</strong><span>за всю группу · вылет {dateLabel(selectedFare.departure)}</span>
                </div>}
                {calendar && selectedFare && <div className="package-map-detail__actions">
                    <SaveTripButton item={packageTrip(calendar.hotel, selectedFare, destination, prefs, calendar.source,
                        calendar.days.find(day => day.departure == selectedFare.departure)?.checkedAt)}/>
                    <a href={safeHref(calendar.hotel.url)} target="_blank" rel="noopener noreferrer">Открыть у оператора ↗</a>
                </div>}
            </section>
        </div>
    </section>
}

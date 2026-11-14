import {useEffect, useRef, useState} from 'react'
import type {PackageCalendar, PackageFare, PackageHotel, PackageMarker, PackageSummary} from '../src/package-contract.ts'
import type {PackageMatrixCell, PackageMatrixFare} from '../src/package-matrix-contract.ts'
import type {PackageHotelGallery} from '../src/package-media-contract.ts'
import {packageCoordinatePrecisions} from '../src/package-contract.ts'
import type {SupplyDestination, SupplySource} from '../src/supply-contract.ts'
import {safeHref} from './DirectoryCard.tsx'
import {directoryUrl, useDirectoryQuery} from './directory-query.ts'
import {dateLabel} from './presentation.ts'
import type {PackagePreferences} from './package-preferences.ts'
import type {tPackageFavouriteLevel} from './package-favourites.ts'
import {PackageFavouritePicker} from './PackageFavouritePicker.tsx'
import {PriceCalendar} from './PriceCalendar.tsx'
import {PackagePriceMatrix} from './PackagePriceMatrix.tsx'
import type {MatrixViewContext} from './package-matrix.ts'
import {Icon} from './Icons.tsx'
import {SaveTripButton} from './trip/TripPlan.tsx'
import {packageTrip} from './trip/model.ts'

const euros = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'EUR', maximumFractionDigits: 2})

export interface PackageHotelPageProps {
    hotel: PackageHotel | PackageSummary | PackageMarker
    prefs: PackagePreferences
    destination: SupplyDestination
    calendar: PackageCalendar | undefined
    selectedFare: PackageFare & Partial<Pick<PackageMatrixFare, 'room' | 'board' | 'checkedAt'>> | undefined
    loading?: boolean
    error: string | undefined
    onRetry: () => void
    onFare: (id: string) => void
    onClose: () => void
    onLocate: () => void
    favouriteLevel: tPackageFavouriteLevel
    onFavourite: (level: tPackageFavouriteLevel) => void
    priceView: 'graph' | 'matrix'
    onPriceView: (view: 'graph' | 'matrix') => void
    onMatrixFare: (cell: PackageMatrixCell) => void
    onMatrixSnapshot: (cells: PackageMatrixCell[], failedCellKeys: string[]) => void
    matrixView: MatrixViewContext
    onMatrixView: (patch: Partial<MatrixViewContext>) => void
    selectionSource?: SupplySource
    selectionCheckedAt?: string | null
}

export function PackageHotelPage({hotel, prefs, destination, calendar, selectedFare, loading = false, error,
    onRetry, onFare, onClose, onLocate, favouriteLevel, onFavourite, priceView, onPriceView, onMatrixFare, onMatrixSnapshot,
    selectionSource, selectionCheckedAt, matrixView, onMatrixView}: PackageHotelPageProps) {
    const panel = useRef<HTMLElement>(null)
    const back = useRef<HTMLButtonElement>(null)
    const [imageIndex, setImageIndex] = useState(0)
    const [unavailablePhotos, setUnavailablePhotos] = useState<string[]>([])
    const hotelId = 'id' in hotel ? hotel.id : hotel.hotelId
    const media = useDirectoryQuery<PackageHotelGallery>(directoryUrl('package-gallery', {hotelId}))
    const property = calendar?.hotel ?? hotel
    const photos = 'photos' in property ? property.photos : undefined
    const suppliedGallery = media.data?.photos ?? photos ?? (property.photo ? [property.photo] : [])
    const gallery = suppliedGallery.filter(entry => !unavailablePhotos.includes(entry.url))
    const image = gallery[imageIndex] ?? gallery[0]
    const missingFare = Boolean(prefs.fareId && calendar && !selectedFare)
    const unconfirmedDates = calendar?.days.some(day => day.status == 'unknown')
    const name = property.name
    const selectedSource = selectionSource ?? calendar?.source
    const checkedAt = selectionCheckedAt ?? calendar?.days.find(day => day.departure == selectedFare?.departure)?.checkedAt
    const tripHotel = {...property, id: hotelId}
    const propertyUrl = media.data?.hotelUrl ?? ('url' in property ? property.url : selectedSource?.url)

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

    return <section className="package-map-detail" data-price-view={priceView} role="dialog" aria-modal="false"
        aria-labelledby="package-map-hotel-name" ref={panel}
        onKeyDown={event => {
            if (event.key == 'Escape') onClose()
        }}>
        <header className="package-map-detail__header">
            <button type="button" onClick={onClose} ref={back}><Icon name="arrow" size={16}/> Вернуться к карте</button>
            <span className="package-map-detail__context" title={name}>{name}</span>
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
            {image && <div className="package-map-detail__credit">
                <a href={safeHref(image.url)} target="_blank" rel="noopener noreferrer">Файл фото ↗</a>
                {' · '}<a href={safeHref(image.sourceUrl)} target="_blank" rel="noopener noreferrer">Страница источника ↗</a>
            </div>}
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
                <div className="package-price-views" role="group" aria-label="Вид цен отеля">
                    <button type="button" aria-pressed={priceView == 'graph'} onClick={() => onPriceView('graph')}>График</button>
                    <button type="button" aria-pressed={priceView == 'matrix'} onClick={() => onPriceView('matrix')}>Матрица</button>
                </div>
                {priceView == 'matrix' && <PackagePriceMatrix prefs={prefs} selectedFareId={selectedFare?.id}
                    onSelect={onMatrixFare} onSnapshot={onMatrixSnapshot} view={matrixView} onView={onMatrixView}/>}
                {priceView == 'graph' && calendar && <PriceCalendar days={calendar.days}
                    selectedOfferId={selectedFare?.id ?? null} onSelect={fare => onFare(fare.id)}/>}
                {priceView == 'graph' && loading && <p role="status">Проверяем цены вылета…</p>}
                {priceView == 'graph' && error && <p className="directory-error" role="status">
                    {error} <button type="button" onClick={onRetry}>Повторить</button></p>}
                {missingFare && !selectionSource && <p role="status">Выбранный тариф больше не подтверждён. Выберите другой вылет.</p>}
                {priceView == 'matrix' && prefs.fareId && !selectedFare && <p role="status">
                    Выбранный тариф требует подтверждения. Выберите доступную цену в матрице.</p>}
                {priceView == 'graph' && !loading && calendar && !selectedFare && !missingFare && <p role="status">
                    {unconfirmedDates ? 'Проверка цен пока не завершена.' : 'Полученных тарифов в текущем бюджете нет.'}
                    {unconfirmedDates && <button type="button" onClick={onRetry}>Повторить проверку</button>}
                </p>}
                {selectedFare && <div className="package-map-detail__price">
                    <strong>{euros.format(selectedFare.total / 100)}</strong><span>за всю группу · вылет {dateLabel(selectedFare.departure)}
                        {' · '}{prefs.nights + 1} дней / {prefs.nights} ночей</span>
                    {selectedFare.room && <span>{selectedFare.room}{selectedFare.board && ' · ' + selectedFare.board}</span>}
                    {checkedAt && <time dateTime={checkedAt}>Проверено {new Date(checkedAt).toLocaleString('ru-RU')}</time>}
                </div>}
                {selectedSource && selectedFare && <div className="package-map-detail__actions">
                    <SaveTripButton item={packageTrip(tripHotel, selectedFare, destination, prefs, selectedSource, checkedAt)}/>
                    <a href={safeHref(propertyUrl)} target="_blank" rel="noopener noreferrer">
                        Открыть у оператора ↗</a>
                </div>}
            </section>
        </div>
    </section>
}

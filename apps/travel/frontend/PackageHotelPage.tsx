import {useEffectEvent, useLayoutEffect, useRef, useState, type PointerEvent} from 'react'
import type {PackageCalendar, PackageFare, PackageHotel, PackageMarker, PackageSummary} from '../src/package-contract.ts'
import {packageCoordinatePrecisions, packageMaxTotal, packageWindowDays} from '../src/package-contract.ts'
import type {PackageMatrixCell, PackageMatrixFare} from '../src/package-matrix-contract.ts'
import type {PackageHotelGallery} from '../src/package-media-contract.ts'
import type {SupplyDestination, SupplySource} from '../src/supply-contract.ts'
import {safeHref} from './DirectoryCard.tsx'
import {directoryUrl, useDirectoryQuery} from './directory-query.ts'
import {shiftDate, validDate} from './directory-preferences.ts'
import {dateLabel} from './presentation.ts'
import type {PackagePreferences} from './package-preferences.ts'
import type {tPackageFavouriteLevel} from './package-favourites.ts'
import {PackageFavouritePicker} from './PackageFavouritePicker.tsx'
import {PriceCalendar} from './PriceCalendar.tsx'
import {PackagePriceMatrix} from './PackagePriceMatrix.tsx'
import type {MatrixViewContext} from './package-matrix.ts'
import {hotelPageSections, hotelSectionOffset, type tHotelPageSection} from './hotel-page-entry.ts'
import {MapPhoto} from './MapPhoto.tsx'
import {Icon} from './Icons.tsx'
import {SaveTripButton} from './trip/TripPlan.tsx'
import {packageTrip} from './trip/model.ts'
import {HotelReviewsPanel} from './HotelReviewsPanel.tsx'
import './package-hotel-page.css'

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
    onRestoreFocus: () => void
    onLocate: () => void
    onChange: (patch: Partial<PackagePreferences>) => void
    favouriteLevel: tPackageFavouriteLevel
    onFavourite: (level: tPackageFavouriteLevel) => void
    priceView: 'graph' | 'matrix'
    onPriceView: (view: 'graph' | 'matrix') => void
    entrySection: tHotelPageSection
    onSection: (section: tHotelPageSection) => void
    onMatrixFare: (cell: PackageMatrixCell) => void
    onMatrixSnapshot: (cells: PackageMatrixCell[], failedCellKeys: string[]) => void
    matrixView: MatrixViewContext
    onMatrixView: (patch: Partial<MatrixViewContext>) => void
    selectionSource?: SupplySource
    selectionCheckedAt?: string | null
}

export function PackageHotelPage({hotel, prefs, destination, calendar, selectedFare, loading = false, error,
    onRetry, onFare, onClose, onRestoreFocus, onLocate, onChange, favouriteLevel, onFavourite, priceView, onPriceView,
    entrySection, onSection, onMatrixFare, onMatrixSnapshot, selectionSource, selectionCheckedAt, matrixView, onMatrixView}: PackageHotelPageProps) {
    const panel = useRef<HTMLDialogElement>(null)
    const header = useRef<HTMLElement>(null)
    const content = useRef<HTMLDivElement>(null)
    const sections = useRef<Partial<Record<tHotelPageSection, HTMLElement>>>({})
    const positioning = useRef({section: entrySection, automatic: true})
    const backdropGesture = useRef(false)
    const [refreshRevision, setRefreshRevision] = useState(0)
    const [matrixState, setMatrixState] = useState({busy: true, stale: false, failed: false})
    const [budget, setBudget] = useState({from: String(prefs.minTotal / 100), to: String(prefs.maxTotal / 100)})
    const hotelId = 'id' in hotel ? hotel.id : hotel.hotelId
    const media = useDirectoryQuery<PackageHotelGallery>(directoryUrl('package-gallery', {hotelId, details: 1}))
    const property = calendar?.hotel ?? hotel
    const name = media.data?.name ?? property.name
    const information = media.data?.information
    const selectedSource = selectionSource ?? calendar?.source
    const checkedAt = selectionCheckedAt ?? calendar?.days.find(day => day.departure == selectedFare?.departure)?.checkedAt
    const tripHotel = {...property, id: hotelId}
    const suppliedUrl = 'url' in property ? safeHref(property.url) : undefined
    const propertyUrl = safeHref(media.data?.hotelUrl ?? suppliedUrl ?? selectedSource?.url)
    const website = safeHref(information?.website)
    const today = new Date().toISOString().slice(0, 10)
    const lastAllowed = shiftDate(prefs.firstDeparture, packageWindowDays - 1)
    const restoreFocus = useEffectEvent(onRestoreFocus)

    function positionSection(focus = false) {
        const element = panel.current
        const section = positioning.current.section
        const target = sections.current[section]
        if (!element?.open || !target) return
        const top = hotelSectionOffset(section, target.getBoundingClientRect().top, element.getBoundingClientRect().top,
            element.scrollTop, header.current?.getBoundingClientRect().height ?? 0)
        element.scrollTop = top
        if (focus) target.focus({preventScroll: true})
    }

    useLayoutEffect(() => {
        const element = panel.current
        if (!element) return
        element.showModal()
        // The dialog becomes visible and receives its initial position in this same pre-paint phase.
        const observer = new ResizeObserver(function contentResized() {
            if (positioning.current.automatic) positionSection()
        })
        if (content.current) observer.observe(content.current)
        if (header.current) observer.observe(header.current)
        return () => {
            observer.disconnect()
            element.close()
            restoreFocus()
        }
    }, [hotelId])

    useLayoutEffect(() => {
        positioning.current = {section: entrySection, automatic: true}
        positionSection(true)
    }, [hotelId, entrySection])

    useLayoutEffect(() => {
        setBudget({from: String(prefs.minTotal / 100), to: String(prefs.maxTotal / 100)})
    }, [prefs.minTotal, prefs.maxTotal])

    function navigateSection(section: tHotelPageSection) {
        positioning.current = {section, automatic: true}
        positionSection(true)
        onSection(section)
    }

    function userScrollIntent() { positioning.current.automatic = false }

    function changeFirst(value: string) {
        if (!validDate(value) || value < today) return
        const length = Math.floor((Date.parse(prefs.lastDeparture) - Date.parse(prefs.firstDeparture)) / 86_400_000)
        onChange({firstDeparture: value, lastDeparture: shiftDate(value, length)})
    }

    function commitBudget(key: 'from' | 'to') {
        const total = Math.round(Number(budget[key]) * 100)
        const valid = budget[key] != '' && Number.isSafeInteger(total) && total >= 0 && total <= packageMaxTotal
        if (!valid) {
            setBudget({from: String(prefs.minTotal / 100), to: String(prefs.maxTotal / 100)})
            return
        }
        if (key == 'from') onChange({minTotal: Math.min(total, prefs.maxTotal)})
        else onChange({maxTotal: Math.max(total, prefs.minTotal)})
    }

    function outside(event: PointerEvent<HTMLDialogElement>) {
        const box = event.currentTarget.getBoundingClientRect()
        const outsideX = event.clientX < box.left || event.clientX > box.right
        const outsideY = event.clientY < box.top || event.clientY > box.bottom
        return outsideX || outsideY
    }

    return <dialog className="package-map-detail package-hotel-page" aria-labelledby="package-map-hotel-name" ref={panel}
        data-entry-section={entrySection} onWheelCapture={userScrollIntent} onPointerDownCapture={userScrollIntent}
        onKeyDownCapture={event => {
            if (['Tab', 'PageDown', 'PageUp', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) userScrollIntent()
        }} onCancel={event => {
            event.preventDefault()
            onClose()
        }} onPointerDown={event => { backdropGesture.current = event.target == event.currentTarget && outside(event) }}
        onPointerUp={event => {
            if (backdropGesture.current && event.target == event.currentTarget && outside(event)) onClose()
            backdropGesture.current = false
        }}>
        <header className="package-map-detail__header package-hotel-page__header" ref={header}>
            <div className="package-hotel-page__heading"><button type="button" onClick={onClose} aria-label="Вернуться к карте">
                <Icon name="arrow" size={17}/><span>К карте</span></button>
                <div><p>{destination.name} · {property.stars == null ? 'Отель' : property.stars + ' ★'}</p>
                    <h2 id="package-map-hotel-name">{name}</h2></div></div>
            <nav className="package-hotel-page__navigation" aria-label="Разделы отеля">
                {Object.entries(hotelPageSections).map(([key, label]) => <button key={key} type="button"
                    aria-current={entrySection == key ? 'location' : undefined} onClick={() => navigateSection(key as tHotelPageSection)}>
                    {label}</button>)}
            </nav>
            <div className="package-hotel-page__tools">
                <button type="button" onClick={onLocate} aria-label="Показать отель на карте" title="Показать на карте"
                    disabled={property.latitude == null || property.longitude == null}><Icon name="pin" size={19}/></button>
                <button type="button" onClick={onClose} aria-label="Закрыть отель и вернуться к карте"><Icon name="close" size={20}/></button>
            </div>
        </header>
        <div className="package-hotel-page__content" ref={content}>
            <section className="package-hotel-gallery" id="hotel-gallery" aria-label="Галерея отеля" tabIndex={-1}
                ref={element => { sections.current.gallery = element ?? undefined }}>
                <MapPhoto hotelId={hotelId} name={name} photo={property.photo} photos={'photos' in property ? property.photos : undefined}
                    propertyUrl={propertyUrl} photoInteraction="gallery" onPhoto={() => {}}/>
            </section>
            <div className="package-hotel-page__body">
                <section className="package-hotel-page__matrix" id="hotel-matrix" aria-label="Даты и цены отеля" tabIndex={-1}
                    ref={element => { sections.current.matrix = element ?? undefined }}>
                    <div className="package-hotel-page__section-heading"><div><p className="package-hotel-page__eyebrow">Выберите лучшие даты</p>
                        <h3>Матрица цен</h3><p>Вылет из Таллина · {prefs.adults} взрослых · EUR за всю группу</p></div>
                        <button type="button" disabled={matrixState.busy} onClick={() => setRefreshRevision(value => value + 1)}
                            className="package-hotel-page__refresh" title="Заново запросить цены у поставщика">
                            <Icon name="refresh" size={16}/>{matrixState.busy ? 'Проверяем цены…' : 'Обновить цены'}</button></div>
                    <section className="package-hotel-page__trip" aria-label="Параметры поездки для матрицы">
                        <label><span>Выезд с</span><input type="date" min={today} value={prefs.firstDeparture}
                            onChange={event => changeFirst(event.target.value)}/></label>
                        <label><span>Выезд по</span><input type="date" min={prefs.firstDeparture} max={lastAllowed} value={prefs.lastDeparture}
                            onChange={event => {
                                const value = event.target.value
                                if (value >= prefs.firstDeparture && value <= lastAllowed) onChange({lastDeparture: value})
                            }}/></label>
                        {(['from', 'to'] as const).map(key => <label key={key}><span>Бюджет {key == 'from' ? 'от' : 'до'}, € за группу</span>
                            <input type="number" min={0} max={packageMaxTotal / 100} step="0.01" value={budget[key]}
                                onChange={event => setBudget(current => ({...current, [key]: event.target.value}))}
                                onBlur={() => commitBudget(key)} onKeyDown={event => {
                                    if (event.key == 'Enter') event.currentTarget.blur()
                                }}/></label>)}
                    </section>
                    <PackagePriceMatrix prefs={prefs} selectedFareId={selectedFare?.id} onSelect={onMatrixFare}
                        onSnapshot={onMatrixSnapshot} view={matrixView} onView={onMatrixView} refreshRevision={refreshRevision}
                        onStateChange={setMatrixState}/>
                    {selectedFare && <div className="package-hotel-page__selection" aria-live="polite">
                        <div><strong>{euros.format(selectedFare.total / 100)}</strong><p>{dateLabel(selectedFare.departure)}
                            {' · '}{prefs.nights + 1} дней / {prefs.nights} ночей · за всю группу</p>
                            {selectedFare.room && <p>{selectedFare.room}{selectedFare.board && ' · ' + selectedFare.board}</p>}
                            {checkedAt && <time dateTime={checkedAt}>Проверено {new Date(checkedAt).toLocaleString('ru-RU')}</time>}
                            {matrixState.stale && <p>Последняя полученная цена, ожидает подтверждения.</p>}</div>
                        {selectedSource && <SaveTripButton item={packageTrip(tripHotel, selectedFare, destination, prefs, selectedSource, checkedAt)}/>}
                    </div>}
                    {prefs.fareId && !selectedFare && <p className="package-hotel-page__note" role="status">
                        Выбранный тариф требует подтверждения. Выберите доступную цену в матрице.</p>}
                    <details className="package-hotel-page__calendar" open={priceView == 'graph'} onToggle={event => {
                        const next = event.currentTarget.open ? 'graph' : 'matrix'
                        if (next != priceView) onPriceView(next)
                    }}><summary>График для {prefs.nights} ночей</summary>
                        {priceView == 'graph' && calendar && <PriceCalendar days={calendar.days}
                            selectedOfferId={selectedFare?.id ?? null} onSelect={fare => onFare(fare.id)}/>}
                        {priceView == 'graph' && loading && <p role="status">Проверяем цены вылета…</p>}
                        {priceView == 'graph' && error && <p className="directory-error" role="status">{error}
                            {' '}<button type="button" onClick={onRetry}>Повторить</button></p>}
                    </details>
                </section>
                <section className="package-hotel-information" id="hotel-information" aria-label="Сведения об отеле" tabIndex={-1}
                    ref={element => { sections.current.information = element ?? undefined }}>
                    <div className="package-hotel-page__section-heading"><div><p className="package-hotel-page__eyebrow">Перед поездкой</p>
                        <h3>Об отеле</h3></div><PackageFavouritePicker level={favouriteLevel} onChange={onFavourite}/></div>
                    <div className="package-hotel-information__links">
                        <button type="button" onClick={onLocate} disabled={property.latitude == null || property.longitude == null}>
                            <Icon name="pin" size={17}/> Показать на карте</button>
                        {website && <a href={website} target="_blank" rel="noopener noreferrer"><Icon name="external" size={15}/> Сайт отеля</a>}
                        {propertyUrl && <a href={propertyUrl} target="_blank" rel="noopener noreferrer">
                            Страница у поставщика <Icon name="external" size={15}/></a>}
                    </div>
                    {information?.facts.length ? <dl className="package-hotel-information__facts">
                        {information.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
                    </dl> : <p className="package-hotel-page__note">{media.loading ? 'Получаем сведения поставщика…' :
                        'Расстояние до пляжа и подробные параметры пока не подтверждены. Проверьте сведения у поставщика.'}</p>}
                    {information && <p className="package-hotel-page__provenance">Сведения TEZ TOUR · проверено {dateLabel(information.checkedOn)}.
                        {website && ' Сайт отеля указан в контактах поставщика.'}</p>}
                    {property.coordinateSource && <p className="package-hotel-page__provenance">
                        {packageCoordinatePrecisions[property.coordinateSource.precision]} · {property.latitude}, {property.longitude}</p>}
                </section>
                <section className="package-hotel-page__reviews" id="hotel-reviews" aria-label="Отзывы путешественников" tabIndex={-1}
                    ref={element => { sections.current.reviews = element ?? undefined }}><HotelReviewsPanel hotelId={hotelId}/></section>
            </div>
        </div>
    </dialog>
}

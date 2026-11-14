import {useEffect, useRef, useState, type PointerEvent} from 'react'
import type {PackageFare, PackageHotel, PackageMarker, PackageSummary} from '../src/package-contract.ts'
import {packageMaxTotal, packageWindowDays} from '../src/package-contract.ts'
import type {PackageMatrixCell, PackageMatrixFare} from '../src/package-matrix-contract.ts'
import type {PackageHotelGallery} from '../src/package-media-contract.ts'
import type {SupplyDestination, SupplySource} from '../src/supply-contract.ts'
import {safeHref} from './DirectoryCard.tsx'
import {directoryUrl, useDirectoryQuery} from './directory-query.ts'
import {shiftDate, validDate} from './directory-preferences.ts'
import {dateLabel} from './presentation.ts'
import type {PackagePreferences} from './package-preferences.ts'
import type {MatrixViewContext} from './package-matrix.ts'
import {MapPhoto} from './MapPhoto.tsx'
import {PackageFavouritePicker} from './PackageFavouritePicker.tsx'
import type {tPackageFavouriteLevel} from './package-favourites.ts'
import {PackagePriceMatrix} from './PackagePriceMatrix.tsx'
import {SaveTripButton} from './trip/TripPlan.tsx'
import {packageTrip} from './trip/model.ts'
import {Icon} from './Icons.tsx'
import './matrix-popup.css'

const euros = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2})

export function PackageMatrixPopup({hotel, prefs, destination, selectedFare, selectionSource, selectionCheckedAt, view,
    onView, onSelect, onSnapshot, onChange, onClose, onRestoreFocus, onHotel, onLocate, favouriteLevel, onFavourite}: {
    hotel: PackageHotel | PackageSummary | PackageMarker
    prefs: PackagePreferences
    destination: SupplyDestination
    selectedFare: PackageFare & Partial<Pick<PackageMatrixFare, 'room' | 'board' | 'sourceUrl'>> | undefined
    selectionSource: SupplySource | undefined
    selectionCheckedAt?: string | null
    view: MatrixViewContext
    onView: (patch: Partial<MatrixViewContext>) => void
    onSelect: (cell: PackageMatrixCell) => void
    onSnapshot: (cells: PackageMatrixCell[], failedKeys: string[]) => void
    onChange: (patch: Partial<PackagePreferences>) => void
    onClose: () => void
    onRestoreFocus: () => void
    onHotel: () => void
    onLocate: () => void
    favouriteLevel: tPackageFavouriteLevel
    onFavourite: (level: tPackageFavouriteLevel) => void
}) {
    const popup = useRef<HTMLDialogElement>(null)
    const close = useRef<HTMLButtonElement>(null)
    const backdropGesture = useRef(false)
    const restoreOnClose = useRef(true)
    const [refreshRevision, setRefreshRevision] = useState(0)
    const [photoUrl, setPhotoUrl] = useState<string>()
    const [matrixState, setMatrixState] = useState({busy: true, stale: false, failed: false})
    const [budget, setBudget] = useState({from: String(prefs.minTotal / 100), to: String(prefs.maxTotal / 100)})
    const hotelId = 'id' in hotel ? hotel.id : hotel.hotelId
    const media = useDirectoryQuery<PackageHotelGallery>(directoryUrl('package-gallery', {hotelId}))
    const today = new Date().toISOString().slice(0, 10)
    const lastAllowed = shiftDate(prefs.firstDeparture, packageWindowDays - 1)
    useEffect(() => {
        const element = popup.current
        if (!element) return
        element.showModal()
        close.current?.focus({preventScroll: true})
        return () => {
            element.close()
            if (restoreOnClose.current) requestAnimationFrame(onRestoreFocus)
        }
    }, [])
    useEffect(() => {
        setBudget({from: String(prefs.minTotal / 100), to: String(prefs.maxTotal / 100)})
    }, [prefs.minTotal, prefs.maxTotal])
    function changeFirst(value: string) {
        if (!validDate(value) || value < today) return
        const length = Math.floor((Date.parse(prefs.lastDeparture) - Date.parse(prefs.firstDeparture)) / 86_400_000)
        onChange({firstDeparture: value, lastDeparture: shiftDate(value, length)})
    }
    function showHotel() {
        restoreOnClose.current = false
        onHotel()
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
    const suppliedUrl = 'url' in hotel && safeHref(hotel.url) ? hotel.url : undefined
    const propertyUrl = media.data?.hotelUrl ?? selectedFare?.sourceUrl ?? suppliedUrl
    return <dialog ref={popup} className="package-matrix-popup" aria-modal="true" aria-labelledby="matrix-popup-name" aria-describedby="matrix-popup-context"
        onCancel={event => {
            event.preventDefault()
            onClose()
        }} onPointerDown={event => { backdropGesture.current = event.target == event.currentTarget && outside(event) }}
        onPointerUp={event => {
            if (backdropGesture.current && event.target == event.currentTarget && outside(event)) {
                event.preventDefault()
                onClose()
            }
            backdropGesture.current = false
        }}>
        <header className="package-matrix-popup__header">
            <div><p>Матрица цен · {destination.name}</p><h2 id="matrix-popup-name">{hotel.name}</h2></div>
            <div className="package-matrix-popup__header-actions">
                <button type="button" disabled={matrixState.busy} onClick={() => setRefreshRevision(value => value + 1)}
                    title="Заново запросить цены у поставщика">{matrixState.busy ? 'Проверяем цены…' : '↻ Обновить цены'}</button>
                <button type="button" ref={close} className="package-matrix-popup__close" aria-label="Закрыть матрицу и вернуться к карте" onClick={onClose}>
                    <Icon name="close" size={21}/>
                </button>
            </div>
        </header>
        <div className="package-matrix-popup__content">
            <div className="package-matrix-popup__hotel">
                <div className="package-matrix-popup__photo">
                    <MapPhoto hotelId={hotelId} name={hotel.name} photo={hotel.photo} propertyUrl={propertyUrl}
                        selectedUrl={photoUrl} onPhoto={setPhotoUrl} onOpen={showHotel}/>
                </div>
                <div className="package-matrix-popup__hotel-tools">
                    <p id="matrix-popup-context">{hotel.stars == null ? 'Отель' : hotel.stars + ' ★'} · {prefs.adults} взрослых · EUR за всю группу</p>
                    <p>Вылет из Таллина · цены TEZ TOUR Eesti</p>
                    <PackageFavouritePicker level={favouriteLevel} onChange={onFavourite}/>
                    <div className="package-matrix-popup__hotel-links">
                        <button type="button" onClick={showHotel}>Об отеле</button>
                        <button type="button" onClick={onLocate} disabled={hotel.latitude == null || hotel.longitude == null}>
                            <Icon name="pin" size={14}/> Расположение на карте</button>
                    </div>
                </div>
            </div>
            <section className="package-matrix-popup__trip" aria-label="Параметры поездки для матрицы">
                <label><span>Выезд с</span><input type="date" min={today} value={prefs.firstDeparture} onChange={event => changeFirst(event.target.value)}/></label>
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
            <PackagePriceMatrix prefs={prefs} selectedFareId={selectedFare?.id} view={view} onView={onView}
                onSelect={onSelect} onSnapshot={onSnapshot} refreshRevision={refreshRevision} onStateChange={setMatrixState}/>
        </div>
        <footer className="package-matrix-popup__selection" aria-live="polite">
            {selectedFare ? <div className="package-matrix-popup__fare">
                <strong>{euros.format(selectedFare.total / 100)}</strong>
                <span>{dateLabel(selectedFare.departure)} · {prefs.nights + 1} дней / {prefs.nights} ночей · за всю группу</span>
                {selectedFare.room && <span>{selectedFare.room}{selectedFare.board && ' · ' + selectedFare.board}</span>}
                {selectionCheckedAt && <time dateTime={selectionCheckedAt}>Проверено {new Date(selectionCheckedAt).toLocaleTimeString('ru-RU')}</time>}
                {matrixState.stale && <span>Показана последняя полученная цена. Новая проверка пока не подтверждена.</span>}
            </div> : <div><strong>Выберите цену в матрице</strong>
                <p>Проверенные предложения доступны для выбора. Обновление идёт без перезагрузки страницы.</p></div>}
            {selectedFare && selectionSource && <div className="package-matrix-popup__selection-actions">
                <SaveTripButton item={packageTrip({...hotel, id: hotelId}, selectedFare, destination, prefs, selectionSource, selectionCheckedAt)}/>
                {propertyUrl && <a href={safeHref(propertyUrl)} target="_blank" rel="noopener noreferrer">У оператора ↗</a>}
            </div>}
        </footer>
    </dialog>
}

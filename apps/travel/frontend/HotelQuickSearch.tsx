import {useEffect, useId, useRef, useState} from 'react'
import type {PackageHotel, PackageSummary} from '../src/package-contract.ts'
import type {PackageHotelSearch} from '../src/package-search-contract.ts'
import type {SupplyDestination} from '../src/supply-contract.ts'
import {directoryUrl, useDirectoryQuery} from './directory-query.ts'
import {safeHref} from './DirectoryCard.tsx'
import {packageQuery, type PackagePreferences} from './package-preferences.ts'
import {dateLabel, hotelCount} from './presentation.ts'
import {usePageVisible} from './visible-refresh.ts'
import {Icon} from './Icons.tsx'
import {packageHotelId} from './package-hotel.ts'
import type {tMapBounds} from './DirectoryMap.tsx'
import './hotel-search.css'

const pageSize = 8
const money = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2})

function emptyText(busy: boolean, loaded: boolean) {
    if (busy) return 'Ищем отели…'
    if (!loaded) return 'Результаты поиска ещё не получены.'
    return 'В каталоге нет совпадений. Попробуйте другое название или область карты.'
}

export function HotelQuickSearch({prefs, destination, value, onValue, suspended, onLocate, onOpen,
    expanded, onExpanded: setExpanded, offset, onOffset: setOffset, bounds, areaMode = 'destination'}: {
    prefs: PackagePreferences, destination: SupplyDestination, value: string, onValue: (value: string) => void,
    suspended: boolean, onLocate: (hotel: PackageSummary | PackageHotel) => void,
    onOpen: (hotel: PackageSummary | PackageHotel, view: 'graph' | 'matrix', trigger: HTMLElement) => void,
    expanded: boolean, onExpanded: (expanded: boolean) => void,
    offset: number, onOffset: (offset: number) => void,
    bounds?: tMapBounds | null, areaMode?: 'map' | 'destination',
}) {
    const root = useRef<HTMLFormElement>(null)
    const input = useRef<HTMLInputElement>(null)
    const resultId = useId()
    const skipFocus = useRef(false)
    const [term, setTerm] = useState(value.trim())
    const [snapshot, setSnapshot] = useState<{key: string, data: PackageHotelSearch} | null>(null)
    const visible = usePageVisible()
    const area = bounds ? {west: bounds[0], south: bounds[1], east: bounds[2], north: bounds[3]} : {}
    const scope = {areaMode, ...area}
    const context = JSON.stringify({...packageQuery(prefs), minStars: prefs.minStars, ...scope})
    const previousContext = useRef(value + '/' + context)
    useEffect(() => {
        const nextContext = value + '/' + context
        if (previousContext.current != nextContext) setOffset(0)
        previousContext.current = nextContext
        const timer = setTimeout(() => setTerm(value.trim()), 250)
        return () => clearTimeout(timer)
    }, [value, context])
    const key = directoryUrl('package-hotel-search', {...packageQuery(prefs), ...scope,
        q: term, minStars: prefs.minStars || undefined, offset, limit: pageSize})
    const active = expanded && !suspended && visible
    const settled = term == value.trim()
    const query = useDirectoryQuery<PackageHotelSearch>(active && settled ? key : null)
    useEffect(() => {
        if (query.data) setSnapshot({key, data: query.data})
    }, [key, query.data])
    const previous = snapshot?.key == key ? snapshot.data : undefined
    const data = settled ? query.data ?? previous : undefined
    const busy = !settled || query.loading
    const retryAt = query.error ? undefined : data?.source.retryAt
    useEffect(() => {
        if (!expanded || suspended) return
        function clickedOutside(event: PointerEvent) {
            if (event.target instanceof Node && !root.current?.contains(event.target)) setExpanded(false)
        }
        document.addEventListener('pointerdown', clickedOutside)
        return () => document.removeEventListener('pointerdown', clickedOutside)
    }, [expanded, suspended])
    function closeResults() {
        setExpanded(false)
        skipFocus.current = true
        input.current?.focus({preventScroll: true})
        skipFocus.current = false
    }
    const sourceUnconfirmed = data?.source.status == 'unavailable'
    const stale = Boolean(data?.source.stale || busy || query.error || retryAt)
    const hotels = [...new Map([...(data?.knownHotels ?? []), ...(data?.items ?? [])]
        .map(hotel => [packageHotelId(hotel), hotel] as const)).values()]
    return <form className="hotel-quick-search" role="search" aria-label="Поиск отеля с ценами" ref={root}
        onSubmit={event => {
            event.preventDefault()
            setExpanded(true)
        }} onKeyDown={event => {
            if (event.key == 'Escape' && expanded) {
                event.stopPropagation()
                closeResults()
            }
            if (event.key == 'ArrowDown' && event.target == input.current) {
                event.preventDefault()
                setExpanded(true)
                root.current?.querySelector<HTMLButtonElement>('[data-hotel-result]')?.focus()
            }
        }}>
        <div className="hotel-quick-search__input">
            <Icon name="search" size={19}/>
            <input id="package-hotel-search" ref={input} type="search" value={value} autoComplete="off" maxLength={120}
                placeholder="Найти отель" aria-label="Название отеля" aria-controls={resultId}
                aria-expanded={expanded && !suspended} onFocus={() => { if (!skipFocus.current) setExpanded(true) }}
                onClick={() => setExpanded(true)}
                onChange={event => {
                    onValue(event.target.value)
                    setExpanded(true)
                }}/>
            <button type="button" aria-label="Обновить цены поиска" disabled={busy || !active}
                title="Проверить цены у поставщика заново" onClick={query.refresh}>↻</button>
        </div>
        {expanded && !suspended && <section className="hotel-quick-search__results" id={resultId} aria-label="Найденные отели" aria-busy={busy}>
            <header>
                <div><strong>{term ? 'Результаты поиска' : 'Отели по вашим датам'}</strong>
                    <span>{areaMode == 'map' ? 'В области карты' : destination.name} · {prefs.nights} ночей · {prefs.adults} взрослых</span></div>
                <button type="button" aria-label="Закрыть результаты поиска" onClick={closeResults}><Icon name="close" size={16}/></button>
            </header>
            <div className="hotel-quick-search__state" role="status">
                {busy && <span>Обновляем предложения…</span>}
                {query.error && <span>{query.error} <button type="button" onClick={query.retry}>Повторить</button></span>}
                {!busy && sourceUnconfirmed && <span>Поставщик пока не подтвердил цены.</span>}
                {data?.source.updatedAt && <span>{stale ? 'Последние полученные цены · ' : 'Проверено · '}
                    {new Date(data.source.updatedAt).toLocaleTimeString('ru-RU')}</span>}
            </div>
            {data?.area?.coverage == 'unsupported' && <p className="hotel-quick-search__empty">{data.area.description}</p>}
            {hotels.length ? <ul className="hotel-quick-search__list">{hotels.map(hotel => <li key={packageHotelId(hotel)}
                data-hotel-result-id={packageHotelId(hotel)}>
                {hotel.photo && safeHref(hotel.photo.url) ? <img src={hotel.photo.url} alt="" loading="lazy" decoding="async"/> :
                    <span className="hotel-quick-search__no-photo"><Icon name="pin" size={22}/></span>}
                <div className="hotel-quick-search__hotel">
                    <button type="button" data-hotel-result onClick={() => onLocate(hotel)}>{hotel.name}</button>
                    <span>{hotel.stars == null ? 'Отель' : hotel.stars + ' ★'}
                        {'best' in hotel && ' · вылет ' + dateLabel(hotel.best.departure)}</span>
                    {'minTotal' in hotel ? <strong>{money.format(hotel.minTotal / 100)} <small>за группу</small></strong> :
                        <span className="hotel-quick-search__unconfirmed">Цена в выбранном периоде не получена</span>}
                    {'maxTotal' in hotel && hotel.maxTotal != hotel.minTotal && <span>
                        До {money.format(hotel.maxTotal / 100)} среди полученных предложений</span>}
                    <div className="hotel-quick-search__actions">
                        <button type="button" className="is-primary" onClick={event => onOpen(hotel, 'matrix', event.currentTarget)}>Матрица цен</button>
                        <button type="button" disabled={hotel.latitude == null || hotel.longitude == null}
                            title={hotel.latitude == null || hotel.longitude == null ? 'Координаты пока не подтверждены' : 'Показать отель на карте'}
                            onClick={() => onLocate(hotel)}>На карте</button>
                        <button type="button" onClick={event => onOpen(hotel, 'graph', event.currentTarget)}>Об отеле</button>
                    </div>
                </div>
            </li>)}</ul> : <p className="hotel-quick-search__empty">{emptyText(busy, Boolean(data))}</p>}
            <footer>
                <span>{data && hotelCount(data.total)}{data && ' · ' + data.source.name}</span>
                <div>
                    <button type="button" disabled={busy || offset == 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Назад</button>
                    <button type="button" disabled={busy || data?.nextOffset == null}
                        onClick={() => { if (data?.nextOffset != null) setOffset(data.nextOffset) }}>Ещё отели</button>
                </div>
            </footer>
        </section>}
    </form>
}

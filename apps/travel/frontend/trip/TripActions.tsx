import {useState} from 'react'
import type {FareRecheck} from '../../src/recheck-contract.ts'
import type {SupplyOptions} from '../../src/supply-contract.ts'
import {HotelOptions} from '../DirectoryOffers.tsx'
import {safeHref} from '../DirectoryCard.tsx'
import {directoryUrl, useDirectoryQuery} from '../directory-query.ts'
import {packageQuery} from '../package-preferences.ts'
import {amount, checkedLabel, dayLabel, today, tripDates, tripPeriod, type PackageTrip, type TripItem} from './model.ts'

function tripSummary(item: TripItem) {
    const parts = [
        item.kind == 'package' ? 'Пакетный тур из Таллина' : 'Размещение',
        item.name + ', ' + item.destination, tripPeriod(item) + ' · взрослых: ' + item.prefs.adults,
        item.kind == 'package' ? amount(item.fare.total) + ' за группу · ночей: ' + item.prefs.nights : 'Стоимость размещения нужно уточнить.',
        'Источник: ' + item.source,
    ]
    if (item.checkedAt) parts.push('Данные от ' + checkedLabel(item.checkedAt))
    return parts.join('\n')
}

function CopySummary({item, subject}: {item: TripItem, subject?: string}) {
    const [status, setStatus] = useState<'closed' | 'copied' | 'manual'>('closed')
    const summary = [subject, tripSummary(item)].filter(Boolean).join('\n')
    async function copy() {
        try {
            await navigator.clipboard.writeText(summary)
            setStatus('copied')
        } catch {
            setStatus('manual')
        }
    }
    return <>
        <button type="button" className="trip-link" onClick={copy}>Скопировать параметры</button>
        {status == 'copied' && <small role="status">Параметры поездки скопированы.</small>}
        {status == 'manual' && <label className="trip-copy">Параметры для копирования
            <textarea readOnly value={summary} rows={5} onFocus={event => event.currentTarget.select()}/></label>}
    </>
}

const recheckStatus = {
    confirmed: 'Оператор подтвердил тариф',
    unavailable: 'Оператор больше не предлагает этот тариф',
    unknown: 'Оператор пока не подтвердил тариф',
} as const satisfies Record<FareRecheck['status'], string>

function PackageHandoff({item, onResume}: {item: PackageTrip, onResume: () => void}) {
    const [attempt, setAttempt] = useState(1)
    const prefs = {...packageQuery(item.prefs), firstDeparture: item.fare.departure, lastDeparture: item.fare.departure}
    const url = directoryUrl('package-recheck', {...prefs, minStars: item.prefs.minStars,
        departure: item.fare.departure, hotelId: item.hotelId, fareId: item.fare.id})
    // The keyed child starts empty on every attempt, so yesterday's handoff cannot survive a failed recheck.
    return <RecheckResult key={attempt} url={url} item={item} onResume={onResume} onRetry={() => setAttempt(n => n + 1)}/>
}

function RecheckResult({url, item, onResume, onRetry}: {url: string, item: PackageTrip, onResume: () => void, onRetry: () => void}) {
    const {data, error} = useDirectoryQuery<FareRecheck>(url)
    if (error) return <p role="status">Не удалось проверить тариф. <button type="button" onClick={onRetry}>Повторить</button></p>
    if (!data) return <p role="status">Проверяем у оператора тариф на {dayLabel(item.fare.departure)}…</p>
    const matched = data.status == 'confirmed' && data.fare?.id == item.fare.id && data.fare.departure == item.fare.departure
    const status = data.status == 'confirmed' && !matched ? 'unknown' : data.status
    const summary = matched && data.fare ? {...item, fare: data.fare, checkedAt: data.source.updatedAt, source: data.source.name} : item
    const href = matched ? safeHref(data.hotelUrl) : undefined
    const subject = matched ? 'Прошу проверить возможность оформления тура на следующих условиях.' : recheckStatus[status]
    return <div className="trip-handoff" role="status">
        <h4>{recheckStatus[status]}</h4>
        {matched && data.fare && <p><strong>{amount(data.fare.total)}</strong> за группу · {dayLabel(data.fare.departure)}</p>}
        <p>{data.source.name}{data.source.updatedAt && ' · ' + checkedLabel(data.source.updatedAt)}</p>
        {href && <><a className="trip-primary" href={href} target="_blank" rel="noopener noreferrer">Открыть отель у оператора ↗</a>
            <small>Откроется карточка отеля. Для оформления передайте оператору выбранные даты и параметры тарифа.</small></>}
        {status != 'confirmed' && <div className="trip-actions">
            <button type="button" onClick={onRetry}>Повторить проверку</button>
            <button type="button" onClick={onResume}>Другие даты и цены</button>
        </div>}
        <CopySummary item={summary} subject={subject}/>
    </div>
}

function HotelHandoff({item}: {item: Extract<TripItem, {kind: 'hotel'}>}) {
    const {destination, checkIn, checkOut, adults} = item.prefs
    const url = directoryUrl('options', {destination, hotelId: item.hotelId, checkIn, checkOut, adults})
    const {data, error, retry} = useDirectoryQuery<SupplyOptions>(url)
    if (error) return <p role="status">Не удалось получить варианты поставщиков. <button type="button" onClick={retry}>Повторить</button></p>
    if (!data) return <p role="status">Запрашиваем варианты на ваши даты…</p>
    return <div className="trip-handoff"><HotelOptions data={data}/><CopySummary item={item}/></div>
}

export function TripActions({item, onResume}: {item: TripItem, onResume: () => void}) {
    const [expanded, setExpanded] = useState(false)
    const past = tripDates(item)[0] < today()
    const check = item.kind == 'package' ? 'Проверить тариф' : 'Проверить у поставщиков'
    return <>
        <div className="trip-actions">
            {!past && <button type="button" className="trip-primary" aria-expanded={expanded} onClick={() => setExpanded(open => !open)}>
                {expanded ? 'Свернуть' : check}
            </button>}
            <button type="button" onClick={onResume}>{past ? 'Выбрать новые даты' : 'Вернуться к выбору'}</button>
        </div>
        {past && <small>Сохранённые даты уже прошли.</small>}
        {!past && expanded && (item.kind == 'package' ? <PackageHandoff item={item} onResume={onResume}/> : <HotelHandoff item={item}/>)}
    </>
}

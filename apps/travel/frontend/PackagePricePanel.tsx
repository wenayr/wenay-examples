import type {PackageCalendar, PackageFare} from '../src/package-contract.ts'
import {packageCoordinatePrecisions} from '../src/package-contract.ts'
import {PriceCalendar} from './PriceCalendar.tsx'
import {dateLabel} from './presentation.ts'
import {safeHref} from './DirectoryCard.tsx'

const euros = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'EUR', maximumFractionDigits: 2})
const price = (total: number) => euros.format(total / 100)

interface PackagePricePanelProps {
    name: string
    calendar: PackageCalendar | undefined
    selected: PackageFare | undefined
    missingSelection: boolean
    loading: boolean
    error: string | undefined
    party: string
    onFare: (id: string) => void
    onDate: (date: string) => void
    onOpen: () => void
    onRetry: () => void
}

export function PackagePricePanel({name, calendar, selected, missingSelection, loading, error, party,
    onFare, onDate, onOpen, onRetry}: PackagePricePanelProps) {
    const prices = calendar?.days.flatMap(day => [day.lowest, day.highest].flatMap(fare => fare ? [fare.total] : [])) ?? []
    const min = prices.length ? Math.min(...prices) : null
    const max = prices.length ? Math.max(...prices) : null
    return <section className="package-price-panel" aria-label="График выбранного отеля" aria-busy={loading}>
        <header>
            <div><p>График выбранного отеля</p><h3>{name}</h3><small>{party}</small></div>
            <div className="package-price-panel__selected" aria-live="polite">
                {selected && <><strong>{price(selected.total)}</strong><span>Вылет {dateLabel(selected.departure)}</span></>}
                {missingSelection && <span>Прежний тариф не найден. Выберите другой вылет.</span>}
                {!selected && !missingSelection && !loading && calendar && <span>Полученного тарифа в бюджете нет</span>}
                {loading && <span>Обновляем цены…</span>}
            </div>
        </header>
        {calendar && <>
            {calendar.days.length > 1 && <div className="package-price-panel__range">
                {min != null && <span>Минимум <strong>{price(min)}</strong></span>}
                {max != null && <span>Максимум <strong>{price(max)}</strong></span>}
                <small>Среди полученных тарифов за выбранный период</small>
            </div>}
            <PriceCalendar days={calendar.days} selectedOfferId={selected?.id ?? null} onSelect={fare => onFare(fare.id)}/>
        </>}
        {!calendar && loading && <p className="package-price-panel__loading" role="status">Проверяем даты вылета выбранного отеля…</p>}
        {error && <p className="directory-error" role="status">{error} <button type="button" onClick={onRetry}>Повторить</button></p>}
        {calendar && <div className="package-price-panel__actions">
            <button type="button" className="travel-link" onClick={onOpen}>Подробнее об отеле и тарифах</button>
            {selected && calendar.days.length > 1 && <button type="button" className="travel-link" onClick={() => onDate(selected.departure)}>
                Все отели с вылетом {dateLabel(selected.departure)}</button>}
        </div>}
        {calendar?.hotel.coordinateSource && <p className="package-price-panel__coordinates">
            {packageCoordinatePrecisions[calendar.hotel.coordinateSource.precision]} ·{' '}
            <a href={safeHref(calendar.hotel.coordinateSource.url)} target="_blank" rel="noopener noreferrer">Источник координат ↗</a>
        </p>}
    </section>
}

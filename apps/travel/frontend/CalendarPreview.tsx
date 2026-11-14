import type {CSSProperties} from 'react'
import type {PackageCalendar, PackageDay} from '../src/package-contract.ts'
import {dateLabel} from './presentation.ts'

const euros = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'EUR', maximumFractionDigits: 2})
const format = (value: number) => euros.format(value / 100)

function lowest(day: PackageDay) {
    return day.inBudget ?? day.lowest
}

export function CalendarPreview({calendar, onOpen}: {calendar: PackageCalendar, onOpen: () => void}) {
    const prices = calendar.days.flatMap(day => {
        const fare = lowest(day)
        return fare ? [fare.total] : []
    })
    const [first, last] = [calendar.days[0], calendar.days.at(-1)]
    if (!first || !last) return null
    const low = Math.min(...prices)
    const high = Math.max(...prices)
    return <button className="calendar-preview" aria-label={'Открыть график цен: ' + calendar.hotel.name} onClick={onOpen}>
        <span className="preview-heading"><strong>{calendar.hotel.name}</strong><span>{prices.length > 0 ? format(low) : 'Цены по датам'}
            {high > low && ' – ' + format(high)}</span></span>
        {first !== last && <span className="preview-series" aria-hidden="true">{calendar.days.map(day => {
            const fare = lowest(day)
            if (!fare) return <i key={day.departure} className="preview-gap">{day.status === 'unknown' ? '?' : '–'}</i>
            const height = high === low ? 65 : 22 + (fare.total - low) * 78 / (high - low)
            return <i key={day.departure} className={day.inBudget ? 'preview-budget' : 'preview-outside'}
                style={{'--point-height': height + '%'} as CSSProperties}/>
        })}</span>}
        <small>{dateLabel(first.departure)}{first !== last && ' — ' + dateLabel(last.departure)} · за группу</small>
    </button>
}

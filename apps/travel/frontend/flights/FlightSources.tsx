import {useState} from 'react'
import type {AirlineLink} from '../../src/flight-contract.ts'
import {safeHref} from '../DirectoryCard.tsx'

const airlineAction = {
    full: 'Маршрут, даты и пассажиры', route: 'Проверить направление', none: 'Выбрать рейс на сайте',
} as const satisfies Record<AirlineLink['queryApplied'], string>

export function AirlineSites({items}: {items: AirlineLink[]}) {
    const [phrase, setPhrase] = useState('')
    const [country, setCountry] = useState('all')
    const countries = [...new Set(items.map(carrier => carrier.country))].sort()
    const term = phrase.trim().toLocaleLowerCase('ru')
    const visible = items.filter(carrier => {
        if (country != 'all' && carrier.country != country) return false
        return [carrier.name, carrier.country, carrier.iata].join(' ').toLocaleLowerCase('ru').includes(term)
    })
    if (!items.length) return null
    return <details className="flight-airlines"><summary>Официальные сайты авиакомпаний · {items.length}</summary>
        <p className="flight-note">Найдите перевозчика по названию, стране или коду. Маршрут и места можно проверить на его сайте.</p>
        <div className="flight-airline-filters">
            <label>Авиакомпания или страна<input type="search" value={phrase} placeholder="Например, EgyptAir или Вьетнам"
                onChange={event => setPhrase(event.target.value)}/></label>
            <label>Страна<select value={country} onChange={event => setCountry(event.target.value)}>
                <option value="all">Все страны</option>{countries.map(name => <option key={name}>{name}</option>)}</select></label>
        </div>
        <p className="flight-price-count" role="status">Найдено {visible.length} из {items.length}</p>
        {!visible.length && <p>По этому названию перевозчик в справочнике не найден.</p>}
        <div className="flight-airline-grid">{visible.map(carrier => <article key={carrier.id}>
            <div><h4>{carrier.name}</h4><span>{carrier.country} · {carrier.iata}</span></div>
            <p>{carrier.description}</p>
            <a href={safeHref(carrier.url)} target="_blank" rel="noopener noreferrer">{airlineAction[carrier.queryApplied]} ↗</a>
        </article>)}</div>
    </details>
}

import {useState, type ReactNode} from 'react'
import type {PackageComparison} from '../../src/package-contract.ts'
import {sourceStatus} from '../DirectoryOffers.tsx'
import {directoryUrl, useDirectoryQuery} from '../directory-query.ts'
import {validDate} from '../directory-preferences.ts'
import {packageQuery} from '../package-preferences.ts'
import {amount, checkedLabel, today, tripKey, tripPeriod, type PackageTrip, type TripItem} from './model.ts'

const statuses = {
    'in-budget': 'Есть тариф в бюджете', 'outside-budget': 'Полученные тарифы вне бюджета',
    empty: 'Оператор подтвердил отсутствие предложений', unknown: 'Нет подтверждённых данных',
    filtered: 'Не соответствует выбранной категории',
} as const satisfies Record<PackageComparison['items'][number]['status'], string>

function commonRoute(items: TripItem[]): items is PackageTrip[] {
    const first = items[0]
    if (first?.kind != 'package' || items.some(item => item.kind != 'package')) return false
    return items.every(item => item.kind == 'package' && item.prefs.destination == first.prefs.destination
        && item.prefs.adults == first.prefs.adults && item.prefs.nights == first.prefs.nights)
}

function LiveComparison({items, onResume}: {items: PackageTrip[], onResume: (item: TripItem) => void}) {
    const [reference, setReference] = useState(0)
    const origin = items[reference] ?? items[0]
    const [departure, setDeparture] = useState(() => origin.fare.departure < today() ? today() : origin.fare.departure)
    const dayOk = validDate(departure) && departure >= today()
    const hotelIds = [...new Set(items.map(item => item.hotelId))].join(',')
    const prefs = {...origin.prefs, firstDeparture: departure, lastDeparture: departure}
    const query = {...packageQuery(prefs), minStars: prefs.minStars, departure, hotelIds}
    const {data, error, retry} = useDirectoryQuery<PackageComparison>(dayOk ? directoryUrl('package-compare', query) : null)
    const budgets = new Set(items.map(({prefs: p}) => [p.minTotal, p.maxTotal, p.minStars].join('/')))
    return <section className="trip-live" aria-label="Предложения на общий вылет">
        <h3>Предложения на один вылет</h3>
        <p>{origin.destination} · взрослых: {prefs.adults} · ночей: {prefs.nights} · бюджет {amount(prefs.minTotal)} – {amount(prefs.maxTotal)}
            {prefs.minStars > 0 && ' · от ' + prefs.minStars + ' ★'}</p>
        <div className="trip-live-controls">
            <label>Дата вылета<input type="date" min={today()} value={departure} onChange={e => setDeparture(e.target.value)}/></label>
            {budgets.size > 1 && <label>Бюджет и звёзды как у<select value={reference} onChange={e => setReference(Number(e.target.value))}>
                {items.map((item, i) => <option value={i} key={tripKey(item)}>{item.name} · до {amount(item.prefs.maxTotal)}</option>)}
            </select></label>}
        </div>
        {!dayOk && <p role="status">Выберите текущую или будущую дату вылета.</p>}
        {error && <p role="status">Сравнение сейчас недоступно. <button type="button" onClick={retry}>Повторить</button></p>}
        {dayOk && !data && !error && <p role="status">Проверяем предложения на общий вылет…</p>}
        {data && !error && <ul className="trip-live-results">{data.items.map(result => {
            const saved = items.find(item => item.hotelId == result.hotelId)
            if (!saved) return null
            const fare = result.day.inBudget
            const next = fare && result.status == 'in-budget' ? {...saved, fare, source: result.source.name, checkedAt: result.day.checkedAt,
                prefs: {...prefs, hotelId: saved.hotelId, fareId: fare.id}} : null
            return <li key={result.hotelId}>
                <div><b>{result.hotel?.name || saved.name}</b><span>{statuses[result.status]}</span></div>
                {next && <strong>{amount(next.fare.total)} <small>за группу</small></strong>}
                {result.status == 'outside-budget' && result.day.lowest && <span>Минимум дня · {amount(result.day.lowest.total)}</span>}
                <small>{result.source.name} · {sourceStatus[result.source.status]}{result.day.checkedAt && ' · ' + checkedLabel(result.day.checkedAt)}</small>
                {result.day.status == 'quoted' && !result.day.complete && <small>Часть предложений оператора</small>}
                {next && <button className="trip-link" type="button" onClick={() => onResume(next)}>Открыть этот вылет →</button>}
            </li>
        })}</ul>}
    </section>
}

const fields = [
    ['Поездка', item => item.kind == 'package' ? 'Пакет из Таллина' : 'Размещение'],
    ['Направление', item => item.destination],
    ['Сохранённые даты', tripPeriod],
    ['Гости', item => 'Взрослых: ' + item.prefs.adults],
    ['Категория', item => item.category || 'Не указана'],
    ['Стоимость за группу', item => item.kind == 'package' ? amount(item.fare.total) : 'Цену уточнит поставщик'],
    ['Источник', item => item.source],
    ['Дата данных', item => checkedLabel(item.checkedAt)],
] as const satisfies ReadonlyArray<readonly [string, (item: TripItem) => ReactNode]>

export function TripCompare({items, onResume}: {items: TripItem[], onResume: (item: TripItem) => void}) {
    return <section className="trip-comparison" aria-labelledby="trip-compare-title">
        <h2 id="trip-compare-title" tabIndex={-1}>Сравнение</h2>
        <p>{items.length < 2 ? 'Отметьте два или три варианта в списке поездки.' : 'Условия, сохранённые при выборе каждого варианта.'}</p>
        {items.length >= 2 && <>
            <div className="trip-table-scroll" role="region" aria-label="Таблица сравнения вариантов" tabIndex={0}>
                <table><thead><tr><th scope="col">Условия</th>{items.map(item => <th key={tripKey(item)} scope="col">{item.name}</th>)}</tr></thead>
                    <tbody>{fields.map(([title, read]) => <tr key={title}><th scope="row">{title}</th>
                        {items.map(item => <td key={tripKey(item)}>{read(item)}</td>)}</tr>)}</tbody>
                </table>
            </div>
            {commonRoute(items)
                ? <LiveComparison key={JSON.stringify(items.map(tripKey))} items={items} onResume={onResume}/>
                : <p>Для сравнения цен на один вылет выберите пакетные туры в одном направлении с одинаковой группой и числом ночей.</p>}
        </>}
    </section>
}

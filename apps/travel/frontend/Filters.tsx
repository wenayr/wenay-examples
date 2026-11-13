import {useState} from 'react'
import {defaultSearch, destinations} from '../demo/catalog.ts'
import type {TravelSelection, tDestination} from './preferences.ts'
import {budgetLimit} from './preferences.ts'
import {Icon} from './Icons.tsx'
import {totalLabel} from './presentation.ts'

type Search = TravelSelection['search']

export function Filters({criteria, onChange, onReset}: {
    criteria: Search
    onChange: (value: Search) => void
    onReset: () => void
}) {
    const [expanded, setExpanded] = useState(false)
    const lower = criteria.minTotal / budgetLimit * 100
    const upper = criteria.maxTotal / budgetLimit * 100
    const band = {left: lower + '%', right: 100 - upper + '%'}
    const atUpperEdge = criteria.minTotal == budgetLimit

    function changeDate(key: 'firstDeparture' | 'lastDeparture', value: string) {
        if (value < defaultSearch.firstDeparture || value > defaultSearch.lastDeparture) return
        const firstDeparture = key == 'firstDeparture' ? value : criteria.firstDeparture
        const lastDeparture = key == 'lastDeparture' ? value : criteria.lastDeparture
        if (firstDeparture <= lastDeparture) onChange({...criteria, firstDeparture, lastDeparture})
    }

    return <aside className={'filters' + (expanded ? ' filters--expanded' : '')} aria-label="Параметры поиска">
        <div className="filters-heading"><div><Icon name="filters"/><h2>Фильтры</h2></div>
            <button className="filter-toggle" aria-label="Показать или скрыть фильтры"
                aria-controls="search-fields" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
                <Icon name="down" size={19}/>
            </button>
        </div>
        <div className="filter-fields" id="search-fields">
            <label className="filter-field"><span>Направление</span>
                <select value={criteria.destinationId} onChange={event => {
                    const destinationId = event.currentTarget.value as tDestination
                    onChange({...criteria, destinationId})
                }}>
                    {Object.entries(destinations).map(([id, destination]) =>
                        <option value={id} key={id}>{destination.name}, {destination.country}</option>)}
                </select>
            </label>
            <fieldset><legend>Даты вылета</legend>
                <div className="filter-dates">
                    <label><span>С</span><input aria-label="Дата вылета с" type="date" value={criteria.firstDeparture}
                        min={defaultSearch.firstDeparture} max={criteria.lastDeparture}
                        onChange={event => changeDate('firstDeparture', event.currentTarget.value)} /></label>
                    <label><span>По</span><input aria-label="Дата вылета по" type="date" value={criteria.lastDeparture}
                        min={criteria.firstDeparture} max={defaultSearch.lastDeparture}
                        onChange={event => changeDate('lastDeparture', event.currentTarget.value)} /></label>
                </div>
            </fieldset>
            <fieldset><legend>Бюджет поездки</legend>
                <div className="budget-values"><span>От<strong>{totalLabel(criteria.minTotal)}</strong></span>
                    <span>До<strong>{totalLabel(criteria.maxTotal)}</strong></span></div>
                <div className="budget-track"><div className="budget-base"/><div className="budget-band" style={band}/>
                    <input className={'budget-low' + (atUpperEdge ? ' near-end' : '')} aria-label="Минимальная стоимость"
                        type="range" min={0} max={budgetLimit / 100} step={25} value={criteria.minTotal / 100}
                        aria-valuetext={totalLabel(criteria.minTotal)}
                        onChange={event => onChange({...criteria, minTotal: Math.min(event.currentTarget.valueAsNumber * 100, criteria.maxTotal)})}/>
                    <input className="budget-high" aria-label="Максимальная стоимость" type="range"
                        min={0} max={budgetLimit / 100} step={25} value={criteria.maxTotal / 100} aria-valuetext={totalLabel(criteria.maxTotal)}
                        onChange={event => onChange({...criteria, maxTotal: Math.max(event.currentTarget.valueAsNumber * 100, criteria.minTotal)})}/>
                </div>
                <small>За двоих, с перелётом и проживанием</small>
            </fieldset>
            <div className="filter-itinerary"><span><Icon name="plane"/>Вылет из Таллина <b>TLL</b></span>
                <span><Icon name="calendar"/>10 дней</span><span><Icon name="people"/>2 туриста</span></div>
            <button className="filter-reset" type="button" onClick={onReset}>Сбросить фильтры</button>
        </div>
    </aside>
}

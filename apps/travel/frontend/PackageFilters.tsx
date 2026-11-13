import {useState} from 'react'
import {packageMaxTotal, packageWindowDays} from '../src/package-contract.ts'
import type {SupplyDestination} from '../src/supply-contract.ts'
import {shiftDate, validDate} from './directory-preferences.ts'
import {packageDefaults, usualBudget, type PackagePreferences} from './package-preferences.ts'
import {Icon} from './Icons.tsx'

type FilterProps = {
    prefs: PackagePreferences
    destinations: SupplyDestination[]
    onChange: (patch: Partial<PackagePreferences>) => void
}

export function PackageFilters({prefs, destinations, onChange}: FilterProps) {
    const [expanded, setExpanded] = useState(false)
    const today = new Date().toISOString().slice(0, 10)
    const lastAllowed = shiftDate(prefs.firstDeparture, packageWindowDays - 1)
    const sliderEnd = Math.max(usualBudget, prefs.maxTotal)
    function changeFirst(value: string) {
        if (!validDate(value) || value < today) return
        const oldLength = (Date.parse(prefs.lastDeparture) - Date.parse(prefs.firstDeparture)) / 86_400_000
        onChange({firstDeparture: value, lastDeparture: shiftDate(value, oldLength)})
    }
    function changeBudget(key: 'minTotal' | 'maxTotal', euros: number) {
        const value = Math.round(euros * 100)
        if (!Number.isSafeInteger(value) || value < 0 || value > packageMaxTotal) return
        if (key === 'minTotal') onChange({minTotal: Math.min(value, prefs.maxTotal)})
        else onChange({maxTotal: Math.max(value, prefs.minTotal)})
    }
    return <aside className={'directory-filters filters' + (expanded ? ' filters--expanded' : '')}>
        <div className="filters-heading"><div><Icon name="filters"/><h2>Поиск тура</h2></div>
            <button className="filter-toggle" type="button" aria-label="Параметры тура" aria-expanded={expanded}
                aria-controls="package-filters" onClick={() => setExpanded(!expanded)}><Icon name="down"/></button></div>
        <div className="filter-fields" id="package-filters">
            <label className="filter-field"><span>Направление тура</span><select value={prefs.destination}
                onChange={e => onChange({destination: e.target.value})}>
                {destinations.map(place => <option key={place.id} value={place.id}>{place.name} · {place.country}</option>)}
            </select></label>
            <fieldset><legend>Даты вылета</legend>
                <label className="filter-field"><span>Первый вылет</span><input type="date" min={today}
                    value={prefs.firstDeparture} onChange={e => changeFirst(e.target.value)}/></label>
                <label className="filter-field"><span>Последний вылет</span><input type="date" min={prefs.firstDeparture} max={lastAllowed}
                    value={prefs.lastDeparture} onChange={e => {
                        const value = e.target.value
                        if (value >= prefs.firstDeparture && value <= lastAllowed) onChange({lastDeparture: value})
                    }}/></label>
                <label className="filter-field"><span>Ночей</span><select value={prefs.nights} onChange={e => onChange({nights: Number(e.target.value)})}>
                    {Array.from({length: 30}, (_, i) => <option key={i + 1}>{i + 1}</option>)}</select></label>
                <p className="package-party"><Icon name="people" size={16}/> 2 взрослых · вылет из Таллина</p>
            </fieldset>
            <fieldset><legend>Бюджет за группу, €</legend>
                <div className="package-budget-fields">{(['minTotal', 'maxTotal'] as const).map(key => {
                    const side = key === 'minTotal' ? 'от' : 'до'
                    return <label className="filter-field" key={key}><span>{side === 'от' ? 'От' : 'До'}</span>
                        <input type="number" aria-label={'Бюджет ' + side + ', €'} min={0} max={packageMaxTotal / 100} step="0.01"
                            value={prefs[key] / 100} onChange={e => changeBudget(key, e.target.valueAsNumber)}/></label>
                })}</div>
                <div className="budget-track"><div className="budget-base"/><div className="budget-band" style={{
                    left: prefs.minTotal / sliderEnd * 100 + '%', right: (1 - prefs.maxTotal / sliderEnd) * 100 + '%',
                }}/>
                    <input type="range" className={'budget-low' + (prefs.minTotal === sliderEnd ? ' near-end' : '')}
                        aria-label="Минимальная стоимость тура" min={0} max={sliderEnd / 100} step={1} value={prefs.minTotal / 100}
                        onChange={e => changeBudget('minTotal', e.target.valueAsNumber)}/>
                    <input type="range" className="budget-high" aria-label="Максимальная стоимость тура"
                        min={0} max={sliderEnd / 100} step={1} value={prefs.maxTotal / 100}
                        onChange={e => changeBudget('maxTotal', e.target.valueAsNumber)}/>
                </div>
            </fieldset>
            <label className="filter-field"><span>Звёзды от</span><select value={prefs.minStars}
                onChange={e => onChange({minStars: Number(e.target.value)})}>
                <option value={0}>Любая категория</option>
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} ★</option>)}</select></label>
            <button type="button" className="filter-reset" onClick={() => onChange({...packageDefaults(), destination: prefs.destination})}>
                Сбросить фильтры</button>
        </div>
    </aside>
}

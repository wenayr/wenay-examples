import {createContext, useContext, useEffect, useMemo, useState, type ReactNode} from 'react'
import {packageComparisonLimit} from '../../src/package-contract.ts'
import {Icon} from '../Icons.tsx'
import {amount, checkedLabel, compareTrip, restoreTrip, setTrip, tripKey, tripPeriod, type TripItem, type TripState} from './model.ts'
import {createTripStorage} from './storage.ts'
import {TripActions} from './TripActions.tsx'
import {TripCompare} from './TripCompare.tsx'
import './trip.css'

interface TripContextValue {
    data: TripState
    ready: boolean
    temporary: boolean
    edit: (change: (state: TripState) => TripState) => void
}
const TripContext = createContext<TripContextValue | null>(null)

export function TripProvider({children}: {children: ReactNode}) {
    const [view, setView] = useState(() => ({data: restoreTrip(null), ready: false, temporary: false}))
    const storage = useMemo(() => createTripStorage((data, temporary) => setView({data, ready: true, temporary})), [])
    useEffect(() => {
        storage.refresh()
        window.addEventListener('storage', storage.changed)
        return () => window.removeEventListener('storage', storage.changed)
    }, [storage])
    return <TripContext.Provider value={{...view, edit: storage.edit}}>{children}</TripContext.Provider>
}

function useTrip() {
    const trip = useContext(TripContext)
    if (!trip) throw new Error('План поездки требует TripProvider.')
    return trip
}

export function useTripCount() {
    return useTrip().data.items.length
}

export function SaveTripButton({item}: {item: TripItem}) {
    const {data, ready, edit} = useTrip()
    const key = tripKey(item)
    const saved = data.items.some(existing => tripKey(existing) == key)
    const label = saved ? 'В поездке' : 'В поездку'
    return <button type="button" className="trip-save" disabled={!ready} aria-pressed={saved} aria-label={label + ': ' + item.name}
        title={saved ? 'Убрать из поездки' : 'Сохранить в поездку'} onClick={() => edit(current => setTrip(current, item, !saved))}>
        <svg width="15" height="17" viewBox="0 0 16 20" aria-hidden="true" fill={saved ? 'currentColor' : 'none'}>
            <path d="M3 2.5h10v14l-5-3-5 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        </svg>{label}</button>
}

function TripCard({item, onResume}: {item: TripItem, onResume: () => void}) {
    const {data, edit} = useTrip()
    const key = tripKey(item)
    const included = data.compare.includes(key)
    return <article className="trip-card" aria-label={item.name}>
        <div className="trip-card-head"><p className="trip-kind"><Icon name={item.kind == 'package' ? 'plane' : 'pin'} size={16}/>
            {item.kind == 'package' ? 'Тур из Таллина' : 'Размещение'} · {item.destination}</p>
            <button type="button" className="trip-remove" aria-label={'Убрать из поездки: ' + item.name}
                onClick={() => edit(current => setTrip(current, item, false))}><Icon name="close" size={16}/></button></div>
        <h3>{item.name}</h3>
        <p className="trip-period">{tripPeriod(item)} · взрослых: {item.prefs.adults}</p>
        <p className="trip-card-price">{item.kind == 'package'
            ? <>Сохранено · <strong>{amount(item.fare.total)}</strong> за группу · {item.prefs.nights} ноч.</>
            : 'Цена — по запросу у поставщика'}</p>
        <p className="trip-source">{item.source}{item.checkedAt && ' · данные от ' + checkedLabel(item.checkedAt)}</p>
        <label className="trip-compare-toggle"><input type="checkbox" checked={included} disabled={!included && data.compare.length >= packageComparisonLimit}
            aria-label={'Сравнить: ' + item.name} onChange={() => edit(current => compareTrip(current, key, !included))}/> Сравнить</label>
        <TripActions item={item} onResume={onResume}/>
    </article>
}

export function TripPlan({onResume, flightSection}: {onResume: (item: TripItem) => void, flightSection?: ReactNode}) {
    const {data, ready, temporary} = useTrip()
    const selections = data.compare.flatMap(key => data.items.filter(item => tripKey(item) == key))
    return <main className="travel-home trip-home" id="trip">
        <header className="trip-heading"><div><h1>Моя поездка</h1>
            <p>Сохранённые отели и вылеты. Выберите варианты для сравнения или проверьте цену перед оформлением.</p></div>
            <a href="#catalog">Подобрать отель <Icon name="arrow" size={16}/></a></header>
        {flightSection}
        {!ready && <p role="status">Загружаем сохранённые варианты…</p>}
        {temporary && <p role="status">Хранилище браузера недоступно. Поездка сохранится до закрытия этой вкладки.</p>}
        {ready && !data.items.length && <section className="trip-empty"><Icon name="compass" size={34}/>
            <h2>Какие варианты возьмём в поездку?</h2>
            <p>Нажмите «В поездку» возле отеля или выбранной цены вылета. Здесь останутся его даты, источник и условия.</p>
            <div className="trip-actions"><a href="#catalog">Выбрать отель</a>
                <a className="trip-primary" href="#packages">Найти тур из Таллина</a></div></section>}
        {ready && data.items.length > 0 && <div className="trip-layout">
            <section className="trip-saved" aria-labelledby="trip-saved-title"><header className="trip-saved-head">
                <h2 id="trip-saved-title">Мои варианты <span>{data.items.length}</span></h2>
                {selections.length >= 2 && <button type="button" className="trip-link" onClick={() => {
                    document.getElementById('trip-compare-title')?.focus()
                }}>К сравнению ({selections.length}) ↓</button>}</header>
                {data.items.map(item => <TripCard key={tripKey(item)} item={item} onResume={() => onResume(item)}/>)}</section>
            <TripCompare items={selections} onResume={onResume}/>
        </div>}
    </main>
}

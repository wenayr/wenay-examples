import {useEffect, useState} from 'react'
import type {SupplyDestination} from '../src/supply-contract.ts'
import {createDirectoryPreferences} from './directory-preferences.ts'
import {directoryUrl, useDirectoryQuery} from './directory-query.ts'
import {travelHash} from './navigation.ts'
import {supportsPackage} from './package-preferences.ts'
import {photo} from './presentation.ts'
import {Icon} from './Icons.tsx'

const covers = {hurghada: 'hurghada', phuket: 'phuket', paphos: 'paphos'} as const
const directoryPrefs = createDirectoryPreferences()

function destinationsLike(places: SupplyDestination[], text: string, packages: boolean) {
    const query = text.toLocaleLowerCase('ru').trim()
    return places.filter(place => (!packages || supportsPackage(place.id)) &&
        (place.name + ' ' + place.country).toLocaleLowerCase('ru').includes(query))
}

export function Discover() {
    const places = useDirectoryQuery<{destinations: SupplyDestination[]}>(directoryUrl('destinations'))
    const [request, setRequest] = useState('')
    const [filter, setFilter] = useState('')
    const [packages, setPackages] = useState(false)
    const [previous, setPrevious] = useState('')
    useEffect(() => {
        let active = true
        void directoryPrefs.load().then(prefs => { if (active) setPrevious(prefs.destination) })
        return () => { active = false }
    }, [])
    const destinations = places.data?.destinations ?? []
    const selected = destinations.find(place => place.id === previous)
    const visible = destinationsLike(destinations, filter, packages)
    function resetFilters() {
        setFilter('')
        setPackages(false)
    }
    const target = packages ? 'packages' : 'catalog'
    return <main className="travel-home discover-home">
        <section className="discover-hero">
            <div className="discover-intro">
                <p className="discover-departure"><Icon name="plane" size={17}/> Из Таллина</p>
                <h1>Куда отправимся?</h1>
                <p className="discover-subtitle">Подберите перелёт, отель или тур на свои даты.</p>
                <form className="discover-request" onSubmit={event => {
                    event.preventDefault()
                    window.location.hash = travelHash('assistant', undefined, {message: request.trim()})
                }}>
                    <label htmlFor="discover-request">Какую поездку вы планируете?</label>
                    <div><input id="discover-request" type="text" value={request} maxLength={320}
                        placeholder="Например, Хургада в январе на 10 ночей"
                        onChange={event => setRequest(event.target.value)}/>
                        <button type="submit" aria-label="Открыть подбор поездки"><Icon name="arrow"/></button></div>
                </form>
            </div>
            <a className="discover-cover" href={travelHash('catalog', 'phuket')} aria-label="Посмотреть отели Пхукета">
                <img src={photo('phuket')} alt="Побережье Пхукета" fetchPriority="high"/>
                <span>Таиланд <b>Пхукет <Icon name="arrow"/></b></span>
            </a>
        </section>
        <div className="discover-jumps">
            <a href="#packages"><Icon name="suitcase"/><span><strong>Пакетные туры</strong>
                <small>Перелёт и отель, цена за двоих</small></span><Icon name="arrow" size={16}/></a>
            <a href="#flights"><Icon name="plane"/><span><strong>Авиабилеты</strong>
                <small>В одну сторону или туда и обратно</small></span><Icon name="arrow" size={16}/></a>
            {selected ? <a href={travelHash('catalog', selected.id)}><Icon name="pin"/><span><strong>Вернуться к поиску</strong>
                <small>{selected.name} · {selected.country}</small></span><Icon name="arrow" size={16}/></a>
                : <a href="#catalog"><Icon name="map"/><span><strong>Отели на карте</strong>
                    <small>Искать в выбранной области</small></span><Icon name="arrow" size={16}/></a>}
        </div>
        <section className="discover-places" aria-labelledby="discover-heading">
            <div className="discover-head"><h2 id="discover-heading">Направления</h2>
                <label className="place-search"><Icon name="search" size={16}/><input aria-label="Найти город или страну" type="search"
                    placeholder="Город или страна" value={filter} onChange={event => setFilter(event.target.value)}/></label></div>
            <div className="discover-segments" role="group" aria-label="Направления по типу поездки">
                <button aria-pressed={!packages} onClick={() => setPackages(false)}>Все направления</button>
                <button aria-pressed={packages} onClick={() => setPackages(true)}>С пакетными турами</button></div>
            {places.error && <p role="status">{places.error} <button className="travel-link" onClick={places.retry}>Повторить</button></p>}
            {!places.error && !places.data && <p role="status">Загружаем направления…</p>}
            {places.data && !visible.length && <p role="status">Таких направлений в каталоге пока нет.
                {' '}<button className="travel-link" onClick={resetFilters}>Показать все</button></p>}
            <div className="place-tiles">{visible.map(place => {
                const cover = covers[place.id as keyof typeof covers]
                return <a className={'place-tile' + (cover ? ' place-tile-photo' : '')} href={travelHash(target, place.id)} key={place.id}>
                    {cover && <img src={photo(cover)} loading="lazy" alt=""/>}
                    <span><small>{place.country}</small><strong>{place.name}</strong></span><Icon name="arrow" size={17}/>
                </a>
            })}</div>
        </section>
    </main>
}

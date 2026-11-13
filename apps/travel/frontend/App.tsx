import {useMemo, useState} from 'react'
import {useStoreNode} from 'wenay-react2/react'
import {destinations, hotels, demoOffers} from '../demo/catalog.ts'
import {searchTours} from '../src/search-tours.ts'
import type {createTravelSearch} from './state.ts'
import type {TravelSelection, tDestination} from './preferences.ts'
import {photo, hotelCount} from './presentation.ts'
import {Filters} from './Filters.tsx'
import {HotelCard} from './HotelCard.tsx'
import {HotelDetail} from './HotelDetail.tsx'
import {HotelMap} from './HotelMap.tsx'
import {Icon} from './Icons.tsx'

export function App({store}: {store: ReturnType<typeof createTravelSearch>}) {
    const criteria = useStoreNode(store.node.search, {mode: 'snapshot'}).value
    const hotelId = useStoreNode(store.node.hotelId).value
    const offerId = useStoreNode(store.node.offerId).value
    const [detailOpen, setDetailOpen] = useState(false)
    const results = useMemo(() => {
        return searchTours(demoOffers, criteria).map(result => ({...result, ...hotels[result.hotelId]}))
    }, [criteria])
    const active = results.find(hotel => hotel.hotelId == hotelId) ?? results[0]
    const chosenDay = active?.calendar.find(day => day.inBudget?.id == offerId)
    const offer = chosenDay?.inBudget ?? active?.best
    const destination = destinations[criteria.destinationId]
    const markers = useMemo(() => results.map(hotel => ({
        id: hotel.hotelId, name: hotel.name, latitude: hotel.latitude, longitude: hotel.longitude,
        outline: hotel.outline, prices: hotel.calendar.map(day => day.inBudget?.total ?? null),
        minTotal: hotel.best.total, maxTotal: hotel.inBudgetMaxTotal,
    })), [results])
    const dates = useMemo(() => results[0]?.calendar.map(day => day.departure) ?? [], [results])
    const singleDay = criteria.firstDeparture == criteria.lastDeparture

    function updateCriteria(next: TravelSelection['search']) {
        const samePlace = next.destinationId == criteria.destinationId
        const selection = samePlace ? {hotelId, offerId} : {hotelId: '', offerId: ''}
        store.select({search: next, ...selection})
        setDetailOpen(false)
    }

    function openHotel(id: string) {
        const hotel = results.find(item => item.hotelId == id)
        if (!hotel) return
        const chosenOfferId = hotel.hotelId == active?.hotelId ? offer?.id : hotel.best.id
        store.select({search: criteria, hotelId: id, offerId: chosenOfferId ?? hotel.best.id})
        setDetailOpen(true)
    }

    function reset() {
        setDetailOpen(false)
        store.reset()
    }

    return <>
        <header className="site-mast"><div className="mast-inner">
            <a className="wordmark" href="#top" aria-label="Wenay Travel, в начало">
                <span className="brand-icon"><Icon name="compass" size={23}/></span>Wenay <em>Travel</em></a>
            <div className="mast-location"><span>Таллин, Эстония</span><span>EUR €</span></div>
        </div></header>
        <main id="top" className="travel-home">
            <section className="destination-hero" aria-label="Выбранное направление">
                <img fetchPriority="high" src={photo(criteria.destinationId)} alt=""/>
                <div className="hero-shade"/>
                <div className="hero-content"><p><span className="route-line"/>Туры из Таллина</p>
                    <h1>{destination.name}</h1><span className="hero-country"><Icon name="pin" size={17}/>{destination.country}</span></div>
                <div className="route-ticket"><span>Маршрут</span><div>TLL <Icon name="plane" size={18}/> {destination.airport}</div></div>
            </section>
            <nav className="destinations" aria-label="Направления">{Object.entries(destinations).map(([id, place]) =>
                <button key={id} type="button" aria-pressed={id == criteria.destinationId}
                    onClick={() => updateCriteria({...criteria, destinationId: id as tDestination})}>{place.name}</button>)}</nav>
            <div className="search-layout">
                <Filters criteria={criteria} onChange={updateCriteria} onReset={reset}/>
                <div className="result-column">
                    <section className="map-panel" aria-labelledby="map-title">
                        <div className="section-heading"><div className="section-title"><Icon name="map" size={21}/><h2 id="map-title">Отели на карте</h2></div>
                            <span aria-live="polite">{hotelCount(results.length)}</span></div>
                        <HotelMap destination={{...destination, id: criteria.destinationId}} dates={dates}
                            hotels={markers} selectedId={active?.hotelId ?? null} onSelect={openHotel}/>
                        <p className="map-caption">Контуры отелей приблизительные. Цены включают перелёт и проживание для двоих.</p>
                    </section>
                    <section className="hotels-panel" aria-labelledby="hotels-title">
                        <div className="section-heading"><h2 id="hotels-title">Выбор отеля</h2><span>По возрастанию цены</span></div>
                        {results.length > 0 ? <div className="hotel-grid">{results.map(hotel =>
                            <HotelCard key={hotel.hotelId} hotel={hotel} singleDay={singleDay}
                                selected={hotelId == hotel.hotelId} onOpen={openHotel}/>)}</div> :
                            <div className="no-matches"><h3>На этих условиях туров нет</h3><p>Расширьте бюджет или выберите другие даты вылета.</p>
                                <button type="button" onClick={reset}>Сбросить фильтры</button></div>}
                    </section>
                </div>
            </div>
        </main>
        <footer className="travel-footer"><strong>Wenay Travel</strong><span>Демонстрационные отели и тарифы. На фото — направления.</span>
            <a href={import.meta.env.BASE_URL + 'images/credits.html'}>Авторы фотографий</a></footer>
        {detailOpen && active && offer && <HotelDetail hotel={active} offer={offer} onClose={() => setDetailOpen(false)}
            onOffer={quote => store.select({search: criteria, hotelId: active.hotelId, offerId: quote.id})}/>}
    </>
}

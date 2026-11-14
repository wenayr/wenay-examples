import {useEffect, useState} from 'react'
import type {FlightQuery} from '../src/flight-contract.ts'
import type {TravelChatQuery} from '../src/assistant-contract.ts'
import type {createTravelSearch} from './state.ts'
import {DemoTours} from './DemoTours.tsx'
import {Directory} from './Directory.tsx'
import {Discover} from './Discover.tsx'
import {PackageSearch} from './PackageSearch.tsx'
import {Icon} from './Icons.tsx'
import {TravelAssistant, type AssistantSearch} from './assistant/TravelAssistant.tsx'
import {TripPlan, TripProvider, useTripCount} from './trip/TripPlan.tsx'
import type {TripItem} from './trip/model.ts'
import {Flights, FlightResume} from './flights/Flights.tsx'
import {flightLink} from './flights/preferences.ts'
import {travelHash, travelPages, travelRoute, type TravelRoute} from './navigation.ts'
import {shiftDate, validDate} from './directory-preferences.ts'
import './directory.css'
import './journey.css'

const mainPages = ['discover','catalog','packages','flights','assistant'] as const satisfies (keyof typeof travelPages)[]

function TopBar({page}: {page: TravelRoute['page']}) {
    const count = useTripCount()
    return <header className="site-mast"><div className="mast-inner">
        <a className="wordmark" href="#discover" aria-label="Wenay Travel, главная">
            <span className="brand-icon"><Icon name="compass" size={23}/></span>Wenay <em>Travel</em>
        </a>
        <nav aria-label="Разделы Wenay Travel" className="travel-pages">
            {mainPages.map(key => <a key={key} href={travelHash(key)} aria-current={page === key ? 'page' : undefined}>{travelPages[key]}</a>)}
        </nav>
        <a className="mast-trip" href="#trip" aria-current={page === 'trip' ? 'page' : undefined}><Icon name="suitcase" size={18}/>
            Моя поездка{count > 0 && <b>{count}</b>}</a>
    </div></header>
}

function Footer() {
    return <footer className="travel-footer"><strong>Wenay Travel</strong><span>Таллин, Эстония · EUR</span>
        <div className="footer-links"><a href="#demo">Демо туров</a>
            <a href={import.meta.env.BASE_URL + 'hotel-photos/credits.html'}>Фотографии отелей</a>
            <a href={import.meta.env.BASE_URL + 'images/credits.html'}>Фотографии направлений</a></div></footer>
}

function assistantContext(route: TravelRoute): Partial<TravelChatQuery> | undefined {
    const kind = route.query.get('kind')
    if (kind === 'flights') {
        const flight: Partial<FlightQuery> = {}
        for (const key of ['origin', 'destination'] as const) {
            const code = route.query.get(key)?.toUpperCase()
            if (code && /^[A-Z]{3}$/.test(code)) flight[key] = code
        }
        const departure = route.query.get('departure')
        const inbound = route.query.get('returnDate')
        if (validDate(departure)) flight.departure = departure
        if (inbound === '') flight.returnDate = null
        if (validDate(inbound)) flight.returnDate = inbound
        const adults = route.query.get('adults')
        if (adults && /^[1-9]$/.test(adults)) flight.adults = Number(adults)
        if (route.query.has('checkedBag')) flight.checkedBag = route.query.get('checkedBag') === 'true'
        return {kind, flight}
    }
    if (kind !== 'catalog' && kind !== 'packages') return undefined
    const initial: Partial<TravelChatQuery> = {kind, destination:route.destination}
    for (const key of ['minStars','nights','adults','minTotal','maxTotal'] as const) {
        const value = route.query.get(key)
        if (value && /^\d+$/.test(value)) initial[key] = Number(value)
    }
    for (const key of ['firstDeparture','lastDeparture'] as const) {
        const value = route.query.get(key)
        if (validDate(value)) initial[key] = value
    }
    const phrase = route.query.get('phrase')
    if (phrase) initial.phrase = phrase.slice(0, 120)
    return initial
}

function applySearch(action: AssistantSearch) {
    if (action.kind === 'flights') {
        window.location.hash = flightLink(action.query)
        return
    }
    const {destination, firstDeparture, lastDeparture, nights, adults, minTotal, maxTotal, minStars, phrase} = action.query
    if (action.kind === 'packages') {
        window.location.hash = travelHash('packages', destination, {firstDeparture, lastDeparture, nights, adults, minTotal, maxTotal, minStars,
            hotelId:action.hotelId, fareId:action.fareId, hotelName:action.hotelName})
    } else {
        window.location.hash = travelHash('catalog', destination, {adults, checkIn:firstDeparture, search:phrase ?? '',
            checkOut:validDate(firstDeparture) ? shiftDate(firstDeparture, nights ?? 7) : undefined, hotelId:action.hotelId})
    }
}

function resume(item: TripItem) {
    window.location.hash = travelHash(item.kind === 'hotel' ? 'catalog' : 'packages', item.prefs.destination,
        {...item.prefs, hotelId:item.hotelId, hotelName:item.name})
}

export function App({store}: {store: ReturnType<typeof createTravelSearch>}) {
    const [location, setLocation] = useState(() => ({hash: window.location.hash, visit: 0}))
    useEffect(() => {
        function navigate() {
            const hash = window.location.hash
            setLocation(current => ({hash, visit: current.visit + 1}))
            window.scrollTo(0, 0)
        }
        window.addEventListener('hashchange', navigate)
        return () => window.removeEventListener('hashchange', navigate)
    }, [])
    const route = travelRoute(location.hash)
    useEffect(() => { document.title = travelPages[route.page] + ' · Wenay Travel' }, [route.page])
    return <TripProvider>
        <TopBar page={route.page}/>
        {route.page === 'discover' && <Discover/>}
        {route.page === 'packages' && <PackageSearch key={location.visit} route={route}/>}
        {route.page === 'catalog' && <Directory key={location.visit} route={route}/>}
        {route.page === 'demo' && <DemoTours store={store}/>}
        {route.page === 'flights' && <Flights key={location.visit} route={route}/>}
        {route.page === 'assistant' && <TravelAssistant key={location.visit} initialMessage={route.query.get('message') ?? ''}
            initialContext={assistantContext(route)} onApply={applySearch}/>}
        {route.page === 'trip' && <TripPlan onResume={resume} flightSection={<FlightResume/>}/>}
        {route.page !== 'demo' && <Footer/>}
    </TripProvider>
}

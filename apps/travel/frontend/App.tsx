import {useEffect, useRef, useState, type MouseEvent} from 'react'
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
import {ProviderMarketplace} from './ProviderMarketplace.tsx'
import {ProviderDashboard} from './ProviderDashboard.tsx'
import {AgencyGuides} from './AgencyGuides.tsx'
import {SavedSupply} from './SavedSupply.tsx'
import {Markets} from './Markets.tsx'
import {marketContext} from './market-links.ts'
import './directory.css'
import './journey.css'

const mainPages = ['catalog', 'packages', 'flights', 'deals'] as const satisfies (keyof typeof travelPages)[]
const morePages = ['discover', 'markets', 'prices', 'assistant'] as const satisfies (keyof typeof travelPages)[]
const agencyPages = ['providers', 'guides'] as const satisfies (keyof typeof travelPages)[]

function refreshMarketsLink(event: MouseEvent<HTMLAnchorElement>) {
    const current = travelRoute(window.location.hash)
    const params = new URLSearchParams(current.query)
    if (current.page == 'flights') params.set('kind', 'flights')
    if (current.page == 'catalog') params.set('kind', 'hotels')
    event.currentTarget.setAttribute('href', travelHash('markets', undefined, marketContext(params)))
}

function TopBar({page}: {page: TravelRoute['page']}) {
    const count = useTripCount()
    const more = useRef<HTMLDetailsElement>(null)
    function closeMore() {
        if (more.current) more.current.open = false
    }
    function openMore(event: MouseEvent<HTMLAnchorElement>) {
        if (event.currentTarget.dataset.page == 'markets') refreshMarketsLink(event)
        closeMore()
    }
    useEffect(closeMore, [page])
    return <header className="site-mast"><div className="mast-inner">
        <a className="wordmark" href="#discover" aria-label="Wenay Travel, главная">
            <span className="brand-icon"><Icon name="compass" size={23}/></span>Wenay <em>Travel</em>
        </a>
        <nav aria-label="Разделы Wenay Travel" className="travel-pages">
            {mainPages.map(key => <a key={key} href={travelHash(key)} aria-current={page === key ? 'page' : undefined}>
                {key == 'deals' ? 'Горящие' : travelPages[key]}</a>)}
            <details className="travel-more" ref={more} onBlur={event => {
                if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
            }} onKeyDown={event => {
                if (event.key != 'Escape') return
                event.currentTarget.open = false
                event.currentTarget.querySelector('summary')?.focus()
            }}>
                <summary data-current={[...morePages, ...agencyPages].some(key => key == page) || undefined}>Ещё</summary>
                <div className="travel-more-links">{morePages.map(key =>
                    <a key={key} href={travelHash(key)} data-page={key} onClick={openMore} onAuxClick={openMore}
                        aria-current={page == key ? 'page' : undefined}>{travelPages[key]}</a>)}
                    <span>Для агентства</span>{agencyPages.map(key =>
                        <a key={key} href={travelHash(key)} onClick={closeMore} aria-current={page == key ? 'page' : undefined}>{travelPages[key]}</a>)}
                </div>
            </details>
        </nav>
        <a className="mast-trip" href="#trip" aria-current={page === 'trip' ? 'page' : undefined}><Icon name="suitcase" size={18}/>
            Моя поездка{count > 0 && <b>{count}</b>}</a>
    </div></header>
}

function Footer() {
    return <footer className="travel-footer"><strong>Wenay Travel</strong><span>Таллин, Эстония · EUR</span>
        <div className="footer-links"><a href="#demo">Демо туров</a>
            <a href="#markets" onClick={refreshMarketsLink} onAuxClick={refreshMarketsLink}>Страны и поставщики</a>
            <a href="#providers">Источники и подключение</a><a href="#guides">Гиды агентства</a>
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
    const content = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const previousRestoration = window.history.scrollRestoration
        window.history.scrollRestoration = 'manual'
        let restoring = false
        let observer: ResizeObserver | undefined
        let restoreTimer: ReturnType<typeof setTimeout> | undefined
        let saveTimer: ReturnType<typeof setTimeout> | undefined
        let frame = 0
        function remember() {
            if (restoring) return
            const state = window.history.state
            window.history.replaceState({...state, travelScroll: {x: window.scrollX, y: window.scrollY}}, '')
        }
        function stopRestore() {
            observer?.disconnect()
            clearTimeout(restoreTimer)
            cancelAnimationFrame(frame)
            restoring = false
        }
        function restore() {
            stopRestore()
            const stored = window.history.state?.travelScroll
            const x = Number.isFinite(stored?.x) ? Math.max(0, stored.x) : 0
            const y = Number.isFinite(stored?.y) ? Math.max(0, stored.y) : 0
            restoring = true
            function attempt(force = false) {
                if (!restoring) return
                const available = document.documentElement.scrollHeight - window.innerHeight
                if (!force && available < y) return
                window.scrollTo(x, y)
                stopRestore()
                remember()
            }
            frame = requestAnimationFrame(() => {
                attempt()
                if (restoring) {
                    observer = new ResizeObserver(() => attempt())
                    if (content.current) observer.observe(content.current)
                }
            })
            restoreTimer = setTimeout(() => attempt(true), 5000)
        }
        function moved() {
            clearTimeout(saveTimer)
            saveTimer = setTimeout(remember, 120)
        }
        function userInteraction() {
            if (!restoring) return
            stopRestore()
            remember()
        }
        function navigate() {
            clearTimeout(saveTimer)
            const hash = window.location.hash
            setLocation(current => ({hash, visit: current.visit + 1}))
            restore()
        }
        restore()
        window.addEventListener('hashchange', navigate)
        window.addEventListener('scroll', moved, {passive: true})
        document.addEventListener('click', remember, true)
        document.addEventListener('pointerdown', userInteraction, true)
        document.addEventListener('wheel', userInteraction, {capture: true, passive: true})
        document.addEventListener('keydown', userInteraction, true)
        return () => {
            stopRestore()
            clearTimeout(saveTimer)
            window.history.scrollRestoration = previousRestoration
            window.removeEventListener('hashchange', navigate)
            window.removeEventListener('scroll', moved)
            document.removeEventListener('click', remember, true)
            document.removeEventListener('pointerdown', userInteraction, true)
            document.removeEventListener('wheel', userInteraction, true)
            document.removeEventListener('keydown', userInteraction, true)
        }
    }, [])
    const route = travelRoute(location.hash)
    useEffect(() => { document.title = travelPages[route.page] + ' · Wenay Travel' }, [route.page])
    return <TripProvider>
        <a className="travel-skip" href="#travel-content" onClick={event => {
            event.preventDefault()
            content.current?.focus()
            content.current?.scrollIntoView({block: 'start'})
        }}>Перейти к содержимому</a>
        <TopBar page={route.page}/>
        <div id="travel-content" ref={content} tabIndex={-1}>
        {route.page === 'discover' && <Discover/>}
        {route.page === 'packages' && <PackageSearch key={location.visit} route={route}/>}
        {route.page === 'catalog' && <Directory key={location.visit} route={route}/>}
        {route.page === 'demo' && <DemoTours store={store}/>}
        {route.page === 'flights' && <Flights key={location.visit} route={route}/>}
        {route.page === 'prices' && <ProviderMarketplace key={location.visit} route={route}/>}
        {route.page === 'deals' && <ProviderMarketplace key={location.visit} route={route} deals/>}
        {route.page === 'markets' && <Markets key={location.visit} route={route}/>}
        {route.page === 'providers' && <ProviderDashboard route={route}/>}
        {route.page === 'guides' && <AgencyGuides route={route}/>}
        {route.page === 'assistant' && <TravelAssistant key={location.visit} initialMessage={route.query.get('message') ?? ''}
            initialContext={assistantContext(route)} onApply={applySearch}/>}
        {route.page === 'trip' && <TripPlan onResume={resume} flightSection={<><FlightResume/><SavedSupply/></>}/>}
        </div>
        {route.page !== 'demo' && <Footer/>}
    </TripProvider>
}

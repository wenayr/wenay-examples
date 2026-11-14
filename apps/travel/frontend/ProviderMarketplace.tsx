import {useEffect, useRef, useState, type FormEvent} from 'react'
import type {ProviderAvailability, ProviderQuery, tProviderKind} from '../src/provider-contract.ts'
import type {SupplyDestination} from '../src/supply-contract.ts'
import {DirectoryMap, type tMapBounds} from './DirectoryMap.tsx'
import {directoryUrl, useDirectoryQuery} from './directory-query.ts'
import {AirportPicker} from './flights/AirportPicker.tsx'
import {ProviderResults} from './ProviderResults.tsx'
import {providerAvailable, providerKindNames, providerQueryError, providerQueryFromParams, providerQueryLink, providerQueryParams, useProviderSearch} from './provider-client.ts'
import type {TravelRoute} from './navigation.ts'
import {travelHash} from './navigation.ts'
import './providers.css'

function LocationFields({query, onChange, places}: {
    query: ProviderQuery, onChange: (patch: Partial<ProviderQuery>) => void, places: SupplyDestination[],
}) {
    const destination = {
        id: 'provider-world', name: query.destination || 'Район поиска', country: '',
        latitude: query.latitude ?? 0, longitude: query.longitude ?? 0,
    }
    const [scopeNote, setScopeNote] = useState('')
    function area([west, south, east, north]: tMapBounds) {
        const latitude = (north + south) / 2
        const middle = (west + east) / 2
        const longitude = ((middle + 180) % 360 + 360) % 360 - 180
        const height = (north - south) * 111
        const width = (east - west) * 111 * Math.cos(latitude * Math.PI / 180)
        const distance = Math.hypot(height, width) / 2
        setScopeNote(distance > 200 ? 'Выбран большой район. Каждый источник сообщает собственное покрытие и ограничения в ответе.' : '')
        onChange({latitude: Number(latitude.toFixed(5)), longitude: Number(longitude.toFixed(5)),
            radiusKm: Math.max(1, Math.ceil(distance)), destination: undefined, providerRefs: undefined})
    }
    function quickPlace(id: string) {
        const place = places.find(item => item.id == id)
        if (place) onChange({destination: place.name, latitude: place.latitude, longitude: place.longitude, radiusKm: 10})
    }
    return <>
        <div className="provider-form-grid">
            <label>Быстро выбрать район<select value={places.find(place => place.id == query.destination || place.name == query.destination)?.id ?? ''}
                onChange={event => quickPlace(event.target.value)}><option value="">Выбрать на карте</option>
                {places.map(place => <option key={place.id} value={place.id}>{place.name} · {place.country}</option>)}</select></label>
            <label>Город или район<input value={query.destination ?? ''} maxLength={120}
                onChange={event => onChange({destination: event.target.value, latitude: undefined, longitude: undefined})}
                placeholder="Например, Bangkok или London"/></label>
            <label>Радиус, км<input type="number" min="1" step="1" value={query.radiusKm ?? 10}
                onChange={event => onChange({radiusKm: Number(event.target.value)})}/></label>
        </div>
        <details className="provider-map-picker" open={query.latitude == null || query.longitude == null}>
            <summary>Выбрать район на карте мира</summary>
            <p>Приблизьте нужный район. После остановки карты поиск обновится автоматически. Кнопка на карте повторяет поиск области.</p>
            <DirectoryMap destination={destination} hotels={[]} selectedId={null} onSelect={() => {}} onSearchArea={area} world/>
            <p role="status">{scopeNote || (query.latitude != null
                ? 'Центр поиска ' + query.latitude + ', ' + query.longitude + ' · радиус ' + (query.radiusKm ?? 10) + ' км.'
                : 'Приблизьте и выберите район для поиска цен.')}</p>
        </details>
        <div className="provider-form-grid provider-coordinates">
            <label>Широта<input type="number" min="-90" max="90" step="any" value={query.latitude ?? ''}
                onChange={event => onChange({latitude: event.target.value ? Number(event.target.value) : undefined})}/></label>
            <label>Долгота<input type="number" min="-180" max="180" step="any" value={query.longitude ?? ''}
                onChange={event => onChange({longitude: event.target.value ? Number(event.target.value) : undefined})}/></label>
        </div>
    </>
}

function PartnerReferences({items, query, onChange}: {
    items: ProviderAvailability[], query: ProviderQuery, onChange: (patch: Partial<ProviderQuery>) => void,
}) {
    function reference(id: string, fields: {hotelIds?: string[], destinationId?: string}) {
        onChange({providerRefs: {...query.providerRefs, [id]: {...query.providerRefs?.[id], ...fields}}})
    }
    const relevant = items.filter(provider => provider.kinds.includes(query.kind))
    const available = relevant.filter(providerAvailable).map(provider => provider.id)
    const references = relevant.filter(provider => provider.queryFields.some(field => field.startsWith('providerRefs.')))
    return <details className="provider-reference-fields"><summary>Выбор источников и параметры партнёрских каталогов</summary>
        <p>По умолчанию запросят все подходящие подключённые источники.
            Если нужен код отеля или направления, укажите его из каталога партнёра.</p>
        <div className="provider-source-checks">{relevant.map(provider => <label key={provider.id}>
            <input type="checkbox" checked={(query.providers ?? available).includes(provider.id)} disabled={!providerAvailable(provider)} onChange={event => {
                const current = query.providers ?? available
                const providers = event.target.checked ? [...current, provider.id] : current.filter(id => id != provider.id)
                onChange({providers})
            }}/>{provider.name}<small>{providerAvailable(provider) ? 'Готов к запросу' : 'Проверьте подключение'}</small>
        </label>)}</div>
        <div className="provider-reference-grid">{references.filter(provider => provider.configured || query.providers?.includes(provider.id)).map(provider =>
            <div key={provider.id}><strong>{provider.name}</strong>
                <label>Коды отелей через запятую<input defaultValue={query.providerRefs?.[provider.id]?.hotelIds?.join(', ') ?? ''}
                    placeholder="Если требуются этому поставщику" onChange={event => reference(provider.id, {
                        hotelIds: event.target.value.split(',').map(value => value.trim()).filter(Boolean).slice(0, 20),
                    })}/></label>
                <label>Код направления<input value={query.providerRefs?.[provider.id]?.destinationId ?? ''}
                    onChange={event => reference(provider.id, {destinationId: event.target.value})}/></label>
            </div>)}</div>
        <a href="#providers">Проверить доступ и требования источников →</a>
    </details>
}

function ProviderForm({initial, deals, items, places, onSearch}: {
    initial: ProviderQuery, deals: boolean, items: ProviderAvailability[], places: SupplyDestination[], onSearch: (query: ProviderQuery) => void,
}) {
    const [draft, setDraft] = useState(initial)
    const [error, setError] = useState('')
    const submitted = useRef(JSON.stringify(initial))
    const search = useRef(onSearch)
    search.current = onSearch
    const draftKey = JSON.stringify(draft)
    useEffect(() => {
        if (providerQueryError(draft) || draftKey == submitted.current) return
        const timer = setTimeout(() => {
            if (draftKey == submitted.current) return
            submitted.current = draftKey
            search.current(draft)
        }, 500)
        return () => clearTimeout(timer)
    }, [draftKey])
    const hotel = draft.kind == 'hotels'
    function update(patch: Partial<ProviderQuery>) {
        setDraft(query => ({...query, ...patch, offset: undefined}))
        setError('')
    }
    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const issue = providerQueryError(draft)
        setError(issue)
        if (!issue) {
            submitted.current = draftKey
            onSearch(draft)
        }
    }
    const kinds = ['hotels', 'packages', 'flights'] as const satisfies readonly tProviderKind[]
    return <form className="provider-search-form" onSubmit={submit}>
        {!deals && <div className="discover-segments" role="group" aria-label="Что сравнить">
            {kinds.map(kind => <button type="button" key={kind} aria-pressed={draft.kind == kind}
                onClick={() => update({kind, providers: undefined})}>{providerKindNames[kind]}</button>)}</div>}
        {hotel ? <LocationFields query={draft} onChange={update} places={places}/>
            : <div className="provider-route-fields"><AirportPicker label="Аэропорт вылета" value={draft.origin ?? ''}
                onChange={origin => update({origin})}/>
                {draft.kind == 'flights' ? <AirportPicker label="Аэропорт прилёта" value={draft.destination ?? ''}
                    onChange={destination => update({destination})}/>
                    : <label>Направление<input value={draft.destination ?? ''} required={!deals} maxLength={120} list="provider-destinations"
                        onChange={event => update({destination: event.target.value})}
                        placeholder={deals ? 'Все направления' : 'hurghada, sharm, phuket или код поставщика'}/>
                        <datalist id="provider-destinations">{places.map(place =>
                            <option key={place.id} value={place.id}>{place.name}</option>)}</datalist></label>}
            </div>}
        <div className="provider-form-grid">
            {hotel ? <>
                <label>Заезд<input type="date" required value={draft.checkIn ?? ''} onChange={event => update({checkIn: event.target.value})}/></label>
                <label>Выезд<input type="date" required min={draft.checkIn} value={draft.checkOut ?? ''}
                    onChange={event => update({checkOut: event.target.value})}/></label>
            </> : <>
                <label>{deals ? 'Вылет, необязательно' : 'Вылет'}<input type="date" required={!deals} value={draft.departure ?? ''}
                    onChange={event => update({departure: event.target.value || undefined})}/></label>
                <label>Обратно<input type="date" min={draft.departure} value={draft.returnDate ?? ''}
                    onChange={event => update({returnDate: event.target.value || null})}/></label>
            </>}
            <label>Взрослых<input type="number" min="1" max="9" required value={draft.adults}
                onChange={event => update({adults: Number(event.target.value)})}/></label>
            {hotel && <label>Номеров<input type="number" min="1" max="9" required value={draft.rooms ?? 1}
                onChange={event => update({rooms: Number(event.target.value)})}/></label>}
            {!hotel && draft.kind != 'flights' && <label>Ночей<input type="number" min="1" max="60" value={draft.nights ?? ''}
                placeholder="Любая длительность" onChange={event => update({nights: event.target.value ? Number(event.target.value) : undefined})}/></label>}
            <label>Валюта<select value={draft.currency ?? 'EUR'} onChange={event => update({currency: event.target.value})}>
                <option>EUR</option><option>USD</option><option>GBP</option><option>THB</option></select></label>
        </div>
        <details className="provider-market-fields"><summary>Рынок покупателя</summary><div className="provider-form-grid">
            <label>Гражданство, ISO2<input maxLength={2} value={draft.nationality ?? ''} placeholder="EE"
                onChange={event => update({nationality: event.target.value.toUpperCase()})}/></label>
            <label>Страна бронирующего, ISO2<input maxLength={2} value={draft.bookerCountry ?? ''} placeholder="EE"
                onChange={event => update({bookerCountry: event.target.value.toUpperCase()})}/></label>
            <label>Возраст взрослых через запятую<input defaultValue={draft.adultAges?.join(', ') ?? ''} placeholder="Например, 35, 32"
                onChange={event => {
                    const ages = event.target.value.trim() ? event.target.value.split(',').map(value => Number(value.trim())) : undefined
                    update({adultAges: ages})
                }}/></label>
        </div></details>
        <PartnerReferences items={items} query={draft} onChange={update}/>
        <div className="provider-search-actions"><button type="submit">{deals ? 'Найти горящие предложения' : 'Сравнить цены'}</button>
            <a href={providerQueryLink(draft)}>Ссылка на этот поиск</a></div>
        <p className="provider-auto-note" role="status">{providerQueryError(draft) || 'Поиск обновляется автоматически после изменения параметров.'}</p>
        {error && <p className="directory-error" role="alert">{error}</p>}
    </form>
}

export function ProviderMarketplace({route, deals = false}: {route: TravelRoute, deals?: boolean}) {
    const initial = providerQueryFromParams(route.query, deals ? 'deals' : 'hotels')
    if (deals) initial.kind = 'deals'
    const auto = !providerQueryError(initial)
    const [query, setQuery] = useState<ProviderQuery | null>(auto ? initial : null)
    const [refresh, setRefresh] = useState(0)
    const providers = useDirectoryQuery<{items: ProviderAvailability[]}>(directoryUrl('providers'))
    const places = useDirectoryQuery<{destinations: SupplyDestination[]}>(directoryUrl('destinations'))
    const search = useProviderSearch(query, refresh)
    const hotelName = route.query.get('hotelName')?.slice(0, 240)
    const returnTo = route.query.get('returnTo')
    const back = returnTo?.startsWith('#catalog') ? returnTo : '#catalog'
    useEffect(() => {
        if (!query) return
        let checked = Date.now()
        function update() {
            if (document.hidden || Date.now() - checked < 60_000) return
            checked = Date.now()
            setRefresh(value => value + 1)
        }
        const timer = setInterval(update, 60_000)
        document.addEventListener('visibilitychange', update)
        window.addEventListener('online', update)
        return () => {
            clearInterval(timer)
            document.removeEventListener('visibilitychange', update)
            window.removeEventListener('online', update)
        }
    }, [JSON.stringify(query)])
    function run(next: ProviderQuery) {
        setQuery(next)
        setRefresh(value => value + 1)
        const fields = hotelName ? {hotelName, returnTo: back} : {}
        window.history.replaceState(null, '', travelHash(deals ? 'deals' : 'prices', undefined, {...providerQueryParams(next), ...fields}))
    }
    return <main className="travel-home provider-marketplace"><header className="agency-heading">
        <p>{deals ? 'С основанием от источника' : 'Единый запрос поставщикам'}</p>
        <h1>{deals ? 'Горящие предложения' : 'Сравнить цены'}</h1>
        <span>{deals ? 'Акции поставщиков и подтверждённые снижения цены с условиями и сроком проверки.'
            : 'Перелёты, размещение и пакетные туры на выбранные даты.'}</span>
    </header>
        {hotelName && <aside className="provider-hotel-context"><strong>Исходный отель · {hotelName}</strong>
            <p>Ищем цены в выбранном районе. Предложения относятся к объектам, названным в карточках поставщика.</p>
            <a href={back}>← Вернуться к отелю и прежнему поиску</a></aside>}
        <ProviderForm initial={initial} deals={deals} items={providers.data?.items ?? []} places={places.data?.destinations ?? []} onSearch={run}/>
        {providers.error && <p role="status">Статусы источников временно недоступны. <button onClick={providers.retry}>Повторить</button></p>}
        {query && <section className="provider-search-output"><h2 id="provider-search-result-heading" tabIndex={-1}>Результат поиска</h2>
            {search.loading && <p role="status">
                {search.data ? 'Обновляем цены, показан предыдущий ответ этого поиска…' : 'Проверяем подключённые источники…'}</p>}
            {search.error && <p className="directory-error" role="status">{search.error}
                {' '}<button onClick={() => setRefresh(value => value + 1)}>Повторить</button></p>}
            {search.data && <ProviderResults key={JSON.stringify(query)} data={search.data} query={query}
                names={Object.fromEntries((providers.data?.items ?? []).map(item => [item.id, item.name]))}
                onRetry={() => setRefresh(value => value + 1)}/>}
        </section>}
    </main>
}

import {useMemo} from 'react'
import {useStoreNode} from 'wenay-react2/react'
import {defaultSearch, demoOffers, hotels} from '../demo/catalog.ts'
import {searchTours} from '../src/search-tours.ts'
import {HotelMap} from './HotelMap.tsx'
import {PriceCalendar} from './PriceCalendar.tsx'
import type {createTravelSearch} from './state.ts'

const rubles = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'RUB', maximumFractionDigits: 0})
const dates = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'long', timeZone: 'UTC'})
function departureLabel(iso: string) { return dates.format(new Date(iso + 'T00:00:00Z')) }
function hotelCount(count: number) { return count === 1 ? '1 отель' : count === 0 ? '0 отелей' : count + ' отеля' }

export function App({store}: {store: ReturnType<typeof createTravelSearch>}) {
  const search = useStoreNode(store.node.search, {mode: 'snapshot'})
  const selectedHotel = useStoreNode(store.node.hotelId)
  const selectedOffer = useStoreNode(store.node.offerId)
  const criteria = search.value
  const results = useMemo(() => searchTours(demoOffers, criteria).map(result => ({
    ...result, ...hotels[result.hotelId],
  })), [criteria])
  const active = results.find(h => h.hotelId === selectedHotel.value) ?? results[0]
  const offer = active?.calendar.find(day => day.inBudget?.id === selectedOffer.value)?.inBudget ?? active?.best
  const markers = useMemo(() => results.map(h => ({
    id: h.hotelId, name: h.name, latitude: h.latitude, longitude: h.longitude, total: h.best.total,
  })), [results])

  function chooseHotel(id: string) {
    selectedHotel.set(id)
    selectedOffer.set('')
  }

  function reset() {
    search.set({...defaultSearch})
    selectedHotel.set('')
    selectedOffer.set('')
  }

  return <main className="travel-shell">
    <header className="travel-brand">
      <span className="travel-emblem" aria-hidden="true">W</span>
      <strong>Wenay Travel</strong>
      <span className="travel-demo">Демонстрационные предложения</span>
    </header>
    <section className="travel-title">
      <p className="travel-route">Москва <span aria-hidden="true">→</span> Египет</p>
      <h1>Хургада<span>.</span></h1>
      <p>Перелёт и проживание для двоих · 10 дней</p>
    </section>
    <section className="travel-filters" aria-label="Параметры поиска">
      <fieldset>
        <legend>Даты вылета</legend>
        <div className="travel-dates">
          <label>С <input type="date" value={criteria.firstDeparture} min={defaultSearch.firstDeparture}
            max={criteria.lastDeparture} onChange={e => {
              const value = e.target.value
              if (value >= defaultSearch.firstDeparture && value <= criteria.lastDeparture) search.set({...criteria, firstDeparture: value})
            }} /></label>
          <label>По <input type="date" value={criteria.lastDeparture} min={criteria.firstDeparture}
            max={defaultSearch.lastDeparture} onChange={e => {
              const value = e.target.value
              if (value >= criteria.firstDeparture && value <= defaultSearch.lastDeparture) search.set({...criteria, lastDeparture: value})
            }} /></label>
        </div>
      </fieldset>
      <fieldset className="travel-budget">
        <legend>Бюджет за весь тур</legend>
        <div className="travel-limits">
          <label>От <b>{rubles.format(criteria.minTotal / 100)}</b>
            <input aria-label="Минимальная стоимость" type="range" min={70_000} max={160_000} step={1000}
              value={criteria.minTotal / 100} onChange={e => search.set({...criteria, minTotal: Math.min(criteria.maxTotal, e.target.valueAsNumber * 100)})} /></label>
          <label>До <b>{rubles.format(criteria.maxTotal / 100)}</b>
            <input aria-label="Максимальная стоимость" type="range" min={70_000} max={160_000} step={1000}
              value={criteria.maxTotal / 100} onChange={e => search.set({...criteria, maxTotal: Math.max(criteria.minTotal, e.target.valueAsNumber * 100)})} /></label>
        </div>
      </fieldset>
      <button type="button" className="travel-reset" onClick={reset}>Сбросить</button>
    </section>
    <div className="travel-layout">
      <section className="travel-map-panel" aria-labelledby="map-title">
        <div className="travel-panel-head"><h2 id="map-title">Отели на карте</h2><span aria-live="polite">{hotelCount(results.length)}</span></div>
        <HotelMap hotels={markers} selectedId={active?.hotelId ?? null} onSelect={chooseHotel}/>
        {results.length > 0 && <div className="travel-hotel-list" aria-label="Подходящие отели">{results.map(h =>
          <button type="button" aria-pressed={active?.hotelId === h.hotelId} key={h.hotelId} onClick={() => chooseHotel(h.hotelId)}>
            <strong>{h.name}</strong><span>от {rubles.format(h.best.total / 100)}</span>
          </button>
        )}</div>}
      </section>
      <section className="travel-detail" aria-label="Даты и стоимость для выбранного отеля">
        {active && offer ? <>
          <div className="travel-detail-title"><p>{active.area}</p><h2>{active.name}</h2></div>
          <PriceCalendar key={active.hotelId} days={active.calendar} selectedOfferId={offer.id} onSelect={q => selectedOffer.set(q.id)}/>
          <div className="travel-total" aria-live="polite">
            <div><span>Выбранный тур</span><strong>Вылет {departureLabel(offer.departure)}</strong><small>{criteria.tripDays} дней · 2 туриста</small></div>
            <b>{rubles.format(offer.total / 100)}</b>
          </div>
        </> : <div className="travel-empty"><h2>Подходящих туров пока нет</h2><p>Расширь бюджет или выбери другие даты вылета в январе.</p><button type="button" onClick={reset}>Вернуть исходный поиск</button></div>}
      </section>
    </div>
  </main>
}

import {useState, type CSSProperties} from 'react'
import type {searchTours, TourOffer} from '../src/search-tours.ts'
import './calendar.css'

type CalendarDay = ReturnType<typeof searchTours>[number]['calendar'][number]

interface PriceCalendarProps {
  days: CalendarDay[]
  selectedOfferId: string | null
  onSelect: (offer: TourOffer) => void
}

const euros = new Intl.NumberFormat('ru-RU', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2,
})
const dateFormat = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'long', timeZone: 'UTC'})
const axisFormat = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 2})

function price(total: number) {
  return euros.format(total / 100)
}

function dateLabel(iso: string) {
  return dateFormat.format(new Date(iso + 'T00:00:00Z'))
}

function quoteDescription(day: CalendarDay) {
  if (!day.lowest) return 'Предложений нет'
  if (!day.inBudget) return 'Минимум ' + price(day.lowest.total) + ' · вне бюджета'
  if (day.inBudget.total !== day.lowest.total) {
    return 'В бюджете ' + price(day.inBudget.total) + ' · минимум дня ' + price(day.lowest.total)
  }
  return price(day.inBudget.total) + ' · в бюджете'
}

// Use a dot plot with a local scale. Mark only observed prices, including isolated dates.
function chartScale(days: CalendarDay[]) {
  const prices = days.flatMap(day => [day.lowest, day.inBudget].flatMap(offer => offer ? [offer.total] : []))
  const low = Math.min(...prices)
  const high = Math.max(...prices)
  const range = Math.max(high - low, high / 20, 100)
  const power = 10 ** Math.floor(Math.log10(range / 2))
  const step = ([1, 2, 5, 10].find(n => n * power >= range / 2) ?? 10) * power
  const bottom = Math.max(0, Math.floor(low / step) * step)
  const top = Math.max(bottom + step, Math.ceil(high / step) * step)
  return {bottom, top, step}
}

function trendPath(days: CalendarDay[], field: 'lowest' | 'inBudget', y: (total: number) => number) {
  let connected = false
  return days.map((day, index) => {
    const offer = day[field]
    if (!offer) {
      connected = false
      return ''
    }
    const point = (connected ? 'L' : 'M') + (index + 0.5) + ',' + y(offer.total)
    connected = true
    return point
  }).join(' ')
}

export function PriceCalendar({days, selectedOfferId, onSelect}: PriceCalendarProps) {
  const [inspectedDate, setInspectedDate] = useState<string | null>(null)
  const selected = days.find(day => day.inBudget && day.inBudget.id === selectedOfferId)
  const inspected = days.find(day => day.departure === inspectedDate) ?? selected
  if (!days.some(day => day.lowest)) {
    return <section className="travel-calendar" aria-label="Стоимость по датам вылета">
      <h3>Стоимость по датам вылета</h3>
      <p>На выбранные даты нет предложений.</p>
    </section>
  }

  if (days.length == 1) {
    const day = days[0]
    const priceForDate = day.inBudget ?? day.lowest
    return <section className="travel-calendar" aria-label="Стоимость на дату вылета">
      <h3>Стоимость на дату вылета</h3>
      <p>{dateLabel(day.departure)} · <strong>{priceForDate && price(priceForDate.total)}</strong></p>
    </section>
  }

  const {bottom, top, step} = chartScale(days)
  const y = (total: number) => 100 - (total - bottom) / (top - bottom) * 100
  const ticks = []
  for (let amount = bottom; amount <= top; amount += step) ticks.push(amount)
  const axisThousands = top >= 1_000_000 && step >= 10_000
  const axisValue = (amount: number) => axisFormat.format(amount / (axisThousands ? 100_000 : 100))
  return <section className="travel-calendar" aria-label="Стоимость по датам вылета">
    <h3>Стоимость по датам вылета</h3>
    <div className="travel-calendar__key">
      <span className="travel-calendar__key-budget">В бюджете</span>
      <span className="travel-calendar__key-lowest">Минимум дня</span>
    </div>
    <div className="travel-calendar__unit">{axisThousands ? 'тыс. €' : '€'}</div>
    <div className="travel-calendar__chart">
      <div className="travel-calendar__axis" aria-hidden="true">
        {ticks.map(amount => <span key={amount} style={{top: y(amount) + '%'}}>{axisValue(amount)}</span>)}
      </div>
      <div className="travel-calendar__scroll">
        <div className="travel-calendar__plot" style={{'--day-count': days.length} as CSSProperties}>
          <div className="travel-calendar__lines" aria-hidden="true">
            {ticks.map(amount => <i key={amount} style={{top: y(amount) + '%'}} />)}
            <svg viewBox={'0 0 ' + days.length + ' 100'} preserveAspectRatio="none">
              <path className="travel-calendar__trend-lowest" d={trendPath(days, 'lowest', y)} />
              <path className="travel-calendar__trend-budget" d={trendPath(days, 'inBudget', y)} />
            </svg>
          </div>
          {days.map(day => {
            const active = day.inBudget != null && day.inBudget.id === selectedOfferId
            const description = dateLabel(day.departure) + '. ' + quoteDescription(day)
            return <button key={day.departure} type="button"
              className={'travel-calendar__day' + (active ? ' is-selected' : '')}
              aria-label={description} aria-pressed={day.inBudget ? active : undefined}
              onFocus={() => setInspectedDate(day.departure)}
              onMouseEnter={() => setInspectedDate(day.departure)}
              onClick={() => {
                setInspectedDate(day.departure)
                if (day.inBudget) onSelect(day.inBudget)
              }}>
              <span className="travel-calendar__points" aria-hidden="true">
                {day.lowest && <i className="travel-calendar__low-dot" style={{top: y(day.lowest.total) + '%'}} />}
                {day.inBudget && <i className="travel-calendar__budget-dot" style={{top: y(day.inBudget.total) + '%'}} />}
                {!day.lowest && <i className="travel-calendar__missing">–</i>}
              </span>
              <span className="travel-calendar__date" aria-hidden="true">{Number(day.departure.slice(-2))}</span>
            </button>
          })}
        </div>
      </div>
    </div>
    <div className="travel-calendar__details" aria-live="polite">
      {inspected
        ? <><strong>{dateLabel(inspected.departure)}</strong><span>{quoteDescription(inspected)}</span></>
        : <span>Выберите дату вылета на графике.</span>}
    </div>
  </section>
}

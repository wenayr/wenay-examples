import test from 'node:test'
import assert from 'node:assert/strict'
import {readRyanairCalendar, ryanairCalendar, ryanairUrl} from '../backend/flights/ryanair.ts'
import {directAirlineLinks} from '../backend/flights/carriers.ts'

const query = {origin: 'DUB', destination: 'STN', departure: '2026-12-15', returnDate: '2026-12-22', adults: 2, checkedBag: false}

function day(date: string, amount: number, other = {}) {
    return {day: date, soldOut: false, unavailable: false, price: {value: amount, currencyCode: 'EUR'}, ...other}
}

test('Ryanair calendar excludes unusable fares and keeps a one-adult source link for a party', () => {
    const fares = [day('2026-12-11', 1), day('2026-12-12', 30), day('2026-12-13', 40), day('2026-12-15', 20),
        day('2026-12-16', 1, {soldOut: true}), day('2026-12-17', 1, {unavailable: true}),
        day('2026-12-18', 1, {price: {value: 1, currencyCode: 'GBP'}})]
    const rows = readRyanairCalendar({outbound: {fares}}, query, '2026-11-14')
    assert.deepEqual(rows.map(row => [row.departure, row.perPerson]), [['2026-12-12', 3000], ['2026-12-13', 4000], ['2026-12-15', 2000]])
    const cheapest = rows[2]
    assert.deepEqual(cheapest.benchmark, {count: 2, median: 3500, saving: 1500})
    const url = new URL(cheapest.sourceUrl)
    assert.equal(url.searchParams.get('adults'), '1')
    assert.equal(url.searchParams.get('isReturn'), 'false')
    const trip = new URL(ryanairUrl(query))
    assert.equal(trip.searchParams.get('adults'), '2')
    assert.equal(trip.searchParams.get('dateIn'), '2026-12-22')
})

test('checked baggage is not inferred from a carrier calendar or a direct website', async () => {
    const result = await ryanairCalendar({fetch: async () => { throw new Error('must not fetch a base fare') },
        now: () => new Date('2026-11-14T08:00:00Z')}, {...query, checkedBag: true})
    assert.equal(result.source.status, 'handoff')
    assert.equal(result.rows.length, 0)
    const links = directAirlineLinks(query)
    for (const id of ['aerlingus', 'egyptair', 'thaiairways', 'vietnamairlines']) {
        const airline = links.find(link => link.id == id)
        assert.ok(airline)
        assert.equal(airline.queryApplied, 'none')
        assert.equal(new URL(airline.url).protocol, 'https:')
    }
})

test('direct route pages must confirm the pair instead of matching airport names in navigation', async () => {
    const {carrierRouteMatches} = await import('../backend/flights/carriers.ts')
    const q = {...query, origin: 'HAN', destination: 'BKK'}
    assert.equal(carrierRouteMatches('<title>Hanoi to Bangkok flights</title>', q, 'Hanoi (Soc Son)', 'Bangkok'), true)
    assert.equal(carrierRouteMatches('<title>Book flights</title><nav>Hanoi Bangkok</nav>', q, 'Hanoi', 'Bangkok'), false)
    assert.equal(carrierRouteMatches('{"originAirportCode":"BKK","destinationAirportCode":"HAN"}', q, 'Hanoi', 'Bangkok'), false)
    assert.equal(carrierRouteMatches('{"originAirportCode":"HAN","destinationAirportCode":"BKK"}', q, 'Hanoi', 'Bangkok'), true)
})

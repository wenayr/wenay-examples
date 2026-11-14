import test from 'node:test'
import assert from 'node:assert/strict'
import {compareFlightOffers} from '../backend/flights/comparison.ts'
import {createFlights} from '../backend/flights/index.ts'
import {createTravelAssistant} from '../backend/assistant.ts'
import type {FlightOffer, FlightQuery} from '../src/flight-contract.ts'

test('expired or incomplete flight conditions never receive an exact-comparison saving', () => {
    const now = new Date('2026-11-14T10:00:00Z')
    const offer: FlightOffer = {id: 'a', carrier: 'Example', total: 10000, currency: 'EUR', slices: [], checkedBags: 1,
        expiresAt: '2026-11-14T11:00:00Z', benchmark: null, operatingCarriers: ['Example'], conditions: 'Known conditions',
        comparisonKey: 'same', taxesIncluded: true}
    const other = {...offer, id: 'b', total: 15000}
    assert.equal(compareFlightOffers([offer, other], now).groups[0].saving, 5000)
    assert.deepEqual(compareFlightOffers([offer, {...other, conditions: null}], now).groups, [])
    assert.deepEqual(compareFlightOffers([offer, {...other, checkedBags: null}], now).groups, [])
    assert.deepEqual(compareFlightOffers([offer, {...other, expiresAt: now.toISOString()}], now).groups, [])
})

test('public alternatives reach the chat and cached calendars preserve their one-adult basis and check time', async t => {
    const query: FlightQuery = {origin: 'DUB', destination: 'LHR', departure: '2026-12-15', returnDate: null, adults: 2, checkedBag: false}
    const checked = new Date('2026-11-14T10:00:00Z')
    const html = '<input aria-label="Departure" value="Tue, Dec 15">"2026-12-15"' +
        '<div aria-label="Number of adult passengers" aria-valuenow="2"></div>' +
        '<li><div aria-label="From 100 euros. Nonstop flight with Aer Lingus."><b>DUB</b><b>LHR</b></div></li>' +
        '<li><div aria-label="From 200 euros. Nonstop flight with British Airways."><b>DUB</b><b>LHR</b></div></li>'
    const addresses: string[] = []
    const resource: typeof fetch = async url => {
        addresses.push(String(url))
        if (String(url).includes('/farfnd/')) return Response.json({outbound: {fares: [{day: '2026-12-15',
            soldOut: false, unavailable: false, price: {currencyCode: 'EUR', value: 20}}]}})
        return new Response('', {status: 503})
    }
    const flights = createFlights({fetch: resource, now: () => checked, googlePage: async () => html})
    const first = await flights.search(query)
    assert.equal(first.routeQuotes?.length, 2)
    const calendar = first.calendars?.find(item => item.providerId == 'ryanair')
    assert.equal(calendar?.basis, 'one-adult-one-way')
    assert.equal(calendar?.rows[0].perPerson, 2000)
    assert.ok(addresses.some(url => url.includes('numAdt=1')))
    const cached = await flights.search(query)
    assert.equal(cached.calendars?.find(item => item.providerId == 'ryanair')?.source.status, 'cached')
    assert.equal(cached.routeQuotes?.[0].checkedAt, checked.toISOString())
    const app = createTravelAssistant({today: () => '2026-11-14', model: null, flights,
        catalog: {destinations: [{id: 'hurghada', name: 'Хургада', country: 'Египет', latitude: 0, longitude: 0, sourceIds: []}],
            list: () => {throw new Error('Hotel search is outside this scenario')}}})
    t.after(app.close)
    const reply = await app.chat({message: 'Покажи варианты', context: {kind: 'flights', flight: query}})
    assert.equal(reply.result?.kind, 'flights')
    if (reply.result?.kind == 'flights') assert.equal(reply.result.search?.routeQuotes?.length, 2)
    assert.match(reply.message, /100/)
})

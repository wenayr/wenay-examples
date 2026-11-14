import assert from 'node:assert/strict'
import test from 'node:test'
import {readFlightQuery} from '../backend/flights/index.ts'
import {readDuffelOffers} from '../backend/flights/duffel.ts'

test('matching returns include all adults, baggage and comparable prices before expiry', () => {
    const params = new URLSearchParams({origin: 'tll', destination: 'rix', departure: '2030-05-09',
        returnDate: '2030-05-14', adults: '2', checkedBag: 'true'})
    const query = readFlightQuery(params, '2030-02-01')
    const passenger = {cabin_class: 'economy', fare_basis_code: 'BASIC', baggages: [{type: 'checked', quantity: 1}]}
    function slice(origin: string, destination: string, date: string) {
        return {segments: [{origin: {iata_code: origin}, destination: {iata_code: destination}, departing_at: date + 'T10:00:00',
            arriving_at: date + 'T11:00:00', marketing_carrier: {iata_code: 'BT', name: 'airBaltic'},
            operating_carrier: {name: 'airBaltic'}, marketing_carrier_flight_number: '310',
            passengers: [passenger, passenger]}]}
    }
    const offer = {live_mode: true, total_currency: 'EUR', expires_at: '2030-02-01T12:00:00Z', owner: {name: 'airBaltic'},
        passengers: [{}, {}], slices: [slice('TLL', 'RIX', query.departure), slice('RIX', 'TLL', query.returnDate!)],
        conditions: {change_before_departure: {allowed: false}, refund_before_departure: {allowed: false}}}
    const offers = [100, 200, 240].map((value, i) => ({...offer, id: String(i), total_amount: String(value)}))
    const payload = {data: {live_mode: true, offers: [...offers, {...offers[0], id: 'expired', expires_at: '2020-01-01'},
        {...offers[0], id: 'currency', total_currency: 'USD'}, {...offers[0], id: 'single', slices: offer.slices.slice(0, 1)}]}}
    const result = readDuffelOffers(payload, query, new Date('2030-02-01T10:00:00Z'))
    assert.deepEqual(result.map(v => v.id), ['0', '1', '2'])
    assert.deepEqual(result[0].benchmark, {median: 22000, count: 2, saving: 12000})
    const missingConditions = offers.map(value => ({...value, conditions: {refund_before_departure: {}, change_before_departure: {}}}))
    assert.ok(readDuffelOffers({data: {live_mode: true, offers: missingConditions}}, query, new Date('2030-02-01'))
        .every(value => value.benchmark === null && value.comparisonKey === null))
    passenger.baggages = []
    assert.deepEqual(readDuffelOffers(payload, query, new Date('2030-02-01')), [])
    params.set('returnDate', '2030-05-08')
    assert.throws(() => readFlightQuery(params, '2030-02-01'), RangeError)
})

test('a public price must match the visible airports, direction, dates, adult count and currency', async () => {
    const {readGoogleQuote} = await import('../backend/flights/google.ts')
    const query = {origin: 'AUS', destination: 'MEX', departure: '2026-12-15', returnDate: '2026-12-22', adults: 2, checkedBag: false}
    const html = '<input aria-label="Departure" value="Tue, Dec 15"><input aria-label="Return" value="Tue, Dec 22">' +
        '<div aria-label="Number of adult passengers" aria-valuenow="2"></div><time datetime="2026-12-15"></time><time datetime="2026-12-22"></time>' +
        '<li aria-label="other"><div aria-label="From 900 euros round trip total. Nonstop flight with Other."><b>MEX</b><b>AUS</b></div></li>' +
        '<li><div aria-label="From 1120 euros round trip total. 1 stop flight with United. Leaves Austin."><b>AUS</b><b>MEX</b></div></li>'
    const checked = '2026-11-14T09:00:00Z'
    assert.equal(readGoogleQuote(html, query, checked)?.total, 112000)
    assert.equal(readGoogleQuote(html, {...query, adults: 1}, checked), null)
    assert.equal(readGoogleQuote(html, {...query, returnDate: null}, checked), null)
    assert.equal(readGoogleQuote(html, {...query, departure: '2026-12-16'}, checked), null)
    assert.equal(readGoogleQuote(html.replaceAll('euros', 'dollars'), query, checked), null)
    assert.equal(readGoogleQuote(html, {...query, checkedBag: true}, checked), null)
})

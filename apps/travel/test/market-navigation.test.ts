import assert from 'node:assert/strict'
import {test} from 'node:test'
import {marketContext, marketSearchLink} from '../frontend/market-links.ts'

test('country airport selection preserves the buyer and price context', () => {
    const input = new URLSearchParams({origin: 'TLL', destination: 'LHR', departure: '2027-01-24', returnDate: '2027-01-31',
        adults: '3', currency: 'EUR', bookerCountry: 'EE', nationality: 'UA', checkedBag: 'true', adultAges: '35,32,28'})
    const link = marketSearchLink('JP', 'flights', input, {destination: 'NRT'})
    const actual = new URLSearchParams(link.split('?')[1])
    assert.equal(actual.get('origin'), 'TLL')
    assert.equal(actual.get('destination'), 'NRT')
    assert.equal(actual.get('departure'), '2027-01-24')
    assert.equal(actual.get('returnDate'), '2027-01-31')
    assert.equal(actual.get('adults'), '3')
    assert.equal(actual.get('currency'), 'EUR')
    assert.equal(actual.get('bookerCountry'), 'EE')
    assert.equal(actual.get('nationality'), 'UA')
    assert.equal(actual.get('checkedBag'), 'true')
    assert.equal(actual.get('country'), '')
    assert.equal(actual.get('adultAges'), '35,32,28')
})

test('a hotel city receives its destination country without changing buyer citizenship or currency', () => {
    const input = new URLSearchParams({checkIn: '2027-02-10', checkOut: '2027-02-17', adults: '2', currency: 'GBP',
        bookerCountry: 'GB', nationality: 'UZ', country: 'FR', offset: '30', providerRefs: '{"other":{"hotelIds":["wrong"]}}'})
    const context = marketContext(input)
    assert.equal(context.offset, undefined)
    assert.equal(context.providerRefs, undefined)
    const link = marketSearchLink('JP', 'hotels', new URLSearchParams(context), {destination: 'Tokyo', latitude: 35.68, longitude: 139.76})
    const actual = new URLSearchParams(link.split('?')[1])
    assert.equal(actual.get('country'), 'JP')
    assert.equal(actual.get('destination'), 'Tokyo')
    assert.equal(actual.get('checkIn'), '2027-02-10')
    assert.equal(actual.get('checkOut'), '2027-02-17')
    assert.equal(actual.get('adults'), '2')
    assert.equal(actual.get('currency'), 'GBP')
    assert.equal(actual.get('bookerCountry'), 'GB')
    assert.equal(actual.get('nationality'), 'UZ')
    assert.equal(actual.get('latitude'), '35.68')
    assert.equal(actual.get('longitude'), '139.76')
})

test('flight and hotel dates keep the full trip duration when switching products', () => {
    const flight = new URLSearchParams({kind: 'flights', origin: 'TLL', destination: 'LHR', departure: '2027-01-15',
        returnDate: '2027-01-25', checkIn: '2027-01-14', checkOut: '2027-01-21', adults: '3', checkedBag: 'true'})
    const hotelLink = marketSearchLink('JP', 'hotels', flight, {destination: 'Tokyo'})
    const hotel = new URLSearchParams(hotelLink.split('?')[1])
    assert.equal(hotel.get('checkIn'), '2027-01-15')
    assert.equal(hotel.get('checkOut'), '2027-01-25')
    assert.equal(hotel.get('origin'), 'TLL')
    const back = new URLSearchParams(marketSearchLink('JP', 'flights', hotel, {destination: 'NRT'}).split('?')[1])
    assert.equal(back.get('departure'), '2027-01-15')
    assert.equal(back.get('returnDate'), '2027-01-25')
    assert.equal(back.get('adults'), '3')
    assert.equal(back.get('origin'), 'TLL')
    assert.equal(back.get('checkedBag'), 'true')
})

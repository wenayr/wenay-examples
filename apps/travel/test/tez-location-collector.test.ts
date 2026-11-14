import test from 'node:test'
import assert from 'node:assert/strict'
import {readTezLocation} from '../scripts/collect-tez-locations.ts'

const hotel = {id: 1061, name: 'SAND BEACH 3 *'}
const checkedAt = '2026-11-14T04:00:00Z'
const page = 'HOTEL_ID = 1061; GEO_LOCATION_LATITUDE = 27.26083928002099; GEO_LOCATION_LONGITUDE = 33.821086618060235;'

test('Hotel location uses the exact supplier identity and rejects missing markers, another property and unrelated coordinates', () => {
    const result = readTezLocation(page, hotel, 'hurghada', checkedAt)
    assert.equal(result.location?.latitude, 27.26083928002099)
    assert.equal(result.location?.longitude, 33.821086618060235)
    assert.equal(result.location?.source, 'https://www.tez-tour.com/hotel.html?id=1061')
    assert.equal(result.location?.checkedAt, checkedAt)
    assert.equal(readTezLocation(page, {...hotel, id: 609}, 'hurghada', checkedAt).unresolved?.reason, 'hotel-identity-mismatch')
    assert.equal(readTezLocation('HOTEL_ID = 1061', hotel, 'hurghada', checkedAt).unresolved?.reason, 'coordinate-not-published')
    const unrelated = page.replace('27.26083928002099', '52.52').replace('33.821086618060235', '13.405')
    assert.equal(readTezLocation(unrelated, hotel, 'hurghada', checkedAt).unresolved?.reason, 'coordinate-outside-destination')
})

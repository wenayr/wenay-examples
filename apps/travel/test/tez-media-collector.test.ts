import test from 'node:test'
import assert from 'node:assert/strict'
import {readTezGallery} from '../scripts/collect-tez-media.ts'

const hotel = {id: 1061, name: 'SAND BEACH 3 *'}
const page = 'HOTEL_ID = 1061; SITE_HOTEL_ID = 1491;'
const payload = {success: true, mainSiteGallery: {folder: 'hotel/1491', name: 'Pool.JPG'}, siteGalleries: [
    {folder: 'hotel/1491', name: 'Pool.JPG'}, {folder: 'hotel/1491', name: 'Room 2.jpg'},
]}

test('Supplier gallery is tied to exact hotel and site identities and deduplicates published images', () => {
    const result = readTezGallery(page, payload, hotel)
    assert.equal(result.identity?.siteHotelId, 1491)
    assert.deepEqual(result.photos.map(photo => photo.url), [
        'https://s.tez-tour.com/hotel/1491/Pool_middle.JPG',
        'https://s.tez-tour.com/hotel/1491/Room%202_middle.jpg',
    ])
    assert.equal(result.photos[0].source, 'https://www.tez-tour.com/hotel.html?id=1061')
    assert.equal(readTezGallery(page, payload, {...hotel, id: 609}).reason, 'hotel-identity-mismatch')
})

test('Gallery rejects another property folder and traversal names instead of attaching unrelated images', () => {
    const unrelated = {success: true, siteGalleries: [
        {folder: 'hotel/9999', name: 'Pool.jpg'}, {folder: 'hotel/1491', name: '../Pool.jpg'},
        {folder: 'hotel/1491', name: 'other%2f..%2fPool.jpg'},
        {folder: 'https://outside.example/hotel/1491', name: 'Pool.jpg'},
    ]}
    assert.deepEqual(readTezGallery(page, unrelated, hotel).photos, [])
    assert.equal(readTezGallery(page, {success: false}, hotel).reason, 'gallery-unavailable')
})

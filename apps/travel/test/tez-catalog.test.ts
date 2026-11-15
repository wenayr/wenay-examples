import assert from 'node:assert/strict'
import {test} from 'node:test'
import {tezKnownHotels} from '../backend/partners/tez-catalog.ts'
import {tezHotelGallery} from '../backend/partners/tez-media.ts'

test('known TEZ properties retain verified metadata and exact supplier media without inventing trip prices', () => {
    const hotels = tezKnownHotels('hurghada')
    assert.equal(hotels.length, 62)
    assert.equal(new Set(hotels.map(hotel => hotel.id)).size, 62)
    assert.ok(tezKnownHotels('sharm').length >= 50)
    assert.ok(tezKnownHotels('rhodes').length >= 20)
    assert.equal(tezKnownHotels('absent').length, 0)
    const regional = ['hurghada', 'sharm', 'rhodes'].flatMap(destination => tezKnownHotels(destination))
    assert.equal(new Set(regional.map(hotel => hotel.id)).size, regional.length)
    for (const hotel of regional) {
        const gallery = tezHotelGallery(hotel.id)
        assert.match(hotel.id, /^tez:[1-9]\d*$/)
        assert.ok(hotel.name)
        assert.equal(hotel.url, 'https://www.tez-tour.com/hotel.html?id=' + hotel.id.slice(4))
        assert.equal(hotel.url, gallery?.hotelUrl)
        assert.equal(hotel.name, gallery?.name)
        assert.ok(Number.isFinite(hotel.latitude) && Number.isFinite(hotel.longitude))
        assert.ok(hotel.coordinateSource?.url)
        assert.equal(hotel.coordinateSource?.checkedOn, hotel.destinationId == 'hurghada' ? '2026-11-14' : '2026-11-15')
        assert.equal(hotel.photos?.length, 5)
        assert.ok(hotel.photos?.every(photo => photo.sourceUrl == hotel.url))
        assert.ok(hotel.photos?.every(photo => gallery?.photos.some(source => source.url == photo.url)))
        assert.ok(hotel.photo?.url && gallery?.photos.some(photo => photo.url == hotel.photo?.url))
        assert.ok(['price', 'total', 'minTotal', 'maxTotal', 'best'].every(key => !Object.hasOwn(hotel, key)))
    }
    const sand = hotels.find(hotel => hotel.id == 'tez:1061')!
    assert.equal(sand.stars, 3)
    assert.ok(sand.photos?.every(photo => photo.url.startsWith('https://s.tez-tour.com/hotel/1491/')))
    const desert = hotels.find(hotel => hotel.id == 'tez:511')!
    assert.ok(desert.photos?.every(photo => photo.url.startsWith('https://s.tez-tour.com/hotel/2075/')))
    const azalea = hotels.find(hotel => hotel.id == 'tez:10594885')!
    assert.equal(azalea.latitude, 27.3048772)
    assert.equal(azalea.longitude, 33.7273514)
    assert.ok(azalea.coordinateSource?.evidence?.length)
    const posh = hotels.find(hotel => hotel.id == 'tez:10234721')!
    assert.equal(posh.coordinateSource?.precision, 'hotel-complex')
})

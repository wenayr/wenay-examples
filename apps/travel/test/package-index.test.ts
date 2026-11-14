import assert from 'node:assert/strict'
import test from 'node:test'
import {createOfferIndex, type PackageQuery} from '../backend/package-index.ts'

test('a second fare can qualify for the map while the calendar retains the cheapest observed fare and empty dates', () => {
    const departure = '2027-01-19'
    const hotel = {id: 'bay', name: 'Palm Bay', stars: 4, latitude: 27.2, longitude: 33.8, url: 'https://example.com/bay'}
    const outside = {...hotel, id: 'outside', longitude: 34.1}
    const offers = [149000, 188000, 210000, 213000].map(total => ({id: String(total), hotelId: hotel.id, departure, total}))
    const index = createOfferIndex({hotels: [hotel, outside], offers: [...offers, {...offers[1], hotelId: outside.id}]})
    const query = {
        firstDeparture: departure, lastDeparture: '2027-01-20', minTotal: 188000, maxTotal: 210000,
        box: [33.7, 27.1, 33.9, 27.3], minStars: 4, offset: 0, limit: 1
    } satisfies PackageQuery

    const {items, markers, nextOffset, total} = index.search(query)
    assert.deepEqual(items.map(item => [item.hotelId, item.best.total, item.maxTotal]), [['bay', 188000, 210000]])
    assert.deepEqual(markers.map(marker => [marker.hotelId, marker.minTotal, marker.maxTotal]), [['bay', 188000, 210000]])
    assert.equal(nextOffset, null)
    assert.equal(total, 1)
    const [quoted, empty] = index.calendar(query, hotel.id)
    assert.deepEqual([quoted.lowest?.total, quoted.inBudget?.total, quoted.highest?.total], [149000, 188000, 213000])
    assert.deepEqual(empty, {departure: '2027-01-20', lowest: null, inBudget: null, highest: null})
})

test('overlapping range boundaries and equal prices keep stable fares across both search directions', () => {
    const hotel = (id: string, latitude: number, longitude: number) => ({id, name: id, latitude, longitude, stars: 4, url: ''})
    const hotels = [hotel('a', 1, 1), hotel('b', 1, 2), hotel('c', 2, 2), hotel('d', 3, 1)]
    const days = ['2030-01-01', '2030-01-02', '2030-01-03', '2030-01-04']
    const offers = hotels.flatMap((h, i) => days.flatMap((departure, d) => [150 + i + d, 300, 300].map((total, n) => ({
        id: [h.id, d, n].join(':'), hotelId: h.id, departure, total
    }))))
    const index = createOfferIndex({hotels, offers})
    const query: PackageQuery = {firstDeparture: days[1], lastDeparture: days[2], minTotal: 300, maxTotal: 300,
        box: [1, 1, 2, 2], minStars: 3, offset: 0, limit: 4}
    assert.deepEqual(index.search(query).items.map(i => i.best.id), ['a:1:1', 'b:1:1', 'c:1:1'])
    assert.deepEqual(index.search({...query, minTotal: 154, maxTotal: 154}).items.map(i => i.best.id), ['c:2:0'])
    assert.deepEqual(index.search({...query, firstDeparture: days[3], lastDeparture: days[3], box: [2, 1, 2, 1]})
        .items.map(i => i.best.id), ['b:3:1'])
    assert.equal(index.search({...query, firstDeparture: '2031-01-01', lastDeparture: '2031-01-22'}).total, 0)
})

test('one departure compares selected properties by ID and separates price gaps from unavailable dates', async () => {
    const {createPackages} = await import('../backend/packages.ts')
    const {createTezInventory} = await import('../backend/partners/tez-inventory.ts')
    const trip = {destinationId: 'hurghada', first: '2030-01-19', last: '2030-01-22', adults: 2, nights: 7, minTotal: 145000, maxTotal: 160000}
    const filter: PackageQuery = {firstDeparture: trip.first, lastDeparture: trip.last, minStars: 3, box: null,
        minTotal: trip.minTotal, maxTotal: trip.maxTotal, offset: 0, limit: 12}
    const requests: string[] = []
    const provider = createTezInventory({now: () => new Date('2030-01-01'), fetch: async url => {
        const params = new URL(String(url)).searchParams
        const id = params.get('hotelId')!
        const day = params.get('after')!
        requests.push(id + '/' + day)
        assert.ok(id && !params.has('groupByHotel'))
        assert.equal(params.get('before'), day)
        assert.equal(params.get('nightsMin'), '7')
        assert.equal(params.get('priceMin'), '0')
        const amounts = id == '1061' && day == '19.01.2030' ? [1410, 1530] : id == '609' ? [1400] : []
        const data = amounts.map(total => [day, [], '', 7, '', ['', '', 5734], ['', 'TEST 4 *', '', Number(id)],
            ['HB'], [], [[2, 0, 0]], {currency: 'EUR', total}])
        return Response.json({success: true, data, departureCityId: 3746, info: [['More results', 'false']]})
    }})
    const service = createPackages(provider)
    const comparison = await service.compare(trip, filter, ['tez:1061', 'tez:609', 'tez:9999999'], trip.first)
    const [match, expensive, unknown] = comparison.items
    assert.deepEqual([match.status, match.day.lowest?.total, match.day.inBudget?.total], ['in-budget', 141000, 153000])
    assert.deepEqual([expensive.status, expensive.day.inBudget], ['outside-budget', null])
    assert.deepEqual([unknown.status, unknown.day.status], ['unknown', 'unknown'])
    const noQuotes = await service.compare(trip, filter, ['tez:1061'], '2030-01-20')
    assert.equal(noQuotes.items[0].status, 'empty')
    const hidden = await service.compare(trip, {...filter, box: [0, 0, 1, 1]}, ['tez:1061'], trip.first)
    assert.deepEqual([hidden.items[0].status, hidden.items[0].day.lowest], ['filtered', null])
    assert.equal(requests.length, 4)
    const rechecked = await service.recheck(trip, filter, 'tez:1061', trip.first, match.day.inBudget!.id)
    assert.equal(rechecked.status, 'confirmed')
    assert.equal(rechecked.fare?.total, 153000)
    assert.equal(requests.length, 5)
    const disappeared = await service.recheck(trip, filter, 'tez:1061', trip.first, 'missing-fare')
    assert.equal(disappeared.status, 'unavailable')
    await assert.rejects(service.compare(trip, filter, ['tez:1061'], '2030-01-23'), RangeError)
})

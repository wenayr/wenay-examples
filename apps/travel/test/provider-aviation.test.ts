import assert from 'node:assert/strict'
import test from 'node:test'
import type {ProviderDeps, ProviderQuery} from '../src/provider-contract.ts'
import skyscanner, {readSkyscanner} from '../backend/providers/aviation/skyscanner.ts'
import travelpayouts, {readTravelpayouts} from '../backend/providers/aviation/travelpayouts.ts'
import lufthansa, {readLufthansa} from '../backend/providers/aviation/lufthansa.ts'
import sabre, {readSabre, sabreRequest} from '../backend/providers/aviation/sabre.ts'
import travelport, {readTravelport, travelportRequest} from '../backend/providers/aviation/travelport.ts'

const query = {kind: 'flights', origin: 'FRA', destination: 'CAI', departure: '2030-01-15', returnDate: '2030-01-22',
    adults: 1, currency: 'EUR'} satisfies ProviderQuery
const checkedAt = '2029-12-01T10:00:00Z'

function skyPayload() {
    const departureDateTime = {year: 2030, month: 1, day: 15, hour: 10, minute: 15}
    const back = {...departureDateTime, day: 22}
    return {status: 'RESULT_STATUS_COMPLETE', content: {results: {
        itineraries: {itinerary: {legIds: ['out', 'back'], pricingOptions: [{id: 'seller', price: {amount: '123450000', unit: 'PRICE_UNIT_MICRO'},
            transferType: 'TRANSFER_TYPE_MANAGED', items: [{deepLink: 'https://seller.example/flight'}]}]}},
        legs: {out: {originPlaceId: 'fra', destinationPlaceId: 'cai', departureDateTime, marketingCarrierIds: ['MS'], stopCount: 0, durationInMinutes: 245},
            back: {originPlaceId: 'cai', destinationPlaceId: 'fra', departureDateTime: back}},
        places: {fra: {iata: 'FRA'}, cai: {iata: 'CAI'}}, carriers: {MS: {name: 'Egyptair'}}
    }}}
}

test('Skyscanner create/poll preserves party query and normalizes price units, route and unknown baggage', async () => {
    const payload = skyPayload()
    const rows = readSkyscanner(payload, {...query, adults: 2}, checkedAt)
    assert.equal(rows[0].price.amount, 123.45)
    assert.equal(rows[0].price.basis, 'party')
    assert.equal(rows[0].adults, 2)
    assert.equal(rows[0].includes.checkedBags, null)
    assert.deepEqual(readSkyscanner(payload, {...query, destination: 'HRG'}, checkedAt), [])
    assert.deepEqual(readSkyscanner(payload, {...query, checkedBag: true}, checkedAt), [])
    const requests: {url: string, body: unknown}[] = []
    async function fetching(input: string | URL | Request, init?: RequestInit) {
        requests.push({url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null})
        if (requests.length == 1) return Response.json({...payload, status: 'RESULT_STATUS_INCOMPLETE', sessionToken: 'session'})
        return Response.json(payload)
    }
    const result = await skyscanner.search({...query, adults: 2}, {fetch: fetching as typeof fetch,
        now: () => new Date(checkedAt), env: {SKYSCANNER_API_KEY: 'configured-secret'}})
    assert.equal(result.status, 'live')
    assert.equal(result.offers.length, 1)
    assert.equal(requests.length, 2)
    assert.equal((requests[0].body as {query: {adults: number}}).query.adults, 2)
    assert.match(requests[1].url, /poll\/session$/)
})

test('Aviasales cache cannot become a group price or match a different airport', async () => {
    const payload = {success: true, currency: 'eur', data: [{origin_airport: 'FRA', destination_airport: 'CAI', price: 110,
        departure_at: '2030-01-15T10:00:00+01:00', return_at: '2030-01-22T10:00:00+02:00', airline: 'MS',
        transfers: 0, duration_to: 240, link: '/search/FRA1501CAI22011?expected_price_currency=eur'}]}
    const rows = readTravelpayouts(payload, query, checkedAt)
    assert.equal(rows[0].accuracy, 'cached-indicative')
    assert.equal(rows[0].price.basis, 'person')
    assert.deepEqual(readTravelpayouts(payload, {...query, adults: 2}, checkedAt), [])
    assert.deepEqual(readTravelpayouts(payload, {...query, destination: 'HRG'}, checkedAt), [])
    assert.deepEqual(readTravelpayouts({...payload, currency: 'usd'}, query, checkedAt), [])
    const deps = {fetch: async () => Response.json(payload), now: () => new Date(checkedAt), env: {TRAVELPAYOUTS_TOKEN: 'configured'}}
    assert.equal((await travelpayouts.search(query, deps as ProviderDeps)).status, 'cached')
})

function lufthansaPayload() {
    function segment(id: string, origin: string, destination: string, date: string) {
        return {'@SegmentKey': id, Departure: {AirportCode: origin, Date: date, Time: '10:00'}, Arrival: {AirportCode: destination, Date: date, Time: '14:00'}}
    }
    return {LowestFaresResponse: {AirShoppingRS: {
        OffersGroup: {AirlineOffers: {Owner: 'LH', AirlineOffer: {OfferID: {'@Owner': 'LH', $: 'fare'},
            TotalPrice: {DetailCurrencyPrice: {Total: {'@Code': 'EUR', $: '150.90'}, Taxes: {Total: {'@Code': 'EUR', $: '40'}}}},
            PricedOffer: {Associations: {ApplicableFlight: {FlightSegmentReference: [{'@ref': 'out'}, {'@ref': 'back'}]},
                OtherAssociation: {OtherAssociation: {Type: 'deep link', ReferenceValue: 'https://www.lufthansa.com/booking'}}}}}}},
        DataLists: {AnonymousTravelerList: {AnonymousTraveler: {PTC: {'@Quantity': '1', $: 'ADT'}}},
            FlightSegmentList: {FlightSegment: [segment('out', 'FRA', 'CAI', '2030-01-15'), segment('back', 'CAI', 'FRA', '2030-01-22')]}}
    }}}
}

test('Lufthansa validates singleton JSON attributes, return segments, passenger count and native currency', async () => {
    const payload = lufthansaPayload()
    const rows = readLufthansa(payload, query, checkedAt)
    assert.equal(rows[0].price.amount, 150.9)
    assert.equal(rows[0].price.basis, 'person')
    assert.deepEqual(readLufthansa(payload, {...query, adults: 2}, checkedAt), [])
    assert.deepEqual(readLufthansa(payload, {...query, returnDate: null}, checkedAt), [])
    assert.deepEqual(readLufthansa(payload, {...query, currency: 'USD'}, checkedAt), [])
    const calls: string[] = []
    async function fetching(input: string | URL | Request) {
        calls.push(String(input))
        return Response.json(calls.length == 1 ? {access_token: 'partner-token', expires_in: 3600} : payload)
    }
    const deps = {fetch: fetching as typeof fetch, now: () => new Date(checkedAt),
        env: {LUFTHANSA_CLIENT_ID: 'client', LUFTHANSA_CLIENT_SECRET: 'secret'}}
    assert.equal((await lufthansa.search(query, deps)).offers.length, 1)
    assert.match(calls[0], /partners\/oauth\/token$/)
    assert.match(calls[1], /lowestfares\?origin=FRA/)
})

test('missing access and rejected credentials never fabricate a price', async () => {
    const deps = {fetch: async () => new Response('', {status: 403}), now: () => new Date(checkedAt), env: {}} as ProviderDeps
    const missing = await Promise.all([skyscanner.search(query, deps), travelpayouts.search(query, deps), lufthansa.search(query, deps)])
    assert.ok(missing.every(result => result.status == 'requires-access' && !result.offers.length))
    const rejected = await skyscanner.search(query, {...deps, env: {SKYSCANNER_API_KEY: 'invalid'}})
    assert.equal(rejected.status, 'requires-access')
    assert.deepEqual(rejected.offers, [])
})

test('Sabre GIR references preserve round-trip group amount and exclude another date or traveller count', async () => {
    const payload = {groupedItineraryResponse: {
        scheduleDescs: [{id: 1, stopCount: 0, departure: {airport: 'FRA'}, arrival: {airport: 'CAI'}, carrier: {marketing: 'MS'}},
            {id: 2, stopCount: 0, departure: {airport: 'CAI'}, arrival: {airport: 'FRA'}, carrier: {marketing: 'MS'}}],
        legDescs: [{id: 1, elapsedTime: 245, schedules: [{ref: 1}]}, {id: 2, elapsedTime: 260, schedules: [{ref: 2}]}],
        itineraryGroups: [{groupDescription: {legDescriptions: [
            {departureDate: query.departure, departureLocation: 'FRA', arrivalLocation: 'CAI'},
            {departureDate: query.returnDate, departureLocation: 'CAI', arrivalLocation: 'FRA'}]},
        itineraries: [{id: 1, legs: [{ref: 1}, {ref: 2}], pricingInformation: [{offer: {offerId: 'offer-1', timeToLive: 1200},
            fare: {totalFare: {totalPrice: 450, totalTaxAmount: 90, currency: 'EUR'},
                passengerInfoList: [{passengerInfo: {passengerType: 'ADT', passengerNumber: 2}}]}}]}]}]
    }}
    const party = {...query, adults: 2}
    const result = readSabre(payload, party, checkedAt)
    assert.equal(result[0].price.amount, 450)
    assert.equal(result[0].price.basis, 'party')
    assert.equal(result[0].expiresAt, '2029-12-01T10:20:00.000Z')
    assert.deepEqual(readSabre(payload, query, checkedAt), [])
    assert.deepEqual(readSabre(payload, {...party, departure: '2030-01-16'}, checkedAt), [])
    assert.equal(sabreRequest(party, 'PCC').OTA_AirLowFareSearchRQ.TravelerInfoSummary.AirTravelerAvail[0].PassengerTypeQuantity[0].Quantity, 2)
    const deps = {fetch: async () => Response.json(payload), now: () => new Date(checkedAt),
        env: {SABRE_ACCESS_TOKEN: 'token', SABRE_PCC: 'PCC'}} as ProviderDeps
    assert.equal((await sabre.search(party, deps)).offers.length, 1)
})

test('Travelport uses full itinerary BestCombinablePrice once and requires a matching return combination', async () => {
    function offering(id: string, product: string, code: string) {
        return {id, ProductBrandOptions: [{ProductBrandOffering: [{Product: [{productRef: product}], CombinabilityCode: [code],
            Brand: {BrandRef: 'b0'}, Price: {TotalPrice: 10}, BestCombinablePrice: {TotalPrice: 600, TotalTaxes: 100,
                CurrencyCode: {value: 'EUR'}, PriceBreakdown: [{quantity: 2, requestedPassengerType: 'ADT'}]}}]}]}
    }
    function product(id: string, flight: string) {
        return {id, totalDuration: 'PT4H15M', FlightSegment: [{sequence: 1, Flight: {FlightRef: flight}}],
            PassengerFlight: [{passengerTypeCode: 'ADT', passengerQuantity: 2, FlightProduct: [{cabin: 'Economy'}]}]}
    }
    const out = offering('o1', 'p1', 'j1'), back = offering('o2', 'p2', 'j1')
    const payload = {CatalogProductOfferingsResponse: {CatalogProductOfferings: {CatalogProductOffering: [out, back]}, ReferenceList: [
        {'@type': 'ReferenceListFlight', Flight: [
            {id: 's1', carrier: 'LH', Departure: {location: 'FRA', date: query.departure}, Arrival: {location: 'CAI'}},
            {id: 's2', carrier: 'LH', Departure: {location: 'CAI', date: query.returnDate}, Arrival: {location: 'FRA'}}]},
        {'@type': 'ReferenceListProduct', Product: [product('p1', 's1'), product('p2', 's2')]}
    ]}}
    const party = {...query, adults: 2}
    const result = readTravelport(payload, party, checkedAt)
    assert.equal(result.length, 1)
    assert.equal(result[0].price.amount, 600)
    assert.equal(result[0].flight?.durationMinutes, 255)
    back.ProductBrandOptions[0].ProductBrandOffering[0].CombinabilityCode = ['j2']
    assert.deepEqual(readTravelport(payload, party, checkedAt), [])
    const request = travelportRequest(party).CatalogProductOfferingsQueryRequest.CatalogProductOfferingsRequest
    assert.equal(request.PassengerCriteria[0].number, 2)
    assert.equal(request.SearchCriteriaFlight.length, 2)
    const deps = {fetch: async () => Response.json(payload), now: () => new Date(checkedAt), env: {}} as ProviderDeps
    assert.equal((await travelport.search(party, deps)).status, 'requires-access')
})

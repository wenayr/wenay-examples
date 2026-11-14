import {createMcpFacadeServer, describeMethod, type McpToolContext} from 'wenay-common2/server/mcp'
import type {IncomingMessage, ServerResponse} from 'node:http'
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {searchPhrase, type createPlaceCatalog} from './catalog.ts'
import type {createPackages} from './packages.ts'
import {packageDestinations, packageMaxTotal} from '../src/package-contract.ts'
import type {FlightQuery, FlightSearch} from '../src/flight-contract.ts'
import type {TravelChatQuery, TravelChatResult} from '../src/assistant-contract.ts'
import {packageQuery} from './travel-query.ts'
import {readFlightQuery} from './flights/index.ts'
import {findAirports} from './flights/airports.ts'
import type {createProviderRegistry} from './providers/index.ts'
import {readProviderQuery} from './providers/query.ts'
import type {ProviderQuery} from '../src/provider-contract.ts'

export interface AssistantDeps {
    catalog: Pick<ReturnType<typeof createPlaceCatalog>, 'list' | 'destinations'>
    packages?: Pick<ReturnType<typeof createPackages>, 'calendar' | 'search'>
    flights?: {search: (query: FlightQuery) => Promise<FlightSearch>}
    providers?: Pick<ReturnType<typeof createProviderRegistry>, 'list' | 'search'> &
        Partial<Pick<ReturnType<typeof createProviderRegistry>, 'markets'>>
    today?: () => string
    model?: {key: string, name: string, fetch: typeof fetch} | null
}
export const dateSchema = {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'}
export const integer = (min: number, max: number) => ({type: 'integer', minimum: min, maximum: max})
export const queryProperties = {
    destination: {type: 'string', minLength: 1, maxLength: 40}, firstDeparture: dateSchema, lastDeparture: dateSchema,
    nights: integer(1, 30), adults: integer(1, 8), minTotal: integer(0, packageMaxTotal), maxTotal: integer(0, packageMaxTotal), minStars: integer(0, 5),
}
export const flightProperties = {
    origin: {type: 'string', pattern: '^[A-Z]{3}$'}, destination: {type: 'string', pattern: '^[A-Z]{3}$'}, departure: dateSchema,
    returnDate: {anyOf: [dateSchema, {type: 'null'}]}, adults: integer(1, 9), checkedBag: {type: 'boolean'},
}
export function travelParams(input: Partial<TravelChatQuery> | Partial<FlightQuery>) {
    const entries = Object.entries(input).filter(([, value]) => value != null && typeof value !== 'object')
    return new URLSearchParams(entries.map(([key, value]) => [key, String(value)]))
}
function schema(properties: Record<string, object>, required: string[]) {return {type: 'object', properties, required, additionalProperties: false}}
function readOnly(description: string, input: object) {return {description, input, annotations: {readOnlyHint: true}}}

export function createAssistantTools(deps: AssistantDeps) {
    const today = () => deps.today?.() ?? new Date().toISOString().slice(0, 10)
    const packageFields = {...queryProperties, destination: {type: 'string', enum: [...packageDestinations]}}
    const required = ['destination', 'firstDeparture', 'lastDeparture']
    function selection(query: TravelChatQuery) {
        const params = travelParams(query)
        params.set('limit', '5')
        return packageQuery(params, query.destination, today())
    }
    const search_packages = describeMethod(async (query: TravelChatQuery): Promise<TravelChatResult> => {
        if (!deps.packages) throw new Error('Пакетный поиск сейчас недоступен.')
        const {trip, filter} = selection(query)
        const {items, total, source} = await deps.packages.search(trip, filter)
        return {kind: 'packages', items, total, source}
    }, readOnly('Find up to five matching Tallinn packages. minTotal and maxTotal are whole-party EUR cents. Adults must equal 2.', schema(packageFields, required)))
    const hotel_calendar = describeMethod(async (query: TravelChatQuery & {hotelId: string}, ctx: McpToolContext) => {
        if (!deps.packages) throw new Error('Пакетный поиск сейчас недоступен.')
        const {trip, filter} = selection(query)
        const calendar = await deps.packages.calendar(trip, filter, query.hotelId, ctx.signal)
        if (!calendar) throw new RangeError('Отель отсутствует в выбранном окне вылета.')
        return calendar
    }, {...readOnly('Read daily quoted, empty and unconfirmed package departures for one TEZ hotel.',
        schema({...packageFields, hotelId: {type: 'string', pattern: '^tez:[1-9][0-9]{0,14}$'}}, [...required, 'hotelId'])), context: true})
    const search_hotels = describeMethod((query: {destination: string, phrase?: string}): TravelChatResult => {
        const destination = deps.catalog.destinations.find(place => place.id === query.destination)
        if (!destination) throw new RangeError('Неизвестное направление.')
        const page = deps.catalog.list({destination, q: searchPhrase(query.phrase ?? ''), source: null, box: null, offset: 0, limit: 5})
        return {kind: 'catalog', total: page.total, items: page.items.map(({id, name, locality}) => ({id, name, locality}))}
    }, readOnly('Find up to five hotels in the local directory; it has no bookable prices. Optional phrase matches hotel names.',
        schema({destination: {type: 'string', enum: deps.catalog.destinations.map(p => p.id)}, phrase: {type: 'string', maxLength: 120}}, ['destination'])))
    const list_destinations = describeMethod(() => ({destinations: deps.catalog.destinations.map(({id, name, country}) =>
        ({id, name, country, packages: packageDestinations.some(p => p === id)}))}),
        readOnly('List directory destinations and package search availability.', schema({}, [])))
    const find_airports = describeMethod(({query}: {query: string}) => ({airports: findAirports(query)}),
        readOnly('Look up airport IATA codes by name, city, region or country. Ask the traveler to choose among multiple airports.',
            schema({query: {type: 'string', minLength: 1, maxLength: 100}}, ['query'])))
    const search_flights = describeMethod(async (input: FlightQuery) => {
        if (!deps.flights) throw new Error('Поиск авиабилетов сейчас недоступен.')
        const query = readFlightQuery(travelParams(input), today())
        return deps.flights.search(query)
    }, readOnly('Search any route by airport IATA codes. Published routeQuotes are estimates for the whole party, with source and unknown baggage explicit. ' +
        'Only comparison groups contain identical flights with matching known conditions. Calendars are one adult one way. Recheck before purchase.',
        schema(flightProperties, ['origin', 'destination', 'departure'])))
    const list_providers = describeMethod(() => {
        if (!deps.providers) throw new Error('Реестр источников недоступен.')
        return deps.providers.list()
    }, readOnly('List independent executable flight, hotel and package providers, their capabilities, activation and current status. No secret values are returned.', schema({}, [])))
    const list_markets = describeMethod(({country}: {country?: string}) => {
        if (!deps.providers?.markets) throw new Error('Каталог рынков недоступен.')
        const catalog = deps.providers.markets(country)
        const items = catalog.items.map(item => {
            const summary = {code: item.code, name: item.name, currency: item.currency, region: item.region, summary: item.summary,
                aviationStatus: item.aviationStatus, commercialStatus: item.commercialStatus,
                airlineCount: item.airlines.length, tourismPartnerCount: item.tourism.length, notices: item.notices}
            if (!country) return summary
            return {...summary, hubs: item.hubs, cities: item.cities, airlines: item.airlines, tourism: item.tourism,
                providers: item.providers.map(source => ({providerId: source.providerId, status: source.status,
                    configured: source.configured, coverage: source.coverage, coverageDescription: source.coverageDescription,
                    evidence: source.evidence}))}
        })
        return {...catalog, items}
    }, readOnly('Read the selected 20 Eurasian country markets, airlines, tourism partners and actual provider access and query checks. ' +
        'Informational companies are distinct from price adapters. Destination, point of sale and nationality are independent.',
        schema({country: {type: 'string', pattern: '^[A-Z]{2}$'}}, [])))
    const providerProperties = {
        kind: {type: 'string', enum: ['flights', 'hotels', 'packages', 'deals']},
        origin: {type: 'string', maxLength: 120}, destination: {type: 'string', maxLength: 120},
        departure: dateSchema, returnDate: {anyOf: [dateSchema, {type: 'null'}]}, checkIn: dateSchema, checkOut: dateSchema,
        adults: integer(1, 9), rooms: integer(1, 9), nights: integer(1, 30), checkedBag: {type: 'boolean'}, currency: {type: 'string', pattern: '^[A-Z]{3}$'},
        latitude: {type: 'number', minimum: -90, maximum: 90}, longitude: {type: 'number', minimum: -180, maximum: 180},
        radiusKm: {type: 'number', exclusiveMinimum: 0},
        nationality: {type: 'string', pattern: '^[A-Z]{2}$'}, bookerCountry: {type: 'string', pattern: '^[A-Z]{2}$'},
        country: {type: 'string', pattern: '^[A-Z]{2}$'}, adultAges: {type: 'array', items: integer(18, 120), maxItems: 9},
        providers: {type: 'array', items: {type: 'string', maxLength: 60}, maxItems: 40},
        providerRefs: {type: 'object', additionalProperties: {type: 'object', properties: {
            hotelIds: {type: 'array', maxItems: 100, items: {type: 'string', maxLength: 120}}, destinationId: {type: 'string', maxLength: 120}
        }, additionalProperties: false}}, limit: integer(1, 100), offset: integer(0, Number.MAX_SAFE_INTEGER),
    }
    const search_travel_offers = describeMethod(async (input: ProviderQuery) => {
        if (!deps.providers) throw new Error('Поиск по источникам недоступен.')
        return deps.providers.search(readProviderQuery(input, today()))
    }, readOnly('Search independently configured flight, hotel, package and proven-deal providers. Prices remain in original currency and basis. ' +
        'Hotel provider IDs are unrelated to open-directory IDs. Missing access or query fields are explicit. Sandbox prices are excluded.',
        schema(providerProperties, ['kind'])))
    const facade = createMcpFacadeServer({name: 'wenay-travel', version: '1.0.0', strict: true, readOnly: true,
        object: {list_destinations, search_hotels, search_packages, hotel_calendar, find_airports, search_flights,
            list_providers, list_markets, search_travel_offers},
        resources: false, policy: {concurrency: () => 'parallel'}})
    async function mcp(req: IncomingMessage, res: ServerResponse, body: unknown) {
        const server = facade.control.server()
        const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true})
        res.once('close', () => {void server.close()})
        try {
            await server.connect(transport)
            await transport.handleRequest(req, res, body)
        } catch (error) {
            await server.close()
            throw error
        }
    }
    async function run(name: 'search_hotels' | 'search_packages', input: Record<string, unknown>, signal?: AbortSignal) {
        const result = await facade.tools.call(name, input, signal ? {signal} : {})
        if (result.isError || !result.structuredContent) throw new Error('Поиск временно недоступен. Попробуйте ещё раз.')
        return result.structuredContent as unknown as TravelChatResult
    }
    return {run, mcp, close: facade.control.dispose}
}

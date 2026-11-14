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

export interface AssistantDeps {
    catalog: Pick<ReturnType<typeof createPlaceCatalog>, 'list' | 'destinations'>
    packages?: Pick<ReturnType<typeof createPackages>, 'calendar' | 'search'>
    flights?: {search: (query: FlightQuery) => Promise<FlightSearch>}
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
        const {offers, sources, calendar, links} = await deps.flights.search(query)
        return {query, offers: offers.slice(0, 5), calendar, sources, links}
    }, readOnly('Search a route by airport IATA codes. Quotes include source and currency. Recheck before purchase.',
        schema(flightProperties, ['origin', 'destination', 'departure'])))
    const facade = createMcpFacadeServer({name: 'wenay-travel', version: '1.0.0', strict: true, readOnly: true,
        object: {list_destinations, search_hotels, search_packages, hotel_calendar, find_airports, search_flights},
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

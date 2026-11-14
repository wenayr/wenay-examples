import {execFile} from 'node:child_process'
import {mkdir, readFile, rename, stat, writeFile} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'
import {parseArgs, promisify} from 'node:util'
import {createAsyncQueue} from 'wenay-common2'
import {buildTezSearch, readTezResults} from '../backend/partners/tez.ts'

const command = promisify(execFile)
const regions = {
    hurghada: {south: 24, north: 29, west: 31, east: 36},
    sharm: {south: 26, north: 30, west: 32, east: 36},
    rhodes: {south: 35, north: 37, west: 26, east: 30},
} as const
type tDestination = keyof typeof regions
interface HotelTarget {id: number, name: string}

export function readTezLocation(page: string, hotel: HotelTarget, destination: tDestination, checkedAt: string) {
    const source = 'https://www.tez-tour.com/hotel.html?id=' + hotel.id
    function unresolved(reason: string) {
        return {location: null, unresolved: {destination, ...hotel, source, reason}}
    }
    const pageId = /\bHOTEL_ID\s*=\s*(\d+)/.exec(page)
    if (Number(pageId?.[1]) != hotel.id) return unresolved('hotel-identity-mismatch')
    const latitude = /\bGEO_LOCATION_LATITUDE\s*=\s*([+-]?[\d.]+)/.exec(page)
    const longitude = /\bGEO_LOCATION_LONGITUDE\s*=\s*([+-]?[\d.]+)/.exec(page)
    if (!latitude || !longitude) return unresolved('coordinate-not-published')
    const lat = Number(latitude[1])
    const lon = Number(longitude[1])
    const bounds = regions[destination]
    const validLatitude = Number.isFinite(lat) && lat > bounds.south && lat < bounds.north
    const validLongitude = Number.isFinite(lon) && lon > bounds.west && lon < bounds.east
    if (!validLatitude || !validLongitude) return unresolved('coordinate-outside-destination')
    const location = {
        destination, ...hotel, latitude: lat, longitude: lon, source,
        coordinateSource: 'GEO_LOCATION_LATITUDE/GEO_LOCATION_LONGITUDE', coordinatePrecision: 'property-marker', checkedAt,
    } as const
    return {location, unresolved: null}
}

function readTargets(value: unknown) {
    if (!Array.isArray(value)) throw new Error('Hotel list must be an array of {id, name}')
    const unique = new Map<number, HotelTarget>()
    for (const row of value) {
        const validId = Number.isSafeInteger(row?.id) && row.id > 0
        const validName = typeof row?.name == 'string' && row.name.trim().length > 0
        if (!validId || !validName) throw new Error('Hotel list contains an invalid property identity')
        unique.set(row.id, {id: row.id, name: row.name.trim()})
    }
    return [...unique.values()]
}

async function requestText(url: string) {
    const {stdout} = await command('curl', ['-fsS', '--max-time', '20', '--proto', '=https', '--max-filesize', '8388608', url],
        {maxBuffer: 8 * 1024 * 1024})
    return stdout
}

function validDate(value: string) {
    const time = Date.parse(value)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(time)) return false
    return new Date(time).toISOString().slice(0, 10) == value
}

async function readPage(hotel: HotelTarget, cache: string, refresh: boolean) {
    const path = join(cache, hotel.id + '.html')
    if (!refresh) {
        try {
            const [page, metadata] = await Promise.all([readFile(path, 'utf8'), stat(path)])
            return {page, checkedAt: metadata.mtime.toISOString()}
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code != 'ENOENT') throw error
        }
    }
    const page = await requestText('https://www.tez-tour.com/hotel.html?id=' + hotel.id)
    const checkedAt = new Date().toISOString()
    await writeFile(path, page)
    return {page, checkedAt}
}

export async function collectTezLocations(deps: {
    destination: tDestination, hotels: HotelTarget[], cache: string, refresh: boolean,
}) {
    await mkdir(deps.cache, {recursive: true})
    const queue = createAsyncQueue(4)
    async function collectHotel(hotel: HotelTarget) {
        try {
            const {page, checkedAt} = await readPage(hotel, deps.cache, deps.refresh)
            return readTezLocation(page, hotel, deps.destination, checkedAt)
        } catch {
            return {location: null, unresolved: {destination: deps.destination, ...hotel,
                source: 'https://www.tez-tour.com/hotel.html?id=' + hotel.id, reason: 'source-unavailable'}}
        }
    }
    const results = await Promise.all(deps.hotels.map(hotel => queue.add(() => collectHotel(hotel))))
    return {
        collectedAt: new Date().toISOString(),
        locations: results.flatMap(result => result.location ? [result.location] : []),
        unresolved: results.flatMap(result => result.unresolved ? [result.unresolved] : []),
    }
}

async function main() {
    const {values} = parseArgs({options: {
        destination: {type: 'string', default: 'hurghada'}, list: {type: 'string'}, output: {type: 'string'}, cache: {type: 'string'},
        from: {type: 'string'}, to: {type: 'string'}, nights: {type: 'string', default: '7'},
        refresh: {type: 'boolean', default: false}, help: {type: 'boolean'},
    }})
    if (values.help || !values.list && !values.from) {
        console.log('node scripts/collect-tez-locations.ts --destination hurghada --list hotels.json --cache pages --output candidates.json')
        console.log('Alternatively use --from YYYY-MM-DD --to YYYY-MM-DD --nights 7 to obtain current supplier hotel IDs first.')
        console.log('Output is a candidate snapshot with unresolved properties. It does not replace or merge the production manifest.')
        return
    }
    if (!Object.hasOwn(regions, values.destination)) throw new Error('Unknown destination')
    const destination = values.destination as tDestination
    const nights = Number(values.nights)
    if (!Number.isInteger(nights) || nights < 1 || nights > 30) throw new Error('Invalid nights')
    if (values.from && !validDate(values.from)) throw new Error('Invalid first departure date')
    if (values.to && !validDate(values.to)) throw new Error('Invalid last departure date')
    if (values.to && !values.from) throw new Error('--to requires --from')
    let hotels: HotelTarget[]
    if (values.list) hotels = readTargets(JSON.parse(await readFile(resolve(values.list), 'utf8')))
    else {
        const first = values.from!
        const last = values.to ?? first
        const firstTime = Date.parse(first)
        const span = (Date.parse(last) - firstTime) / 86_400_000
        if (!Number.isInteger(span) || span < 0 || span >= 20) throw new Error('Use a departure window shorter than twenty days')
        const checkOut = new Date(firstTime + nights * 86_400_000).toISOString().slice(0, 10)
        const search = buildTezSearch({destinationId: destination, checkIn: first, checkOut, adults: 2}, new Date().toISOString().slice(0, 10))
        if (!search) throw new Error('Unsupported supplier search')
        const url = new URL(search.url)
        url.searchParams.set('before', last.split('-').reverse().join('.'))
        const payload = JSON.parse(await requestText(url.href))
        if (payload?.success != true || !Array.isArray(payload.data)) throw new Error('Supplier search did not return inventory')
        const offers = readTezResults(payload, {...search, last}, new Date().toISOString())
        const verifiedIds = new Set(offers.map(offer => Number(offer.id.split(':')[1])))
        const selected = payload.data.filter((row: unknown): row is unknown[] => Array.isArray(row) && verifiedIds.has(row[6]?.[3]))
        hotels = readTargets(selected.map((row: unknown[]) => {
            const property = row[6] as [unknown, string, unknown, number]
            return {id: property?.[3], name: property?.[1]}
        }))
    }
    const cache = resolve(values.cache ?? '.cache/tez-hotel-pages')
    const snapshot = await collectTezLocations({destination, hotels, cache, refresh: values.refresh})
    const result = {...snapshot, search: {destination, first: values.from ?? null, last: values.to ?? values.from ?? null, nights}}
    if (values.output) {
        const path = resolve(values.output)
        await mkdir(dirname(path), {recursive: true})
        const temporary = path + '.' + process.pid + '.tmp'
        await writeFile(temporary, JSON.stringify(result, null, 2) + '\n')
        await rename(temporary, path)
    }
    console.log(JSON.stringify({requested: hotels.length, verified: result.locations.length,
        unresolved: result.unresolved.length, output: values.output ?? null}))
}

if (import.meta.main) await main()

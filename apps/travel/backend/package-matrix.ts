import {createAsyncQueue} from 'wenay-common2'
import {packageMaxTotal} from '../src/package-contract.ts'
import {
    packageMatrixCellLimit, type PackageMatrix, type PackageMatrixCell, type PackageMatrixFare
} from '../src/package-matrix-contract.ts'
import type {SupplySource} from '../src/supply-contract.ts'
import type {createTezInventory, TezObservation, TezQuote, TezWindow} from './partners/tez-inventory.ts'
import {boundary} from './range-index.ts'

type tProvider = Pick<ReturnType<typeof createTezInventory>, 'day' | 'range'>
const oneDay = 86_400_000
const source = {id: 'tez', name: 'TEZ TOUR Eesti', url: 'https://www.teztour.ee/page/xml-gate.et.html'}

function matrixAxes(trip: TezWindow, hotelId: string, requestedNights: readonly number[]) {
    if (!/^tez:[1-9]\d{0,14}$/.test(hotelId)) throw new RangeError('Укажите отель туроператора.')
    const first = Date.parse(trip.first + 'T00:00:00Z')
    const last = Date.parse(trip.last + 'T00:00:00Z')
    const span = (last - first) / oneDay
    const validDates = Number.isInteger(span) && span >= 0 && span < packageMatrixCellLimit
    if (!validDates) throw new RangeError('Загружайте матрицу частями до шести ячеек.')
    const exactDates = new Date(first).toISOString().slice(0, 10) == trip.first && new Date(last).toISOString().slice(0, 10) == trip.last
    if (!exactDates) throw new RangeError('Выберите действительные даты вылета.')
    const nights = [...new Set(requestedNights)].sort((a, b) => a - b)
    const validNights = nights.length > 0 && nights.length <= 3 && nights.every(value => Number.isInteger(value) && value >= 1 && value <= 30)
    if (!validNights || nights.length * (span + 1) > packageMatrixCellLimit) {
        throw new RangeError('Загружайте матрицу частями до шести ячеек, от одной до тридцати ночей.')
    }
    const validBudget = Number.isSafeInteger(trip.minTotal) && Number.isSafeInteger(trip.maxTotal)
    if (!validBudget || trip.minTotal < 0 || trip.maxTotal < trip.minTotal) throw new RangeError('Проверьте границы бюджета.')
    const departures = Array.from({length: span + 1}, (_, index) => new Date(first + index * oneDay).toISOString().slice(0, 10))
    return {departures, rows: nights.map(nights => ({nights, days: nights + 1}))}
}

function publicFare(quote: TezQuote, trip: TezWindow, checkedAt: string): PackageMatrixFare {
    return {id: quote.id, departure: quote.departure, total: quote.total, nights: trip.nights, days: trip.nights + 1,
        adults: trip.adults, children: 0, currency: 'EUR', priceBasis: 'party-total', room: quote.conditions?.room ?? null,
        board: quote.conditions?.board ?? null, sourceUrl: quote.url, checkedAt}
}

function unknownCell(trip: TezWindow, departure: string, observedSource: SupplySource): PackageMatrixCell {
    let status: PackageMatrixCell['status'] = 'unknown'
    if (observedSource.status == 'unavailable' && !observedSource.retryAt) status = 'failed'
    return {departure, nights: trip.nights, days: trip.nights + 1, lowest: null, inBudget: null, highest: null,
        complete: false, checkedAt: null, retryAt: observedSource.retryAt, source: observedSource, status}
}

function prepareCell(trip: TezWindow, hotelId: string, departure: string, observation: TezObservation, knownHotel: boolean): PackageMatrixCell {
    const successful = observation.source.status == 'live' || observation.source.status == 'cached'
    if (!successful || !observation.source.updatedAt) return unknownCell(trip, departure, observation.source)
    const cellQuotes = observation.quotes.filter(quote => !quote.conditions || quote.conditions.nights == trip.nights)
    const fares = cellQuotes.filter(quote => {
        const context = quote.conditions
        const validConditions = !context || context.nights == trip.nights && context.adults == trip.adults && context.children == 0
        const validPrice = Number.isSafeInteger(quote.total) && quote.total > 0
        const requestedCell = quote.hotelId == hotelId && quote.departure == departure
        return requestedCell && validConditions && validPrice
    }).sort((a, b) => a.total - b.total || a.id.localeCompare(b.id))
    const complete = !observation.source.retryAt && observation.complete && fares.length == cellQuotes.length
    const position = boundary(fares, fare => fare.total < trip.minTotal)
    const candidate = fares[position]
    const withinBudget = candidate && candidate.total <= trip.maxTotal ? candidate : null
    const checkedAt = observation.source.updatedAt
    let status: PackageMatrixCell['status'] = 'unknown'
    if (withinBudget) status = 'in-budget'
    else if (fares.length && complete) status = 'outside-budget'
    else if (complete && knownHotel) status = 'empty'
    if (observation.source.retryAt) status = 'unknown'
    return {departure, nights: trip.nights, days: trip.nights + 1, status, complete, checkedAt,
        retryAt: observation.source.retryAt, source: observation.source,
        lowest: fares[0] ? publicFare(fares[0], trip, checkedAt) : null,
        inBudget: withinBudget ? publicFare(withinBudget, trip, checkedAt) : null,
        highest: fares.length ? publicFare(fares[fares.length - 1], trip, checkedAt) : null}
}

function describeCells(cells: PackageMatrixCell[]): SupplySource {
    const retryTimes = cells.flatMap(cell => cell.retryAt ? [cell.retryAt] : []).sort()
    const retryAt = retryTimes.at(-1)
    const checked = cells.filter(cell => cell.checkedAt)
    if (!checked.length) return {...source, status: 'unavailable', updatedAt: null, retryAt, description: 'Цены матрицы пока не подтверждены.'}
    const times = checked.map(cell => cell.checkedAt!).sort()
    const description = 'Проверено сочетаний дат и длительности: ' + checked.length + ' из ' + cells.length
        + '. Цена всего пакета для выбранных гостей; номер и питание указаны у тарифа.'
    return {...source, status: checked.some(cell => cell.source.status == 'live') ? 'live' : 'cached', updatedAt: times[0], retryAt, description}
}

export function createPackageMatrix(deps: {provider: tProvider, knownHotel?: (destinationId: string, hotelId: string) => boolean}) {
    async function read(trip: TezWindow, hotelId: string, requestedNights: readonly number[], signal?: AbortSignal): Promise<PackageMatrix> {
        signal?.throwIfAborted()
        const axes = matrixAxes(trip, hotelId, requestedNights)
        const knownHotel = deps.knownHotel?.(trip.destinationId, hotelId) ?? false
        // Per-reader scheduling lets overlapping readers attach to inventory's shared requests
        // before one reader cancels. Inventory still enforces the global six-request limit.
        const queue = createAsyncQueue(3)
        const range = deps.provider.range
        async function loadCells(departure: string, nights: readonly number[]) {
            signal?.throwIfAborted()
            const context = {...trip, first: departure, last: departure, nights: nights[0], minTotal: 0, maxTotal: packageMaxTotal}
            try {
                const observation = range ? await range(context, hotelId, departure, nights, signal)
                    : await deps.provider.day(context, hotelId, departure, false, signal)
                signal?.throwIfAborted()
                return nights.map(nights => prepareCell({...trip, nights}, hotelId, departure, observation, knownHotel))
            } catch {
                signal?.throwIfAborted()
                const failedSource = {...source, status: 'unavailable', updatedAt: null,
                    description: 'Не удалось проверить это сочетание даты и длительности.'} satisfies SupplySource
                return nights.map(nights => unknownCell({...trip, nights}, departure, failedSource))
            }
        }
        const nights = axes.rows.map(row => row.nights)
        const requests = range ? axes.departures.map(departure => ({departure, nights}))
            : axes.rows.flatMap(row => axes.departures.map(departure => ({departure, nights: [row.nights]})))
        const groups = await Promise.all(requests.map(item => queue.add(() => loadCells(item.departure, item.nights))))
        const byCell = new Map(groups.flat().map(cell => [cell.nights + '/' + cell.departure, cell]))
        const cells = axes.rows.flatMap(row => axes.departures.map(departure => byCell.get(row.nights + '/' + departure)!))
        signal?.throwIfAborted()
        if (cells.some(cell => cell.lowest)) {
            for (const cell of cells) {
                if (cell.status == 'unknown' && cell.complete && !cell.lowest) cell.status = 'empty'
            }
        }
        return {hotelId, ...axes, adults: trip.adults, currency: 'EUR', priceBasis: 'party-total', cells,
            source: describeCells(cells)} satisfies PackageMatrix
    }
    return {read}
}

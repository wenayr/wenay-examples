import {shiftDate} from './directory-preferences.ts'
import type {PackageMatrix, PackageMatrixCell} from '../src/package-matrix-contract.ts'

export const matrixPageDates = 8
export const matrixRows = 3
export const matrixChunkCells = 6
export const matrixVisibleRows = 4

export function matrixDates(first: string, last: string) {
    const length = Math.floor((Date.parse(last) - Date.parse(first)) / 86_400_000) + 1
    return Array.from({length: Math.max(0, length)}, (_, index) => shiftDate(first, index))
}

export function matrixNights(first: number) {
    return Array.from({length: matrixRows}, (_, index) => Math.min(28, Math.max(1, first)) + index)
}

export function matrixFirstNights(nights: number) {
    return Math.min(28, Math.max(1, nights - 1))
}

export function matrixRangeNights(first: number, last: number) {
    const start = Math.max(1, Math.min(30, first))
    const end = Math.max(start, Math.min(30, last))
    return Array.from({length: end - start + 1}, (_, index) => start + index)
}

export function matrixViewForRoute(nights: number, query = new URLSearchParams()) {
    const first = matrixFirstNights(nights)
    function field(key: string, fallback: number, min: number, max: number) {
        const raw = query.get(key)
        const value = raw == null ? NaN : Number(raw)
        return Number.isInteger(value) && value >= min && value <= max ? value : fallback
    }
    const firstNights = field('matrixFrom', first, 1, 30)
    return {
        firstNights, lastNights: field('matrixTo', Math.min(30, firstNights + 2), firstNights, 30),
        durationOffset: field('matrixRow', 0, 0, 29), dateOffset: field('matrixDate', 0, 0, 19),
    }
}

export type MatrixViewContext = ReturnType<typeof matrixViewForRoute>

export function matrixCellKey(departure: string, nights: number) {
    return departure + '/' + nights
}

export function matrixChunks(departures: readonly string[], nights: readonly number[]) {
    const groups = Array.from({length: Math.ceil(nights.length / matrixRows)}, (_, index) => nights.slice(index * matrixRows, (index + 1) * matrixRows))
    return groups.flatMap(group => {
        const count = Math.max(1, Math.floor(matrixChunkCells / group.length))
        return Array.from({length: Math.ceil(departures.length / count)}, (_, index) => {
            const dates = departures.slice(index * count, (index + 1) * count)
            return {firstDeparture: dates[0], lastDeparture: dates.at(-1)!, nightsValues: group.join(',')}
        })
    })
}

export function refreshedMatrixSelection(selected: PackageMatrixCell | null, cells: readonly PackageMatrixCell[], failedCellKeys: readonly string[] = []) {
    if (!selected?.inBudget) return selected
    if (failedCellKeys.includes(matrixCellKey(selected.departure, selected.nights))) return null
    const fresh = cells.find(cell => cell.departure == selected.departure && cell.nights == selected.nights)
    if (!fresh || fresh === selected) return selected
    const sameFare = fresh.inBudget?.id == selected.inBudget.id && fresh.inBudget?.total == selected.inBudget.total
    return sameFare ? fresh : null
}

export function matrixRetryAt(matrix: PackageMatrix) {
    const retries = [matrix.source.retryAt, ...matrix.cells.map(cell => cell.retryAt)]
    const times = retries.flatMap(retry => retry && Number.isFinite(Date.parse(retry)) ? [Date.parse(retry)] : [])
    return times.length ? new Date(Math.max(...times)).toISOString() : null
}

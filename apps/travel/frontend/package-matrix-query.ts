import {useEffect, useRef, useState} from 'react'
import type {PackageMatrix, PackageMatrixCell} from '../src/package-matrix-contract.ts'
import {canonicalDirectoryResource} from '../src/package-live-contract.ts'
import {directoryResources, directoryUrl, useDirectoryScope} from './directory-query.ts'
import {packageQuery, type PackagePreferences} from './package-preferences.ts'
import {matrixCellKey, matrixChunks, matrixDates, matrixRetryAt} from './package-matrix.ts'

interface MatrixState {
    key: string
    cells: PackageMatrixCell[]
    failed: string[]
    failedCellKeys: string[]
    staleCellKeys: string[]
    waitingUntil: string | null
    loading: boolean
}

export function usePackageMatrix(prefs: PackagePreferences, departures: readonly string[], nights: readonly number[], enabled: boolean) {
    useDirectoryScope()
    const chunks = matrixChunks(departures, nights, prefs.nights)
    const urls = chunks.map(chunk => canonicalDirectoryResource(directoryUrl('package-matrix', {
        ...packageQuery(prefs), nights: nights[0], ...chunk, hotelId: prefs.hotelId,
    })))
    const key = enabled ? urls.join('|') : ''
    const [state, setState] = useState<MatrixState | null>(null)
    const last = useRef<MatrixState | null>(null)
    useEffect(() => {
        if (!key) return
        const requests = key.split('|')
        const resources = requests.map(url => directoryResources.source.resource(url))
        const retained = new Map<string, PackageMatrixCell>()
        if (last.current?.key == key) {
            for (const cell of last.current.cells) retained.set(matrixCellKey(cell.departure, cell.nights), cell)
        }
        let active = true
        function publish() {
            if (!active) return
            const failed = new Set<string>()
            const failedCellKeys = new Set<string>()
            const staleCellKeys = new Set<string>()
            const waits: string[] = []
            let loading = false
            for (const [index, resource] of resources.entries()) {
                const snapshot = resource.view.snapshot()
                const data = snapshot.data as PackageMatrix | undefined
                if (snapshot.loading || !data && !snapshot.error) loading = true
                if (snapshot.error) {
                    failed.add(requests[index])
                    const chunk = chunks[index]
                    for (const departure of matrixDates(chunk.firstDeparture, chunk.lastDeparture)) {
                        for (const night of chunk.nightsValues.split(',').map(Number)) {
                            const cellKey = matrixCellKey(departure, night)
                            failedCellKeys.add(cellKey)
                            const cell = retained.get(cellKey)
                            if (cell?.inBudget || cell?.lowest) staleCellKeys.add(cellKey)
                        }
                    }
                }
                if (!data) continue
                const retryAt = matrixRetryAt(data)
                if (retryAt && Date.parse(retryAt) > Date.now()) {
                    waits.push(retryAt)
                }
                for (const cell of data.cells) {
                    const cellKey = matrixCellKey(cell.departure, cell.nights)
                    const uncertain = cell.source.stale || cell.status == 'unknown' || cell.status == 'failed'
                    const paused = Boolean(cell.retryAt ?? cell.source.retryAt)
                    const uncertainPrice = uncertain || paused || snapshot.loading || snapshot.error
                    const previous = retained.get(cellKey)
                    const hasPriorFare = previous?.inBudget || previous?.lowest
                    const incomingFare = cell.inBudget ?? cell.lowest
                    const older = Date.parse(previous?.checkedAt ?? '') > Date.parse(cell.checkedAt ?? '')
                    const keep = hasPriorFare && uncertainPrice && (!incomingFare || older)
                    const display = keep ? previous : cell
                    retained.set(cellKey, display)
                    if (uncertainPrice && (display.inBudget || display.lowest)) staleCellKeys.add(cellKey)
                    if (cell.status == 'failed') failedCellKeys.add(cellKey)
                }
            }
            const waitingUntil = waits.sort().at(-1) ?? null
            const next = {key, cells: [...retained.values()], failed: [...failed], failedCellKeys: [...failedCellKeys],
                staleCellKeys: [...staleCellKeys], waitingUntil, loading}
            last.current = next
            setState(next)
        }
        const disposers = resources.map(resource => resource.events.on(publish))
        publish()
        return () => {
            active = false
            for (const off of disposers) off()
        }
    }, [key])
    const current = state?.key == key ? state : undefined
    function retry() {
        for (const url of urls) directoryResources.source.resource(url).control.retry()
    }
    function refresh() {
        for (const url of urls) directoryResources.source.resource(url).control.refresh()
    }
    return {
        cells: current?.cells ?? [], failed: current?.failed ?? [], failedCellKeys: current?.failedCellKeys ?? [],
        staleCellKeys: current?.staleCellKeys ?? [], waitingUntil: current?.waitingUntil ?? null,
        loading: Boolean(key) && (current?.loading ?? true), retry, refresh,
    }
}

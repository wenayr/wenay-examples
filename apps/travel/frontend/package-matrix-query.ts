import {useEffect, useRef, useState} from 'react'
import type {PackageMatrix, PackageMatrixCell} from '../src/package-matrix-contract.ts'
import {directoryUrl} from './directory-query.ts'
import {packageQuery, type PackagePreferences} from './package-preferences.ts'
import {matrixCellKey, matrixChunks, matrixDates, matrixRetryAt} from './package-matrix.ts'

const pages = new Map<string, {data: PackageMatrix, expiresAt: number}>()
const freshnessMs = 120_000
interface MatrixState {
    key: string
    cells: PackageMatrixCell[]
    pending: string[]
    failed: string[]
    failedCellKeys: string[]
    staleCellKeys: string[]
    waitingUntil: string | null
    loading: boolean
}

function waitUntil(retryAt: string, signal: AbortSignal) {
    return new Promise<void>(resolve => {
        function finish() {
            clearTimeout(timer)
            signal.removeEventListener('abort', finish)
            resolve()
        }
        const timer = setTimeout(finish, Math.max(0, Date.parse(retryAt) - Date.now()))
        if (signal.aborted) finish()
        else signal.addEventListener('abort', finish, {once: true})
    })
}

export function usePackageMatrix(prefs: PackagePreferences, departures: readonly string[], nights: readonly number[], enabled: boolean) {
    const chunks = matrixChunks(departures, nights)
    const urls = chunks.map(chunk => directoryUrl('package-matrix', {
        ...packageQuery(prefs), nights: nights[0], ...chunk, hotelId: prefs.hotelId,
    }))
    const key = enabled ? urls.join('|') : ''
    const [state, setState] = useState<MatrixState | null>(null)
    const last = useRef<MatrixState | null>(null)
    const [attempt, setAttempt] = useState(0)
    useEffect(() => {
        if (!key) return
        const controller = new AbortController()
        const requests = key.split('|')
        const collected = new Map<string, PackageMatrixCell>()
        const failed = new Set<string>()
        const failedCellKeys = new Set<string>()
        const staleCellKeys = new Set<string>()
        let loading = true
        if (last.current?.key == key) {
            for (const cell of last.current.cells) {
                const cellKey = matrixCellKey(cell.departure, cell.nights)
                collected.set(cellKey, cell)
                staleCellKeys.add(cellKey)
            }
        }
        function remember(data: PackageMatrix) {
            for (const cell of data.cells) {
                const cellKey = matrixCellKey(cell.departure, cell.nights)
                const retryAt = cell.retryAt ?? cell.source.retryAt
                if (retryAt && Number.isFinite(Date.parse(retryAt))) {
                    if (!collected.has(cellKey)) collected.set(cellKey, cell)
                    staleCellKeys.add(cellKey)
                } else {
                    collected.set(cellKey, cell)
                    staleCellKeys.delete(cellKey)
                }
            }
        }
        for (const url of requests) {
            const cached = pages.get(url)
            if (cached && cached.expiresAt > Date.now()) remember(cached.data)
            else pages.delete(url)
        }
        function publish(pending: string[], loading: boolean, waitingUntil: string | null = null) {
            if (controller.signal.aborted) return
            const snapshot = {
                key, cells: [...collected.values()], failed: [...failed], failedCellKeys: [...failedCellKeys],
                staleCellKeys: [...staleCellKeys], pending, loading, waitingUntil,
            }
            last.current = snapshot
            setState(snapshot)
        }
        async function load() {
            const missing = requests.filter(url => !pages.has(url))
            publish(missing, missing.length > 0)
            // One bounded date × duration chunk at a time, with immediate partial display.
            for (const [index, url] of missing.entries()) {
                if (controller.signal.aborted) return
                try {
                    let pending = true
                    while (pending) {
                        const response = await fetch(url, {signal: controller.signal})
                        if (!response.ok) throw new Error('HTTP ' + response.status)
                        const data: PackageMatrix = await response.json()
                        if (controller.signal.aborted) return
                        remember(data)
                        const retryAt = matrixRetryAt(data)
                        if (retryAt) {
                            publish(missing.slice(index), true, retryAt)
                            await waitUntil(retryAt, controller.signal)
                            if (controller.signal.aborted) return
                            continue
                        }
                        pending = false
                        const retryable = data.cells.some(cell => cell.status == 'failed' || cell.status == 'unknown')
                        if (!retryable) {
                            if (pages.size >= 48) pages.delete(pages.keys().next().value!)
                            const checked = data.cells.flatMap(cell => cell.checkedAt ? [Date.parse(cell.checkedAt)] : [])
                            const receivedAt = Date.now()
                            const checkedAt = checked.length ? Math.min(receivedAt, ...checked) : receivedAt
                            pages.set(url, {data, expiresAt: checkedAt + freshnessMs})
                        }
                    }
                } catch {
                    if (controller.signal.aborted) return
                    failed.add(url)
                    const chunk = chunks[requests.indexOf(url)]
                    const dates = matrixDates(chunk.firstDeparture, chunk.lastDeparture)
                    const durations = chunk.nightsValues.split(',').map(Number)
                    for (const departure of dates) {
                        for (const night of durations) failedCellKeys.add(matrixCellKey(departure, night))
                    }
                }
                const pending = missing.slice(index + 1)
                publish(pending, pending.length > 0)
            }
            loading = false
        }
        function checkFreshness() {
            if (loading || document.visibilityState == 'hidden') return
            const expired = requests.some(url => (pages.get(url)?.expiresAt ?? 0) <= Date.now())
            if (expired) setAttempt(value => value + 1)
        }
        void load()
        window.addEventListener('focus', checkFreshness)
        document.addEventListener('visibilitychange', checkFreshness)
        return () => {
            controller.abort()
            window.removeEventListener('focus', checkFreshness)
            document.removeEventListener('visibilitychange', checkFreshness)
        }
    }, [key, attempt])
    const current = state?.key == key ? state : undefined
    function retry() {
        setAttempt(value => value + 1)
    }
    function refresh() {
        for (const url of urls) pages.delete(url)
        setAttempt(value => value + 1)
    }
    return {
        cells: current?.cells ?? [], failed: current?.failed ?? [], failedCellKeys: current?.failedCellKeys ?? [],
        staleCellKeys: current?.staleCellKeys ?? [], waitingUntil: current?.waitingUntil ?? null,
        loading: Boolean(key) && (current?.loading ?? true),
        retry, refresh,
    }
}

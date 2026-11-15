import {useEffect, useEffectEvent, useRef, useState, useSyncExternalStore} from 'react'

interface ResponseState<T> {key: string, data?: T, error?: string, loading?: boolean}
const responses = new Map<string, unknown>()
let agencyScope: {slug?: string, revision?: number} = {}
let agencyScopeKey = ''
const scopeListeners = new Set<() => void>()

export function setDirectoryAgencyScope(scope: {slug?: string, revision?: number}) {
    const key = (scope.slug ?? '') + ':' + (scope.revision ?? '')
    if (key == agencyScopeKey) return
    agencyScope = scope
    agencyScopeKey = key
    for (const listener of scopeListeners) listener()
}

function subscribeScope(listener: () => void) {
    scopeListeners.add(listener)
    return () => {scopeListeners.delete(listener)}
}

function scopedDirectoryUrl(url: string) {
    const [path, query] = url.split('?')
    const params = new URLSearchParams(query)
    params.delete('agency')
    params.delete('agencyRevision')
    if (agencyScope.slug) params.set('agency', agencyScope.slug)
    if (agencyScope.revision != null) params.set('agencyRevision', String(agencyScope.revision))
    const suffix = params.toString()
    return path + (suffix ? '?' + suffix : '')
}

export function useDirectoryQuery<T>(inputUrl: string | null, refreshRevision = 0) {
    useSyncExternalStore(subscribeScope, () => agencyScopeKey)
    const url = inputUrl ? scopedDirectoryUrl(inputUrl) : null
    const [result, setResult] = useState<ResponseState<T> | null>(() => url ? {key: url, data: responses.get(url) as T | undefined, loading: true} : null)
    const [attempt, setAttempt] = useState(0)
    const fresh = useRef(false)
    useEffect(() => {
        if (!url) return
        const current = url
        const requestUrl = fresh.current ? directoryRefreshUrl(current) : current
        fresh.current = false
        const controller = new AbortController()
        setResult(previous => ({key: current, data: previous?.key == current ? previous.data : responses.get(current) as T | undefined, loading: true}))
        async function load() {
            try {
                const response = await fetch(requestUrl, {signal: controller.signal})
                if (!response.ok) {
                    const body: unknown = await response.json().catch(() => null)
                    const message = body && typeof body === 'object' && 'error' in body ? body.error : ''
                    if (typeof message === 'string' && message) {
                        if (!controller.signal.aborted) setResult({key: current, data: responses.get(current) as T | undefined, error: message})
                        return
                    }
                    throw new Error('HTTP ' + response.status)
                }
                const data: T = await response.json()
                if (!controller.signal.aborted) {
                    if (responses.size >= 32) responses.delete(responses.keys().next().value!)
                    responses.set(current, data)
                    setResult({key: current, data})
                }
            } catch {
                if (!controller.signal.aborted) setResult(previous => ({
                    key: current, data: previous?.key == current ? previous.data : undefined,
                    error: 'Не удалось получить данные каталога.',
                }))
            }
        }
        void load()
        return () => controller.abort()
    }, [url, attempt, refreshRevision])
    function retry() {
        setAttempt(n => n + 1)
    }
    function refresh() {
        fresh.current = true
        setAttempt(n => n + 1)
    }
    const visible = result?.key == url ? result : null
    return {
        data: visible?.data, error: visible?.error,
        loading: Boolean(url) && (visible?.loading ?? !visible),
        retry, refresh,
    }
}

// The same-origin REST API supplies snapshots. EventSource only signals invalidation;
// the browser reconnects with Last-Event-ID and the server replays or resets this region.
export function useDirectoryEvents(destination: string, revision: string | undefined, invalidate: () => void) {
    const scopeKey = useSyncExternalStore(subscribeScope, () => agencyScopeKey)
    const readCursor = useEffectEvent(() => revision)
    const refresh = useEffectEvent(invalidate)
    const ready = Boolean(revision)
    useEffect(() => {
        if (!ready) return
        const events = new EventSource(directoryUrl('events', {destination, since: readCursor()}))
        let disconnected = false
        let timer: ReturnType<typeof setTimeout> | undefined
        function schedule() {
            if (timer !== undefined) return
            timer = setTimeout(() => {
                timer = undefined
                refresh()
            }, 60)
        }
        // An update may have arrived just before the socket or its subsequent GET failed.
        events.onopen = () => {
            if (disconnected) schedule()
            disconnected = false
        }
        events.onerror = () => { disconnected = true }
        // Reporting an offline/online transition differs between browsers. Also retry a lost GET.
        window.addEventListener('online', schedule)
        events.addEventListener('catalog', schedule)
        events.addEventListener('reset', schedule)
        return () => {
            clearTimeout(timer)
            window.removeEventListener('online', schedule)
            events.close()
        }
    }, [destination, ready, scopeKey])
}

type DirectoryEndpoint = 'destinations' | 'catalog' | 'hotel' | 'options' | 'events' | 'packages'
    | 'package-calendar' | 'package-trends' | 'package-matrix' | 'package-gallery' | 'package-hotel-search' | 'package-compare' | 'package-recheck'
    | 'flights' | 'airports' | 'providers' | 'provider-search' | 'deals' | 'markets'
    | 'hotel-reviews'

export function directoryUrl(path: DirectoryEndpoint, query: Record<string, string | number | undefined> = {}) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
        if (value != null && value !== '') params.set(key, String(value))
    }
    const suffix = params.toString()
    return scopedDirectoryUrl(import.meta.env.BASE_URL + 'api/travel/' + path + (suffix ? '?' + suffix : ''))
}

export function directoryRefreshUrl(url: string) {
    return url + (url.includes('?') ? '&' : '?') + 'refresh=1'
}

import {useEffect, useEffectEvent, useMemo} from 'react'
import {listenStore} from 'wenay-common2/listen'
import {useListenValue} from 'wenay-react2/react'
import {createDirectoryResources, type DirectoryResourceState} from './directory-resources.ts'

let agencyScope: {slug?: string, revision?: number} = {}
let agencyScopeKey = ''
const [emitScope, scopeChanges] = listenStore<[string]>({current: () => [agencyScopeKey]})
export const directoryResources = createDirectoryResources({
    fetch: (input, init) => fetch(input, init),
    connect: url => typeof EventSource == 'undefined' ? null : new EventSource(url),
})
const transportEvents = {on: directoryResources.events.transport}
if (typeof document != 'undefined') {
    function visible() { directoryResources.control.visible(document.visibilityState != 'hidden') }
    visible()
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('online', () => directoryResources.control.online(true))
    window.addEventListener('offline', () => directoryResources.control.online(false))
    directoryResources.control.online(navigator.onLine)
}

export function useDirectoryScope() {
    return useListenValue(scopeChanges, {initial: agencyScopeKey, current: true}) ?? agencyScopeKey
}

export function useDirectoryTransport() {
    return useListenValue(transportEvents, {initial: directoryResources.health.transport(), current: true})
        ?? directoryResources.health.transport()
}

export function setDirectoryAgencyScope(scope: {slug?: string, revision?: number}) {
    const key = (scope.slug ?? '') + ':' + (scope.revision ?? '')
    if (key == agencyScopeKey) return
    agencyScope = scope
    agencyScopeKey = key
    emitScope(key)
}

function scopedDirectoryUrl(url: string) {
    const [path, query] = url.split('?')
    const params = new URLSearchParams(query)
    params.delete('agency')
    params.delete('agencyRevision')
    if (agencyScope.slug) params.set('agency', agencyScope.slug)
    if (agencyScope.revision != null) params.set('agencyRevision', String(agencyScope.revision))
    params.sort()
    const suffix = params.toString()
    return path + (suffix ? '?' + suffix : '')
}

export function useDirectoryQuery<T>(inputUrl: string | null, refreshRevision = 0) {
    useDirectoryScope()
    const url = inputUrl ? scopedDirectoryUrl(inputUrl) : null
    const resource = useMemo(() => url ? directoryResources.source.resource(url) : null, [url])
    const state = useListenValue<DirectoryResourceState>(resource?.events, {
        initial: resource?.view.snapshot(), current: true,
    })
    const current = resource?.view.snapshot()
    const visible = state?.key == current?.key ? state : current
    useEffect(() => {
        if (refreshRevision) resource?.control.retry()
    }, [resource, refreshRevision])
    return {
        data: visible?.data as T | undefined,
        error: visible?.error,
        loading: Boolean(url) && (visible?.loading ?? true),
        retry: () => resource?.control.retry(),
        refresh: () => resource?.control.refresh(),
    }
}

// The same-origin REST API supplies snapshots. EventSource only signals invalidation;
// the browser reconnects with Last-Event-ID and the server replays or resets this region.
export function useDirectoryEvents(destination: string, revision: string | undefined, invalidate: () => void) {
    const scopeKey = useDirectoryScope()
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

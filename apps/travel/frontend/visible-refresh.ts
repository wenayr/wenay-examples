import {useEffect, useEffectEvent, useState} from 'react'

export function usePageVisible() {
    const [visible, setVisible] = useState(() => document.visibilityState != 'hidden')
    useEffect(() => {
        function changed() { setVisible(document.visibilityState != 'hidden') }
        document.addEventListener('visibilitychange', changed)
        return () => document.removeEventListener('visibilitychange', changed)
    }, [])
    return visible
}

export function useVisibleRefresh({enabled, busy, retryAt, onRefresh, interval = 120_000}: {
    enabled: boolean, busy: boolean, retryAt?: string | null, onRefresh: () => void, interval?: number,
}) {
    const refresh = useEffectEvent(onRefresh)
    useEffect(() => {
        if (!enabled || busy) return
        const delay = retryAt ? Math.max(0, Date.parse(retryAt) - Date.now()) : interval
        const timer = setTimeout(() => refresh(), Number.isFinite(delay) ? delay : interval)
        return () => clearTimeout(timer)
    }, [enabled, busy, retryAt, interval])
}

import {useEffect, useState} from 'react'

type ResponseState<T> = {key: string, data: T} | {key: string, error: string}

export function useDirectoryQuery<T>(url: string | null) {
    const [result, setResult] = useState<ResponseState<T> | null>(null)
    const [attempt, setAttempt] = useState(0)
    useEffect(() => {
        if (!url) return
        const current = url
        const controller = new AbortController()
        async function load() {
            try {
                const response = await fetch(current, {signal: controller.signal})
                if (!response.ok) throw new Error('HTTP ' + response.status)
                const data: T = await response.json()
                if (!controller.signal.aborted) setResult({key: current, data})
            } catch {
                if (!controller.signal.aborted) setResult({key: current, error: 'Не удалось получить данные каталога.'})
            }
        }
        void load()
        return () => controller.abort()
    }, [url, attempt])
    function retry() {
        setResult(null)
        setAttempt(n => n + 1)
    }
    const visible = result?.key == url ? result : null
    return {
        data: visible && 'data' in visible ? visible.data : undefined,
        error: visible && 'error' in visible ? visible.error : undefined,
        retry,
    }
}

export function directoryUrl(path: 'destinations' | 'catalog' | 'options', query: Record<string, string | number | undefined> = {}) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
        if (value != null && value !== '') params.set(key, String(value))
    }
    const suffix = params.toString()
    return import.meta.env.BASE_URL + 'api/travel/' + path + (suffix ? '?' + suffix : '')
}

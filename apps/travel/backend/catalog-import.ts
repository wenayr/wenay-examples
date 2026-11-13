import {Worker} from 'node:worker_threads'
import type {PlaceDataset} from './catalog.ts'

type Job = {kind: 'photos'} | {kind: 'source' | 'refresh', destination: string, source: string}
export type ImportMessage = {id: number, job: Job} | {id: number, cancel: true}
export interface ImportReply {
    id: number
    fetchedAt: string | null
    writes: number
    error?: {message: string, status?: number}
}

export function createCatalogImporter() {
    let worker: Worker | undefined
    let closed = false
    let nextId = 0
    let writes = 0
    const pending = new Map<number, {resolve: (date: string | null) => void, reject: (error: unknown) => void}>()

    function rejectPending(error: unknown) {
        for (const job of pending.values()) job.reject(error)
        pending.clear()
    }

    function getWorker() {
        if (closed) throw new Error('Импорт каталога остановлен')
        if (worker) return worker
        const thread = new Worker(new URL('./catalog-import-worker.ts', import.meta.url), {execArgv: []})
        worker = thread
        // The count in each reply includes completed writes even if the requester cancelled its promise.
        let previousWrites = 0
        thread.on('message', (reply: ImportReply) => {
            writes += reply.writes - previousWrites
            previousWrites = reply.writes
            const entry = pending.get(reply.id)
            if (!entry) return
            pending.delete(reply.id)
            if (reply.error) entry.reject(Object.assign(new Error(reply.error.message), {status: reply.error.status}))
            else entry.resolve(reply.fetchedAt)
        })
        thread.on('error', error => {
            if (worker == thread) rejectPending(error)
        })
        thread.on('exit', code => {
            if (worker != thread) return
            worker = undefined
            rejectPending(new Error('Поток импорта каталога завершился с кодом ' + code))
        })
        thread.unref()
        return thread
    }

    async function submit(job: Job, signal?: AbortSignal) {
        signal?.throwIfAborted()
        const thread = getWorker()
        const id = ++nextId
        thread.ref()
        function abort() {
            const entry = pending.get(id)
            if (!entry) return
            pending.delete(id)
            thread.postMessage({id, cancel: true} satisfies ImportMessage)
            entry.reject(signal?.reason)
        }
        try {
            return await new Promise<string | null>((resolve, reject) => {
                pending.set(id, {resolve, reject})
                signal?.addEventListener('abort', abort, {once: true})
                thread.postMessage({id, job} satisfies ImportMessage)
            })
        } finally {
            pending.delete(id)
            signal?.removeEventListener('abort', abort)
            if (!pending.size) thread.unref()
        }
    }

    async function refresh(destination: string, source: string, {signal}: {signal: AbortSignal}): Promise<PlaceDataset> {
        const fetchedAt = await submit({kind: 'refresh', destination, source}, signal)
        return {fetchedAt, records: []}
    }

    async function syncSource(destination: string, source: string) { await submit({kind: 'source', destination, source}) }
    async function syncPhotos() { await submit({kind: 'photos'}) }
    async function shutdown() {
        closed = true
        rejectPending(new Error('Импорт каталога остановлен'))
        if (worker) await worker.terminate()
    }
    return {refresh, syncSource, syncPhotos, shutdown, writes: () => writes}
}

import {parentPort} from 'node:worker_threads'
import type {ImportMessage, ImportReply} from './catalog-import.ts'
import {openCatalogStorage} from './catalog-storage.ts'
import {refreshAndSavePlaceDestination} from './places/index.mjs'
import {createPropertyPhotos} from './property-photos.ts'

if (!parentPort) throw new Error('Импорт каталога запускается в рабочем потоке')
const port = parentPort
const storage = openCatalogStorage({photos: createPropertyPhotos({lazy: true}), prepare: false})
const controllers = new Map<number, AbortController>()

port.on('message', async (message: ImportMessage) => {
    const {id} = message
    if ('cancel' in message) {
        controllers.get(id)?.abort()
        return
    }
    const {job} = message
    let error: ImportReply['error']
    let fetchedAt: string | null = null
    try {
        if (job.kind == 'photos') storage.syncPhotos()
        else {
            if (job.kind == 'refresh') {
                const controller = new AbortController()
                controllers.set(id, controller)
                await refreshAndSavePlaceDestination(job.destination, job.source, {signal: controller.signal})
            }
            storage.syncSource(job.destination, job.source)
            fetchedAt = storage.index.meta(job.destination, job.source)?.fetchedAt ?? null
        }
    } catch (cause) {
        const status = cause && typeof cause == 'object' && 'status' in cause ? cause.status : undefined
        error = {message: cause instanceof Error ? cause.message : String(cause)}
        if (typeof status == 'number') error.status = status
    } finally {
        controllers.delete(id)
    }
    port.postMessage({id, fetchedAt, error, writes: storage.index.stats().writes} satisfies ImportReply)
})

port.on('close', () => {
    for (const controller of controllers.values()) controller.abort()
    storage.close()
})

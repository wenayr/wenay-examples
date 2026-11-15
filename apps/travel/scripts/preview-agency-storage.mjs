import {mkdir, readFile, rename, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {createHash, randomUUID} from 'node:crypto'

const writesByDirectory = new Map()

// This adapter is imported only by the Node preview host. Production uses native R2.
export function createPreviewAgencyStorage(directory) {
    const directoryKey = path.resolve(directory)
    function filename(key) { return path.join(directory, createHash('sha256').update(key).digest('hex') + '.json') }
    async function read(key) {
        try {
            const stored = await readFile(filename(key), 'utf8')
            let value = stored
            let customMetadata = {}
            const envelope = JSON.parse(stored)
            if (envelope.__previewR2 == 1 && typeof envelope.value == 'string') {
                value = envelope.value
                customMetadata = envelope.customMetadata ?? {}
            }
            return {value, customMetadata, etag: createHash('sha256').update(stored).digest('hex')}
        } catch (error) {
            if (error.code == 'ENOENT') return null
            throw error
        }
    }
    async function get(key) {
        const entry = await read(key)
        return entry ? {etag: entry.etag, customMetadata: entry.customMetadata,
            size: Buffer.byteLength(entry.value), text: async () => entry.value} : null
    }
    async function head(key) {
        const entry = await read(key)
        return entry ? {etag: entry.etag, customMetadata: entry.customMetadata, size: Buffer.byteLength(entry.value)} : null
    }
    function put(key, value, options) {
        async function persist() {
            const current = await read(key)
            const onlyIf = options.onlyIf
            const expected = onlyIf.get('if-match')?.replace(/^"|"$/g, '')
            if (onlyIf.get('if-none-match') == '*' && current) return null
            if (expected && expected != current?.etag) return null
            await mkdir(directory, {recursive: true, mode: 0o700})
            const target = filename(key)
            const temp = target + '.' + randomUUID() + '.tmp'
            const stored = JSON.stringify({__previewR2: 1, value, customMetadata: options.customMetadata ?? {}})
            await writeFile(temp, stored, {mode: 0o600})
            await rename(temp, target)
            return {etag: createHash('sha256').update(stored).digest('hex')}
        }
        const result = (writesByDirectory.get(directoryKey) ?? Promise.resolve()).then(persist)
        const settled = result.then(() => {}, () => {})
        writesByDirectory.set(directoryKey, settled)
        void settled.finally(() => {
            if (writesByDirectory.get(directoryKey) == settled) writesByDirectory.delete(directoryKey)
        })
        return result
    }
    return {get, head, put}
}

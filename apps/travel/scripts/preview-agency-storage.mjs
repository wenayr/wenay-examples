import {mkdir, readFile, rename, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {createHash, randomUUID} from 'node:crypto'

// This adapter is imported only by the Node preview host. Production uses native R2.
export function createPreviewAgencyStorage(directory) {
    let tail = Promise.resolve()
    function filename(key) { return path.join(directory, createHash('sha256').update(key).digest('hex') + '.json') }
    async function read(key) {
        try {
            const value = await readFile(filename(key), 'utf8')
            return {value, etag: createHash('sha256').update(value).digest('hex')}
        } catch (error) {
            if (error.code == 'ENOENT') return null
            throw error
        }
    }
    async function get(key) {
        const entry = await read(key)
        return entry ? {etag: entry.etag, text: async () => entry.value} : null
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
            await writeFile(temp, value, {mode: 0o600})
            await rename(temp, target)
            return {etag: createHash('sha256').update(value).digest('hex')}
        }
        const result = tail.then(persist)
        tail = result.then(() => {}, () => {})
        return result
    }
    return {get, put}
}

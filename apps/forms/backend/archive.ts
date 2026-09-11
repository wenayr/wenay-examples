import path from 'node:path'
import {mkdirSync, openSync, closeSync, fsyncSync} from 'node:fs'
import {openFsReplayStorage} from 'wenay-common2/server/fs'
import type {StorePatch} from 'wenay-common2/observe'
import type {createServiceLeader} from 'wenay-common2/service/server'
import type {formsDefinition} from './service'

// Retention is application policy; current keyframes and on-disk compaction are public library mechanisms.
export function createFormsArchive(deps: {directory: string}) {
    mkdirSync(deps.directory, {recursive: true})
    const file = path.join(deps.directory, 'forms.jsonl'), storage = openFsReplayStorage<[readonly StorePatch[]]>(file)
    function mount(leader: ReturnType<typeof createServiceLeader<typeof formsDefinition>>) {
        let previous = -1, scheduled = false, closed = false
        function compact() {
            const revision = leader.line.control.store.state.erasureRevision ?? 0
            if (revision == previous) return
            const frame = leader.line.api.replay.keyframe()
            if (!frame || frame.seq != leader.line.api.replay.head()) throw new Error('Нельзя очистить архив без актуального снимка')
            storage.putKeyframe(frame)
            storage.compact()
            const descriptor = openSync(file, 'r+')
            try {fsyncSync(descriptor)} finally {closeSync(descriptor)}
            previous = revision
        }
        function request() {
            if (scheduled || closed) return
            scheduled = true
            queueMicrotask(function purgeOldSnapshots() {
                scheduled = false
                if (!closed) compact()
            })
        }
        const off = leader.line.control.store.on(request)
        request()
        return function close() {closed = true; off(); compact()}
    }
    return {durable: {storage}, mount}
}

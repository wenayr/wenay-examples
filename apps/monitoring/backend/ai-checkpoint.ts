import {mkdirSync, openSync, fsyncSync, closeSync} from 'node:fs'
import path from 'node:path'
import {serialize, deserialize} from 'node:v8'
import {openFsReplayStorage} from 'wenay-common2/server/fs'
import type {AiRunCheckpoint, AiRunPersistencePort} from 'wenay-common2/ai'

// Public replay storage owns torn-append recovery; the application acknowledges a local flush.
export function openAiCheckpoint(deps: {directory?: string}) {
    if (!deps.directory) return {}
    mkdirSync(deps.directory, {recursive: true})
    const file = path.join(deps.directory, 'runs.replay')
    const descriptor = openSync(file, 'a', 0o600)
    closeSync(descriptor)
    const storage = openFsReplayStorage<[AiRunCheckpoint]>(file, {codec: {
        stringify: value => serialize(value).toString('base64'),
        parse: line => deserialize(Buffer.from(line, 'base64')),
    }})
    const initial = storage.getKeyframe()?.event[0]
    const persistence: AiRunPersistencePort = {commit(checkpoint) {
        storage.putKeyframe({seq: checkpoint.revision, ts: Date.now(), event: [checkpoint]})
        const descriptor = openSync(file, 'r+')
        try {fsyncSync(descriptor)} finally {closeSync(descriptor)}
    }}
    return {initial, persistence}
}

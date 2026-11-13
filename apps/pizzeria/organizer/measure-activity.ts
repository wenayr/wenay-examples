import {createServiceClient, describeService} from 'wenay-common2/service/client'
import {organizerDefinition} from './service'
import {notePosition} from './canvas-model'

// Local demonstration only: publishes ephemeral movement, never edits the archive.
async function main() {
    const url = process.argv[2]
    if (!url || !/^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(url)) throw new Error('Provide the localhost URL of the organizer demo')
    const client = createServiceClient({
        definition: describeService(organizerDefinition),
        url,
        auth: {credentials: {account: 'worker', password: 'worker-pass'}}
    })
    const resource = client.resources.open('board')
    try {
        await client.ready()
        await client.views.work.ready
        const note = Object.values(client.views.work.store.state.canvas?.notes ?? {})[0]
        if (!note) throw new Error('Create a note on the demo board first')
        const until = Date.now() + 10000
        while (resource.status.state.phase != 'ready') {
            if (Date.now() > until) throw new Error('Resource did not become ready')
            await new Promise(resolve => setTimeout(resolve, 20))
        }
        const remote = resource.current()!.remote
        let accepted = 0
        const started = Date.now()
        for (let i = 0; i < 400; i++) {
            const point = notePosition({...note, x: note.x + 160 + 150 * Math.sin(i / 30), y: note.y + 160 + 100 * Math.cos(i / 30)})
            if (await remote.control.update({
                surface: 'canvas',
                selected: note.id,
                cursor: null,
                drag: {kind: 'note', id: note.id, revision: note.revision, ...point}
            })) accepted++
            await new Promise(resolve => setTimeout(resolve, 10))
        }
        console.log(JSON.stringify({sent: 400, accepted, elapsedMs: Date.now() - started}))
    } finally {await resource.close()
    client.close()}
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})

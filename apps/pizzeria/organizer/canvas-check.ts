import assert from 'node:assert/strict'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {createServiceClient, describeService} from 'wenay-common2/service/client'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createServiceLeader} from 'wenay-common2/service/server'
import {createStore, syncStoreReplayBatch} from 'wenay-common2/observe'
import {createOrganizerService} from './service'
import {createPizzeriaService} from '../backend/service'
import {cleanActivity, projectActivity} from './activity'
import {BOARD_INTERVAL, type BoardPresence} from './collaboration-model'

async function waitFor(label: string, check: () => boolean) {
    const until = Date.now() + 10000
    while (!check()) {
        assert(Date.now() < until, 'Timeout: ' + label)
        await new Promise(resolve => setTimeout(resolve, 15))
    }
}

async function main() {
    const root = realpathSync(tmpdir())
    const directory = mkdtempSync(path.join(root, 'canvas-check-'))
    const env = {SERVICE_PORT: '0', SERVICE_DATA_DIR: directory}
    const old = createOrganizerService()
    const legacy = await createServiceLeaderHost({definition: {...old.definition, version: 1}, env, rest: false,
        mount: ({leader}) => old.mount(leader.line.control.store)})
    await legacy.close()
    const service = createOrganizerService()
    const host = await createServiceLeaderHost({definition: service.definition, env, rest: false,
        mount: ({leader}) => service.mount(leader.line.control.store)})
    const client = (account: string) => createServiceClient({definition: describeService(service.definition), url: host.url,
        auth: {token: host.leader.identity.login(account).token}})
    const owner = client('owner'), worker = client('worker')
    const a = owner.resources.open('board'), b = worker.resources.open('board')
    const mirror = createStore<BoardPresence>({self: '', participants: []})
    let closeMirror = () => {}
    const streamErrors: unknown[] = []
    const draft = {id: '', revision: 0, text: 'План смены', color: 'sand' as const, x: 40, y: 40, width: 240, height: 180}
    let savedId = ''
    try {
        await owner.ready()
        await worker.ready()
        await owner.views.work.ready
        await worker.views.work.ready
        assert.deepEqual(host.leader.line.control.store.state.organizer.canvas?.notes, {})
        const note = await worker.commands.canvasSave('note-1', draft)
        savedId = note.id
        assert.deepEqual(await worker.commands.canvasSave('note-1', draft), note)
        const other = await owner.commands.canvasSave('note-2', {...draft, text: 'Проверка результата', x: 480, color: 'mint'})
        await waitFor('both collaborators see notes', () => Object.keys(worker.views.work.store.state.canvas?.notes ?? {}).length == 2)
        const link = await owner.commands.canvasConnect('link-1', {from: note.id, to: other.id})
        assert.deepEqual(await owner.commands.canvasConnect('link-1', {from: note.id, to: other.id}), link)
        const races = await Promise.allSettled([
            owner.commands.canvasMove('move-owner', {id: note.id, revision: 1, x: 120, y: 90}),
            worker.commands.canvasMove('move-worker', {id: note.id, revision: 1, x: 210, y: 140}),
        ])
        assert.equal(races.filter(result => result.status == 'fulfilled').length, 1)
        assert.match(String((races.find(result => result.status == 'rejected') as PromiseRejectedResult).reason), /уже изменена/)
        await waitFor('same canonical position', function agreed() {
            const first = owner.views.work.store.state.canvas?.notes[note.id]?.revision
            const second = worker.views.work.store.state.canvas?.notes[note.id]?.revision
            return first == 2 && second == 2
        })
        assert.deepEqual(owner.views.work.store.snapshot().canvas, worker.views.work.store.snapshot().canvas)
        await Promise.all([
            owner.commands.canvasMove('different-a', {id: note.id, revision: 2, x: 150, y: 150}),
            worker.commands.canvasMove('different-b', {id: other.id, revision: 1, x: 500, y: 170}),
        ])
        await assert.rejects(owner.commands.canvasSave('stale-text', {...draft, id: note.id, revision: 1}), /уже изменена/)
        await assert.rejects(owner.commands.canvasMove('outside-board', {id: note.id, revision: 3, x: 1590, y: 0}), /внутри/)
        await assert.rejects(worker.commands.canvasSave('bad-size', {...draft, width: 5}), /Размер/)
        await assert.rejects(worker.commands.canvasConnect('bad-link', {from: note.id, to: 'missing'}), /существующие/)
        await waitFor('presence ready', () => a.status.state.phase == 'ready' && b.status.state.phase == 'ready')
        const remote = a.current()!.remote
        const sync = syncStoreReplayBatch(mirror, b.current()!.remote.view, {onError: error => streamErrors.push(error)})
        closeMirror = sync
        await sync.ready
        const drag = {kind: 'note' as const, id: note.id, revision: 3, x: 300, y: 250}
        await remote.control.update({surface: 'canvas', selected: note.id, cursor: null, drag})
        await waitFor('foreign note preview', () => mirror.state.participants.some(person => person.drag?.id == note.id))
        const canonical = host.leader.line.control.store.snapshot().organizer
        let updates = 0, bytes = 0
        const off = mirror.on(function received() {
            updates++
            bytes += Buffer.byteLength(JSON.stringify(mirror.snapshot()))
        })
        const start = Date.now()
        let admitted = 0
        let lastX = drag.x
        for (let i = 0; i < 250; i++) {
            if (i % 25 == 0) await new Promise(resolve => setTimeout(resolve, 95))
            if (await remote.control.update({surface: 'canvas', selected: note.id, cursor: null, drag: {...drag, x: 300 + i}})) {
                admitted++
                lastX = 300 + i
            }
        }
        await waitFor('last admitted frame delivered', () => mirror.state.participants.some(person => person.drag?.id == note.id && person.drag.x == lastX))
        const elapsed = Date.now() - start
        assert(admitted >= 8, 'paced publication remains live under bursts')
        assert(admitted <= Math.ceil(elapsed / BOARD_INTERVAL) + 1)
        assert.deepEqual(host.leader.line.control.store.snapshot().organizer, canonical)
        off()
        console.log(`PASS S2 bounded activity: 250 sequential RPC publications / ${elapsed} ms; admitted ${admitted}; observed ${updates} projected Store updates, ${bytes} JSON bytes (not transport framing); durable state unchanged`)
        await worker.commands.canvasMove('invalidate-preview', {id: note.id, revision: 3, x: 180, y: 180})
        await waitFor('stale preview cleared on canonical revision', () => mirror.state.participants.every(person => person.drag?.id != note.id))
        await owner.commands.canvasDelete('delete-target', {id: other.id, revision: 2})
        assert.equal(host.leader.line.control.store.state.organizer.canvas!.links[link.id], undefined)
        await assert.rejects(worker.commands.canvasMove('deleted-move', {id: other.id, revision: 2, x: 0, y: 0}), /удалена/)
        const view = service.definition.views.work.project(host.leader.line.control.store.state, {account: 'owner', roles: ['owner']})
        assert.equal(projectActivity({
            activity: {surface: 'canvas', selected: other.id, cursor: null, drag: {...drag, id: other.id}},
            source: view,
            viewer: view
        }).drag, null)
        assert.throws(() => cleanActivity({selected: '', cursor: null, drag: {...drag, x: NaN}}), /Invalid/)
        assert.equal(streamErrors.length, 0)
        console.log('PASS S2 canvas: migrated v1 archive, two RPC writers, shared editor roles, same/different object races, receipt retry, stale edit, bounds, links and delete during preview')
    } finally {
        closeMirror()
        await a.close()
        await b.close()
        owner.close()
        worker.close()
        await host.close()
    }
    const restored = createOrganizerService()
    const again = await createServiceLeaderHost({definition: restored.definition, env, rest: false,
        mount: ({leader}) => restored.mount(leader.line.control.store)})
    try {
        assert.equal(again.leader.line.control.store.state.organizer.canvas?.notes[savedId]?.x, 180)
        assert.equal(again.leader.line.control.store.state.organizer.canvas?.notes[savedId]?.text, draft.text)
        console.log('PASS S2 canvas durable restart: text, geometry and revision restored')
    } finally {
        await again.close()
        const resolved = realpathSync(directory)
        assert.equal(path.dirname(resolved), root)
        assert(path.basename(resolved).startsWith('canvas-check-'))
        rmSync(resolved, {recursive: true})
    }
    const pizza = createServiceLeader({definition: createPizzeriaService().definition, selfUrl: () => 'http://localhost'})
    try {
        await assert.rejects(pizza.corridor.execute('alice', 'canvasSave', 'customer-denied', draft), /forbidden/)
        await pizza.corridor.execute('chef', 'canvasSave', 'cook-note', draft)
        console.log('PASS S2 pizzeria: customer denied, cook can create a shared note')
    } finally {await pizza.control.close()}
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})

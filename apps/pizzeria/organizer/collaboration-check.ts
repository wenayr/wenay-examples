import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {createStore, syncStoreReplayBatch} from 'wenay-common2/observe'
import {createServiceClient, describeService, type ServiceResourceController} from 'wenay-common2/service/client'
import {createServiceLeaderHost, createServiceNodeHost} from 'wenay-common2/service/host'
import {createOrganizerService} from './service'
import {createPizzeriaService} from '../backend/service'
import type {BoardFacade} from './collaboration-resource'
import type {BoardActivity, BoardPresence} from './collaboration-model'

async function waitFor(label: string, check: () => boolean) {
    const until = Date.now() + 15000
    while (!check()) {
        if (Date.now() > until) throw new Error('Timeout: ' + label)
        await new Promise(resolve => setTimeout(resolve, 20))
    }
}

async function main() {
    const service = createOrganizerService()
    const isolated = createOrganizerService()
    const env = {SERVICE_PORT: '0', SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')}
    const start = (definition = service.definition) => createServiceLeaderHost({definition, env, rest: false,
        mount: ({leader}) => service.mount(leader.line.control.store)})
    let host = await start()
    const node = await createServiceNodeHost({definition: service.definition, env: {...env, SERVICE_UPSTREAM: host.url, SERVICE_NODE_ID: 'sc1-node'}})
    const otherHost = await createServiceLeaderHost({definition: isolated.definition, env: {SERVICE_PORT: '0'}, rest: false,
        mount: ({leader}) => isolated.mount(leader.line.control.store)})
    const clients: ReturnType<typeof createServiceClient<typeof service.definition>>[] = []
    const controllers: ServiceResourceController<BoardFacade>[] = []
    const mirrors: (() => void)[] = []
    const streamErrors: unknown[] = []
    function client(account: string, target = host) {
        const client = createServiceClient({definition: describeService(service.definition), url: target.url,
            auth: {token: target.leader.identity.login(account).token}, placement: {prefer: 'nodes'}})
        clients.push(client)
        return client
    }
    async function open(client: typeof clients[number]) {
        await client.ready()
        const resource = client.resources.open('board')
        controllers.push(resource)
        await waitFor('resource ready', () => resource.status.state.phase == 'ready')
        const current = resource.current()!
        const store = createStore<BoardPresence>({self: '', participants: []})
        const sync = syncStoreReplayBatch(store, current.remote.view, {onError: error => streamErrors.push(error)})
        mirrors.push(sync)
        await sync.ready
        return {resource, current, store}
    }
    async function publish(remote: ReturnType<ServiceResourceController<BoardFacade>['current']>, activity: BoardActivity) {
        const until = Date.now() + 2000
        while (!await remote!.remote.control.update(activity)) {
            if (Date.now() > until) throw new Error('Activity admission timeout')
            await new Promise(resolve => setTimeout(resolve, 90))
        }
    }
    try {
        const owner = client('owner')
        const worker = client('worker')
        await owner.ready()
        await owner.views.work.ready
        const first = await open(owner)
        const second = await open(owner)
        const member = await open(worker)
        const elsewhere = await open(client('owner', otherHost))
        await waitFor('three independent owners', () => first.store.state.participants.length == 3)
        await waitFor('ordinary view on serving node', () => owner.health.state.nodeId == 'sc1-node')
        assert.notEqual(first.store.state.self, second.store.state.self)
        assert.equal(elsewhere.store.state.participants.length, 1)
        const draft = {id: '', revision: 0, title: 'Visible task', description: '', assignee: 'worker', due: '', priority: 'normal' as const, sourceId: '', checklist: []}
        const shared = await owner.commands.workSaveTask('collab-shared', draft)
        const secret = await owner.commands.workSaveTask('collab-private', {...draft, title: 'Private task', assignee: 'manager'})
        const preview = {kind: 'task' as const, id: shared.id, revision: shared.revision, col: 'todo', before: secret.id, x: 0.4, y: 0.7}
        const durable = host.leader.line.control.store.snapshot().organizer
        await publish(first.current, {selected: shared.id, cursor: null, drag: preview})
        await waitFor('foreign task preview', () => member.store.state.participants.some(person => person.drag?.id == shared.id))
        assert.equal(member.store.state.participants.find(person => person.drag?.id == shared.id)?.drag?.kind, 'task')
        assert(!JSON.stringify(member.store.snapshot()).includes(secret.id), 'private insertion anchor is removed server-side')
        assert.deepEqual(host.leader.line.control.store.snapshot().organizer, durable)
        await publish(member.current, {selected: shared.id, cursor: null, drag: {...preview, before: ''}})
        await waitFor('simultaneous grabs remain advisory', () => second.store.state.participants.filter(person => person.drag?.id == shared.id).length == 2)
        await publish(member.current, {selected: '', cursor: null, drag: null})
        await publish(first.current, {selected: shared.id, cursor: {task: shared.id, x: 0.25, y: 0.75}})
        await waitFor('visible selection and relative cursor', () => member.store.state.participants.some(person => person.selected == shared.id && person.cursor?.x == 0.25))
        await publish(first.current, {selected: secret.id, cursor: {task: secret.id, x: 0.8, y: 0.3}})
        await waitFor('private selection for owner', () => second.store.state.participants.some(person => person.selected == secret.id))
        assert(!JSON.stringify(member.store.snapshot()).includes(secret.id))
        await publish(member.current, {selected: secret.id, cursor: {task: secret.id, x: 0, y: 0}})
        assert.equal(first.store.state.participants.find(person => person.id == member.store.state.self)?.selected, '')
        await publish(first.current, {selected: shared.id, cursor: {task: shared.id, x: 0.5, y: 0.5}})
        await owner.commands.workSaveTask('collab-reassign', {...draft, id: shared.id, revision: shared.revision, assignee: 'manager'})
        await waitFor('assignment cut clears cursor without role change', () => member.store.state.participants.every(person => person.selected != shared.id && person.cursor?.task != shared.id))
        const retained = member.current.remote
        assert.equal(streamErrors.length, 0)
        host.leader.line.control.store.state.accounts.worker.roles = []
        await waitFor('revoked scope', () => member.resource.status.state.phase == 'denied')
        const revokedSnapshot = member.store.snapshot()
        await assert.rejects(retained.view.keyframe())
        await assert.rejects(retained.control.update({selected: '', cursor: null}))
        await publish(first.current, {selected: secret.id, cursor: null})
        await waitFor('remaining subscription still delivers', () => second.store.state.participants.some(person => person.selected == secret.id))
        assert.deepEqual(member.store.snapshot(), revokedSnapshot)
        host.leader.line.control.store.state.accounts.worker.roles = ['member']
        await waitFor('regranted fresh generation', () => member.resource.status.state.phase == 'ready' && member.resource.status.state.generation > member.current.generation)
        await assert.rejects(retained.view.keyframe())
        await first.resource.close()
        await waitFor('closing one tab preserves sibling', () => second.store.state.participants.length == 2)
        assert.equal((await owner.identity.me()).account, 'owner')
        host.leader.control.drain('sc1-node')
        await node.close()
        await waitFor('ordinary view falls back to authority', () => owner.health.state.nodeId == 'leader')
        assert.equal(second.resource.current()?.remote, second.current.remote)
        assert.equal(second.resource.current()?.generation, second.current.generation)
        await publish(second.current, {selected: secret.id, cursor: null})
        await waitFor('idle activity expires without transport close', () => second.store.state.participants.length == 0)
        assert.equal(second.resource.status.state.phase, 'ready')
        await publish(second.current, {selected: secret.id, cursor: null})
        await waitFor('heartbeat restores presence', () => second.store.state.participants.length == 1)
        await publish(second.current, {selected: secret.id, cursor: null, drag: {...preview, id: secret.id, revision: secret.revision, before: ''}})
        await waitFor('active drag before restart', () => second.store.state.participants.some(person => person.drag?.id == secret.id))
        const old = second.current
        const snapshot = host.leader.line.control.store.snapshot()
        const port = new URL(host.url).port
        await host.close()
        await node.close()
        await waitFor('offline clears current', () => second.resource.current() == null)
        env.SERVICE_PORT = port
        host = await start({...service.definition, initial: snapshot})
        await waitFor('transport reconnect recreates resource', () => second.resource.status.state.phase == 'ready' && second.resource.status.state.generation > old.generation)
        await assert.rejects(old.remote.control.update({selected: secret.id, cursor: null}))
        await assert.rejects(old.remote.view.keyframe())
        const fresh = second.resource.current()!
        const restartedStore = createStore<BoardPresence>({self: '', participants: []})
        const restartedSync = syncStoreReplayBatch(restartedStore, fresh.remote.view, {onError: error => streamErrors.push(error)})
        mirrors.push(restartedSync)
        await restartedSync.ready
        assert(restartedStore.state.participants.every(person => person.drag == null), 'a fresh generation never restores the old drag')
        await publish(fresh, {selected: secret.id, cursor: null})
        console.log('PASS SC1 organizer: real RPC, independent tabs/hosts, trusted identities, private tasks, reassignment, revoke/regrant, retained reads/writes, authority restart and fresh generations')
    } finally {
        mirrors.forEach(close => close())
        await Promise.all(controllers.map(resource => resource.close()))
        clients.forEach(client => client.close())
        await node.close()
        await host.close()
        await otherHost.close()
    }

    const pizza = createPizzeriaService()
    const pizzaHost = await createServiceLeaderHost({definition: pizza.definition, env: {SERVICE_PORT: '0'}, rest: false,
        mount: ({leader}) => pizza.mount(leader.line.control.store)})
    const customer = createServiceClient({definition: describeService(pizza.definition), url: pizzaHost.url, auth: {token: pizzaHost.leader.identity.login('alice').token}})
    const cook = createServiceClient({definition: describeService(pizza.definition), url: pizzaHost.url, auth: {token: pizzaHost.leader.identity.login('chef').token}})
    const forbidden = customer.resources.open('board')
    const allowed = cook.resources.open('board')
    try {
        await waitFor('pizza cook can open', () => allowed.status.state.phase == 'ready')
        await waitFor('pizza customer cannot open', () => forbidden.status.state.phase == 'denied')
        assert.equal(forbidden.current(), null)
        console.log('PASS SC1 pizzeria: same board resource, cook allowed, customer denied')
    } finally {
        await allowed.close()
        await forbidden.close()
        customer.close()
        cook.close()
        await pizzaHost.close()
    }
}

main().catch(function failed(error) {console.error(error); process.exitCode = 1})

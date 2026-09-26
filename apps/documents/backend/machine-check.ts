import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, rmSync, readdirSync} from 'node:fs'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createServiceClient, describeService} from 'wenay-common2/service/client'
import {createDocumentRuntime} from './runtime'
import {createDocumentProductHttp} from './product-http'
import {parseText, type ExtractInput} from './processing-resource'
import {openAiCheckpoint} from './ai-checkpoint'
import {createProductCredentials} from './product-credentials'
import {organizationAccess} from './domain'

function barrier() {
    let release = () => {}
    let entered = () => {}
    const ready = new Promise<void>(resolve => {entered = resolve})
    const waiting = new Promise<void>(resolve => {release = resolve})
    return {ready, release, async wait() {entered()
        await waiting
    }}
}

async function waitFor(label: string, test: () => boolean) {
    const deadline = Date.now() + 6000
    while (!test()) {
        assert(Date.now() < deadline, 'Timeout: ' + label)
        await delay(10)
    }
}

async function main() {
    const parent = path.resolve('.test-data')
    mkdirSync(parent, {recursive: true})
    const directory = mkdtempSync(path.join(parent, 'documents-machine-'))
    const env = {SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: directory,
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')}
    let clockOffset = 0
    let calls = 0
    let nextBarrier: ReturnType<typeof barrier> | null = null
    let observedSignal: AbortSignal | undefined
    let afterImport: ReturnType<typeof barrier> | null = null
    const barriers: ReturnType<typeof barrier>[] = []
    const clients: {close(): void}[] = []
    const resources: {close(): Promise<void>}[] = []
    let runtime = createDocumentRuntime()
    async function startHost() {
        runtime = createDocumentRuntime({directory: path.join(directory, 'processing'), now: () => Date.now() + clockOffset,
            processor: {async extract(input: ExtractInput) {
                calls++
                observedSignal = input.signal
                const blocked = nextBarrier
                nextBarrier = null
                await blocked?.wait()
                // Deliberately ignore cancellation: the application must reject a late executor result.
                return parseText(input.name, input.bytes)
            }}})
        return createServiceLeaderHost({definition: runtime.definition, env, mount({app, leader}) {
            createDocumentProductHttp({app, resource: runtime.definition.resources.productDocuments,
                account: token => leader.access.principalOf(leader.identity.principal(token)).account})
            const system = leader.corridor.system
            return runtime.mount({store: leader.line.control.store, execute: {...system, async documentImport(requestId, input) {
                const result = await system.documentImport(requestId, input)
                const blocked = afterImport
                afterImport = null
                await blocked?.wait()
                return result
            }}})
        }})
    }
    let host: Awaited<ReturnType<typeof startHost>> | undefined
    async function connect(account: string, password: string) {
        const client = createServiceClient({definition: describeService(runtime.definition), url: host!.url,
            auth: {credentials: {account, password}}, log() {}})
        clients.push(client)
        await client.ready()
        return client
    }
    type Client = Awaited<ReturnType<typeof connect>>
    async function keys(session: Client) {
        const resource = session.resources.open('productKeys')
        resources.push(resource)
        await waitFor('owner keys resource', () => !!resource.current())
        return resource.current()!.remote.control
    }
    async function documents(session: Client) {
        const resource = session.resources.open('productDocuments')
        resources.push(resource)
        await waitFor('machine documents resource', () => !!resource.current())
        return {resource, control: resource.current()!.remote.control}
    }
    function context(account: string, signal = new AbortController().signal) {
        return {principal: host!.leader.access.principalOf({account}), sessionId: account, resourceId: 'machine-check', signal}
    }
    async function login(account: string, password: string) {
        const response = await fetch(host!.url + '/api/documents/login', {method: 'POST',
            headers: {'content-type': 'application/json'}, body: JSON.stringify({args: [{account, password}]})})
        return response.json()
    }
    async function http(method: string, token: string, input: unknown, args?: unknown[], signal?: AbortSignal) {
        const response = await fetch(host!.url + '/api/product/documents/' + method, {method: 'POST',
            headers: {'content-type': 'application/json', authorization: 'Bearer ' + token}, body: JSON.stringify({args: args ?? [input]}), signal})
        return {status: response.status, body: await response.json()}
    }
    function block() {
        const gate = barrier()
        barriers.push(gate)
        nextBarrier = gate
        return gate
    }
    const orgId = 'northstar'
    const issue = {orgId, label: 'Machine extraction', days: 90, scopes: ['documents:extract'] as ['documents:extract']}
    const bytes = Buffer.from('name,amount\nMachine,42')
    try {
        host = await startHost()
        const owner = await connect('owner', 'owner-pass')
        const ownerKeys = await keys(owner)
        const issued = await ownerKeys.issue({...issue, requestId: 'machine-main'})
        assert(issued.secret)
        assert.equal((await ownerKeys.issue({...issue, requestId: 'machine-main'})).secret, null)
        await assert.rejects(ownerKeys.issue({...issue, requestId: 'machine-main', label: 'Changed payload'}))
        await assert.rejects(ownerKeys.issue({...issue, requestId: 'too-long', days: 91}))
        await assert.rejects(ownerKeys.issue({...issue, requestId: 'other-org', orgId: 'harbor'}))
        const state = host.leader.line.control.store.state
        assert(!state.accounts[issued.account])
        assert(!state.organizations[orgId].members[issued.account])
        assert.equal(state.productKeys![issued.id].hash.length, 64)
        assert(!JSON.stringify(await ownerKeys.list({orgId})).includes(state.productKeys![issued.id].hash))
        assert(!JSON.stringify(host.leader.access.snapshot('workspace', context('owner').principal)).includes(issued.secret))
        const machine = await connect(issued.account, issued.secret)
        const permission = host.leader.access.principalOf({account: issued.account})
        assert.deepEqual(permission.roles, ['documents:extract'])
        const allowed = host.leader.access.rights(permission)
        assert.deepEqual(allowed.resources, ['productDocuments'])
        assert.deepEqual(allowed.commands, [])
        assert.deepEqual(allowed.views, [])
        const machineDocuments = await documents(machine)
        const control = machineDocuments.control
        for (const name of ['processor', 'productKeys'] as const) {
            const denied = machine.resources.open(name)
            resources.push(denied)
            await waitFor('machine cannot open ' + name, () => denied.status.state.phase == 'denied')
            assert.equal(denied.current(), null)
        }
        const uploaded = await control.upload({orgId, name: 'main.csv', bytes})
        await assert.rejects(async function unavailableReview() {
            await Reflect.get(control, 'approve')({orgId, id: uploaded.id})
        })
        await assert.rejects(async function unavailableRawAi() {
            await Reflect.get(machineDocuments.resource.current()!.remote, 'ai').createRun({requestId: 'forbidden-ai'})
        })
        assert.equal((await control.upload({orgId, name: 'main.csv', bytes})).id, uploaded.id)
        await assert.rejects(control.upload({orgId: 'harbor', name: 'wrong.csv', bytes}))
        const startInput = Object.freeze({orgId, ...uploaded, processor: 'node', requestId: 'durable-main'})
        const gate = block()
        const accepted = await control.start(startInput)
        await gate.ready
        await machineDocuments.resource.close()
        assert(!observedSignal!.aborted, 'ordinary RPC resource close must keep accepted job alive')
        gate.release()
        await waitFor('ordinary closed job completes', () => state.documents[uploaded.id].status == 'review')
        const restoredResource = await documents(machine)
        assert.equal((await restoredResource.control.start(startInput)).runId, accepted.runId)
        await assert.rejects(restoredResource.control.start({...startInput, processor: 'model'}))
        const detail = await restoredResource.control.result({orgId, id: uploaded.id, revision: state.documents[uploaded.id].revision})
        assert.deepEqual(detail.table.rows, [['Machine', '42']])
        assert(!JSON.stringify(detail).includes('blobId'))
        assert(!JSON.stringify(detail).includes('approvals'))
        const other = await ownerKeys.issue({...issue, requestId: 'other-machine'})
        const otherSession = await connect(other.account, other.secret!)
        const otherDocuments = await documents(otherSession)
        await assert.rejects(otherDocuments.control.status({orgId, id: uploaded.id}))
        const authentication = await login(issued.account, issued.secret)
        assert(authentication.ok)
        const token = authentication.value.token
        const reference = {orgId, id: uploaded.id}
        assert((await http('status', token, reference)).body.ok)
        assert.equal((await http('status', token, reference, ['owner', reference])).status, 400)
        const httpUpload = await http('upload', token, {orgId, name: 'http.csv', base64: bytes.toString('base64')})
        assert(httpUpload.body.ok)
        const httpGate = block()
        assert((await http('start', token, {...httpUpload.body.value, orgId, processor: 'node', requestId: 'http-native'})).body.ok)
        await httpGate.ready
        assert(!observedSignal!.aborted, 'ordinary HTTP response close must keep accepted job alive')
        httpGate.release()
        await waitFor('HTTP job completes', () => state.documents[httpUpload.body.value.id].status == 'review')
        const direct = runtime.definition.resources.productDocuments.open(context(issued.account))
        direct.close()
        await assert.rejects(direct.facade.control.status(reference))
        const cancelledContext = new AbortController()
        const abortResource = runtime.definition.resources.productDocuments.open(context(issued.account, cancelledContext.signal))
        cancelledContext.abort()
        await assert.rejects(abortResource.facade.control.status(reference))
        abortResource.close()
        const revoked = await ownerKeys.issue({...issue, requestId: 'revoked-machine'})
        const revokedSession = await connect(revoked.account, revoked.secret!)
        const revocable = await documents(revokedSession)
        const revokedUpload = await revocable.control.upload({orgId, name: 'revoke.csv', bytes})
        const revokeGate = block()
        await revocable.control.start({orgId, ...revokedUpload, processor: 'node', requestId: 'revoke-running'})
        await revokeGate.ready
        const revokedSignal = observedSignal!
        await ownerKeys.revoke({orgId, id: revoked.id})
        await waitFor('revocation aborts processor', () => revokedSignal.aborted)
        await waitFor('revocation settles failed', () => state.documents[revokedUpload.id].status == 'failed')
        revokeGate.release()
        await delay(30)
        assert.equal(state.documents[revokedUpload.id].table.rows.length, 0)
        await assert.rejects(revocable.control.status({orgId, id: revokedUpload.id}))
        assert.equal((await login(revoked.account, revoked.secret!)).ok, false)
        const pendingUpload = await ownerKeys.issue({...issue, requestId: 'upload-barrier'})
        const pendingSession = await connect(pendingUpload.account, pendingUpload.secret!)
        const pendingDocuments = await documents(pendingSession)
        const uploadGate = barrier()
        barriers.push(uploadGate)
        afterImport = uploadGate
        const uploading = pendingDocuments.control.upload({orgId, name: 'barrier.csv', bytes})
        const denied = assert.rejects(uploading)
        await uploadGate.ready
        await ownerKeys.revoke({orgId, id: pendingUpload.id})
        uploadGate.release()
        await denied
        const beforeGarbage = readdirSync(path.join(directory, 'processing', 'blobs'))
        const removable = await restoredResource.control.upload({orgId, name: 'garbage.csv', bytes: Buffer.from('one,two\nUnique,99')})
        const deletedBlob = state.documents[removable.id].blobId
        assert(!beforeGarbage.includes(deletedBlob))
        await owner.commands.documentDelete('machine-cleanup', {orgId, id: removable.id, revision: removable.revision})
        await waitFor('unreferenced machine blob cleanup', () => !readdirSync(path.join(directory, 'processing', 'blobs')).includes(deletedBlob))
        const deadlineGate = barrier()
        barriers.push(deadlineGate)
        afterImport = deadlineGate
        const deadlineStarted = Date.now()
        const deadlineRequest = http('upload', token, {orgId, name: 'deadline.csv', base64: bytes.toString('base64')},
            undefined, AbortSignal.timeout(15000))
        await deadlineGate.ready
        const deadlineResponse = await deadlineRequest
        const elapsed = Date.now() - deadlineStarted
        assert(elapsed >= 11000 && elapsed < 14000, 'real HTTP response bounded by 12s while system await remains blocked')
        assert.equal(deadlineResponse.body.ok, false)
        assert.equal(deadlineResponse.body.value, undefined, 'timeout must not reveal a late import result')
        const committedAtDeadline = Object.values(state.documents).find(document => document.name == 'deadline.csv')!
        assert(committedAtDeadline && committedAtDeadline.owner == issued.account, 'metadata already committed is not rolled back by IO timeout')
        deadlineGate.release()
        // A new queued upload proves the timed-out operation reached its finally and released IO work.
        assert(await restoredResource.control.upload({orgId, name: 'after-deadline.csv', bytes}))
        assert.equal(state.documents[committedAtDeadline.id].status, 'uploaded')
        assert.equal(deadlineResponse.body.value, undefined)
        const expiring = await ownerKeys.issue({...issue, requestId: 'expiry-machine'})
        // Fixture-only shorten expiry before opening the resource; no production credential mutation endpoint exists.
        state.productKeys![expiring.id].expiresAt = Date.now() + 500
        const expirySession = await connect(expiring.account, expiring.secret!)
        const expiryDocuments = await documents(expirySession)
        const expiryUpload = await expiryDocuments.control.upload({orgId, name: 'expiry.csv', bytes})
        const expiryGate = block()
        await expiryDocuments.control.start({orgId, ...expiryUpload, processor: 'node', requestId: 'expiry-running'})
        await expiryGate.ready
        const expirySignal = observedSignal!
        await waitFor('timer expiry aborts without store mutation', () => expirySignal.aborted)
        await waitFor('expiry terminal failed', () => state.documents[expiryUpload.id].status == 'failed')
        expiryGate.release()
        assert.equal((await http('status', (await login(other.account, other.secret!)).value.token, reference)).body.ok, false)
        const recoveryKey = await ownerKeys.issue({...issue, requestId: 'restart-expired', days: 1})
        const recoverySession = await connect(recoveryKey.account, recoveryKey.secret!)
        const recoveryDocuments = await documents(recoverySession)
        const recoveryUpload = await recoveryDocuments.control.upload({orgId, name: 'recovery.csv', bytes})
        const recoveryGate = block()
        const recovering = await recoveryDocuments.control.start({orgId, ...recoveryUpload, processor: 'node', requestId: 'restart-running'})
        await recoveryGate.ready
        const callsBeforeRestart = calls
        for (const resource of resources) await resource.close().catch(function closed() {})
        for (const client of clients) client.close()
        await host.close()
        recoveryGate.release()
        clockOffset = 2 * 86400_000
        host = await startHost()
        await runtime.view.ready()
        const restartedState = host.leader.line.control.store.state
        assert.equal(restartedState.documents[recoveryUpload.id].status, 'uncertain')
        assert.equal(calls, callsBeforeRestart, 'recovery must settle, never duplicate executor')
        assert.equal((await login(recoveryKey.account, recoveryKey.secret!)).ok, false)
        const restoredOwnerKeys = await keys(await connect('owner', 'owner-pass'))
        assert.equal((await restoredOwnerKeys.issue({...issue, requestId: 'machine-main'})).secret, null)
        const restoredMachine = await documents(await connect(issued.account, issued.secret))
        assert.equal((await restoredMachine.control.start(startInput)).runId, accepted.runId)
        const generationKeys = createProductCredentials({authorizeOwner(state, account, orgId) {
            return organizationAccess(state, account, orgId, ['owner'])
        }})
        const mountInput = {store: host.leader.line.control.store, execute: host.leader.corridor.system}
        const disposeOldMount = generationKeys.mount(mountInput)
        const oldGeneration = generationKeys.resource.open(context('owner'))
        assert(oldGeneration.facade.control.list({orgId}).length > 0)
        disposeOldMount()
        const disposeNewMount = generationKeys.mount(mountInput)
        const newGeneration = generationKeys.resource.open(context('owner'))
        assert.throws(() => oldGeneration.facade.control.list({orgId}), 'retained old facade cannot revive')
        disposeOldMount()
        assert(newGeneration.facade.control.list({orgId}).length > 0, 'stale disposer cannot close a newer mount')
        oldGeneration.close()
        newGeneration.close()
        disposeNewMount()
        const checkpoint = openAiCheckpoint({directory: path.join(directory, 'processing', 'runs')}).initial!
        assert.equal(checkpoint.store.runs[recovering.runId].state, 'failed')
        assert(Object.values(checkpoint.store.runs).every(run => !run.recovery), 'restart leaves no blocked native recovery')
        const retainedKeys = runtime.definition.resources.productKeys.open(context('owner'))
        await retainedKeys.facade.control.revoke({orgId, id: other.id})
        await restoredOwnerKeys.issue({...issue, requestId: 'owner-proof'})
        const restartedOwner = await connect('owner', 'owner-pass')
        await restartedOwner.commands.memberRole('give-second-owner', {orgId, account: 'reviewer', role: 'owner'})
        assert.equal(host.leader.line.control.store.state.organizations[orgId].members.reviewer, 'owner')
        // Native command facades are pruned at session creation; connect after the owner grant.
        const secondOwner = await connect('reviewer', 'reviewer-pass')
        await secondOwner.commands.memberRole('drop-old-owner', {orgId, account: 'owner', role: 'uploader'})
        assert.equal(host.leader.line.control.store.state.organizations[orgId].members.owner, 'uploader')
        await assert.rejects(retainedKeys.facade.control.revoke({orgId, id: other.id}), 'current owner checked before a retained native receipt')
        retainedKeys.close()
        console.log('PASS Documents machine RPC/HTTP: scoped identity, hash-only keys, four methods, receipts, close/revoke/expiry, 12s deadline, cleanup and restart')
    } finally {
        for (const gate of barriers) gate.release()
        for (const resource of resources) await resource.close().catch(function closed() {})
        for (const client of clients) client.close()
        await host?.close()
        assert(path.dirname(path.resolve(directory)) == parent && path.basename(directory).startsWith('documents-machine-'))
        rmSync(directory, {recursive: true, force: true})
    }
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})

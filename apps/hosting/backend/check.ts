import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {mkdtemp, realpath, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createServiceClient, describeService, type ServiceClient} from 'wenay-common2/service/client'
import {createHostingDefinition, type AccountConfig} from './service'
import {createHostingRuntime, type HostingRuntimeDefinition} from './runtime'
import {checkPublicOriginGuards} from './public-origin-check'

async function waitFor(check: () => boolean) {
    const deadline = Date.now()+5000
    while (!check()) {
        if (Date.now() > deadline) throw new Error('live projection did not update')
        await new Promise(function tick(resolve) {setTimeout(resolve, 20)})
    }
}

async function main() {
    const root = await realpath(tmpdir())
    const directory = await mkdtemp(path.join(root, 'wenay-hosting-check-'))
    const accounts: AccountConfig[] = [
        {account: 'admin', role: 'admin', projects: []},
        {account: 'owner', role: 'owner', projects: ['shop']},
        {account: 'operator', role: 'operator', projects: ['shop']},
        {account: 'observer', role: 'observer', projects: ['shop']},
        {account: 'outsider', role: 'owner', projects: ['other']},
        {account: 'agent', role: 'agent', projects: ['shop']},
        {account: 'other-agent', role: 'agent', projects: ['other']},
    ].map(account => ({...account, role: account.role as AccountConfig['role'], password: randomBytes(24).toString('hex')}))
    let runtime = createHostingRuntime({accounts})
    const definition = runtime.definition
    assert.throws(() => createHostingDefinition({accounts: [{...accounts[0], password: 'REPLACE-WITH-A-UNIQUE-ADMIN-SECRET'}]}), /replace example passwords/)
    const descriptor = describeService(definition)
    assert(!JSON.stringify(descriptor).includes(accounts[0].password), 'public descriptor excludes credentials')
    const env = {
        SERVICE_PORT: '0',
        SERVICE_DATA_DIR: directory,
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'),
        SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')
    }
    let host = await createServiceLeaderHost({definition, env, mount({leader}) {
        return runtime.mount(leader.line.control.store, leader.corridor.system)
    }})
    const clients: ServiceClient<HostingRuntimeDefinition>[] = []
    async function login(account: string) {
        const entry = accounts.find(item => item.account == account)!
        const client = createServiceClient({definition: descriptor, url: host.url, auth: {credentials: {account, password: entry.password}}})
        clients.push(client)
        await client.ready()
        return client
    }
    async function setOrigin(client: ServiceClient<HostingRuntimeDefinition>, requestId: string, input: {
        environment: string, revision: number, publicOrigin: string
    }) {
        const resource = client.resources.open('publicOrigin')
        try {
            await waitFor(() => !!resource.current() || ['denied', 'failed'].includes(resource.status.state.phase))
            if (!resource.current()) throw new Error('environment unavailable')
            return await resource.current()!.remote.control.set({requestId, ...input})
        } finally {resource.close()}
    }
    async function deniedRest(command: string, args: unknown[], client: ServiceClient<HostingRuntimeDefinition>) {
        const response = await fetch(host.url+'/api/hosting/commands/'+command, {
            method: 'POST',
            headers: {'content-type': 'application/json', authorization: 'Bearer '+client.identity.token()},
            body: JSON.stringify({args})
        })
        const text = await response.text()
        if (response.status == 404) return
        assert.equal(JSON.parse(text).ok, false, 'server must refuse '+command)
    }
    try {
        const admin = await login('admin')
        const owner = await login('owner')
        const operator = await login('operator')
        const observer = await login('observer')
        const outsider = await login('outsider')
        const agent = await login('agent')
        const otherAgent = await login('other-agent')
        await admin.commands.createProject('shop', {id: 'shop', title: 'Shop'})
        await admin.commands.createProject('other', {id: 'other', title: 'Other tenant'})
        await assert.rejects(admin.commands.createProject('reserved', {id: 'constructor', title: 'Reserved'}))
        await owner.commands.createEnvironment('staging', {id: 'staging', project: 'shop', kind: 'virtual-machine', agent: 'agent'})
        await owner.commands.createEnvironment('public-app', {id: 'public-app', project: 'shop', kind: 'docker', agent: 'agent'})
        const publicInput = {environment: 'public-app', revision: 0, publicOrigin: 'https://app.example.test'}
        const invalidOrigins = [
            'http://app.example.test', 'https://user:secret@app.example.test', 'https://app.example.test/',
            'https://app.example.test/path', 'https://app.example.test?x=1', 'https://app.example.test#fragment',
            'https://app.example.test:65536', 'https://app.example.test https://other.example.test', 'https://*.example.test',
            'https://app.example.test,other.example.test'
        ]
        for (const [index, origin] of invalidOrigins.entries()) {
            await assert.rejects(setOrigin(owner, 'invalid-origin-' + index, {...publicInput, publicOrigin: origin}), /HTTPS origin/)
        }
        await assert.rejects(setOrigin(outsider, 'foreign-origin', publicInput), /unavailable/)
        await deniedRest('publicOriginSet', ['observer-origin', publicInput], observer)
        await deniedRest('publicOriginSet', ['operator-origin', publicInput], operator)
        await deniedRest('publicOriginSet', ['agent-origin', publicInput], agent)
        const publicConfigured = await setOrigin(owner, 'public-origin', publicInput)
        assert.equal(publicConfigured.revision, 1)
        assert.deepEqual(await setOrigin(owner, 'public-origin', publicInput), publicConfigured, 'native receipt preserves origin revision')
        await assert.rejects(setOrigin(owner, 'stale-origin', publicInput), /stale/)
        await setOrigin(owner, 'clear-origin', {...publicInput, revision: 1, publicOrigin: ''})
        await setOrigin(owner, 'restore-origin', {...publicInput, revision: 2})
        await agent.commands.registerRoute('public-route', {environment: 'public-app', endpoint: 'http://127.0.0.1:45678'})
        await assert.rejects(agent.commands.registerRoute('public-not-upstream', {
            environment: 'public-app', endpoint: publicInput.publicOrigin
        }), /loopback/)
        await outsider.commands.createEnvironment('other-public-app', {
            id: 'other-public-app', project: 'other', kind: 'docker', agent: 'other-agent'
        })
        await assert.rejects(setOrigin(outsider, 'duplicate-public-origin', {
            environment: 'other-public-app', revision: 0, publicOrigin: publicInput.publicOrigin
        }), /already assigned/)
        await checkPublicOriginGuards(host.leader.line.control.store, host.leader.corridor.system.publicOriginSet)
        await deniedRest('publicOriginSet', ['public-origin', {...publicInput, actor: 'owner'}], owner)
        await deniedRest('setPublicOrigin', ['public-origin', publicInput], owner)
        assert(!Object.hasOwn(descriptor.commands, 'setPublicOrigin'), 'legacy owner/admin origin alias is absent')
        await assert.rejects(owner.commands.createEnvironment('foreign-agent', {
            id: 'bad',
            project: 'shop',
            kind: 'container',
            agent: 'other-agent'
        }), /agent unavailable/)
        const artifact1 = 'registry.example/shop@sha256:'+'a'.repeat(64)
        const artifact2 = 'registry.example/shop@sha256:'+'b'.repeat(64)
        await operator.commands.publishRelease('release-one', {id: 'v-one', project: 'shop', version: '1.0.0', artifact: artifact1})
        await operator.commands.publishRelease('release-two', {id: 'v-two', project: 'shop', version: '2.0.0', artifact: artifact2})
        await assert.rejects(operator.commands.publishRelease('mutable-tag', {
            id: 'latest',
            project: 'shop',
            version: 'latest',
            artifact: 'registry.example/shop:latest'
        }), /digest/)
        await assert.rejects(operator.commands.publishRelease('overwrite', {id: 'v-one', project: 'shop', version: '1.0.1', artifact: artifact2}), /immutable/)
        await assert.rejects(operator.commands.publishRelease('same-version', {
            id: 'new-id',
            project: 'shop',
            version: '1.0.0',
            artifact: artifact2
        }), /immutable/)
        await assert.rejects(outsider.commands.deploy('cross-tenant', {environment: 'staging', release: 'v-one', revision: 0}), /unavailable/)
        await deniedRest('deploy', ['observer-write', {environment: 'staging', release: 'v-one', revision: 0}], observer)
        await deniedRest('publishRelease', ['agent-write', {id: 'forged', project: 'shop', version: '3', artifact: artifact1}], agent)
        assert(!(await observer.identity.me()).commands.includes('deploy'))
        assert(!(await agent.identity.me()).views.includes('dashboard'))
        await observer.views.dashboard.ready
        await outsider.views.dashboard.ready
        await waitFor(() => observer.views.dashboard.store.state.releases?.length == 2)
        assert.equal(outsider.views.dashboard.store.state.releases.length, 0)
        assert(!JSON.stringify(observer.views.dashboard.store.state).includes('password'))
        console.log('PASS role facades, server authorization, project isolation and immutable releases')

        await assert.rejects(owner.commands.rollback('never-successful', {environment: 'staging', release: 'v-one', revision: 0}), /previously successful/)
        const request = {environment: 'staging', release: 'v-one', revision: 0}
        const first = await operator.commands.deploy('deploy-one', request)
        assert.equal((await operator.commands.deploy('deploy-one', request)).id, first.id, 'RPC receipt prevents duplicate operation')
        await assert.rejects(owner.commands.deploy('stale', request), /stale/)
        await assert.rejects(owner.commands.deploy('busy', {...request, revision: 1}), /pending/)
        await assert.rejects(otherAgent.commands.claimOperation('steal', {operation: first.id, revision: 0}), /unavailable/)
        await agent.views.assignments.ready
        await waitFor(() => agent.views.assignments.store.state.operations?.some(item => item.id == first.id))
        await agent.commands.claimOperation('claim-one', {operation: first.id, revision: 0})
        await assert.rejects(agent.commands.finishOperation('wrong-artifact', {
            operation: first.id,
            revision: 1,
            success: true,
            observedArtifact: artifact2,
            detail: ''
        }), /does not match/)
        await agent.commands.finishOperation('finish-one', {
            operation: first.id,
            revision: 1,
            success: true,
            observedArtifact: artifact1,
            detail: 'Protocol test: simulated provider observation'
        })
        await waitFor(() => observer.views.dashboard.store.state.environments[0]?.active == 'v-one')
        const second = await owner.commands.deploy('deploy-two', {environment: 'staging', release: 'v-two', revision: 2})
        await agent.commands.claimOperation('claim-two', {operation: second.id, revision: 0})
        await agent.commands.finishOperation('failed-two', {
            operation: second.id,
            revision: 1,
            success: false,
            observedArtifact: '',
            detail: 'Protocol test: simulated readiness failure'
        })
        await waitFor(() => observer.views.dashboard.store.state.operations.some(item => item.id == second.id && item.status == 'failed'))
        assert.equal(observer.views.dashboard.store.state.environments[0].active, 'v-one', 'failure preserves active release')
        await assert.rejects(agent.commands.finishOperation('late-one', {
            operation: first.id,
            revision: 1,
            success: true,
            observedArtifact: artifact1,
            detail: ''
        }), /stale|no longer/)
        const retry = await owner.commands.deploy('retry-two', {environment: 'staging', release: 'v-two', revision: 4})
        await agent.commands.claimOperation('claim-retry', {operation: retry.id, revision: 0})
        await agent.commands.finishOperation('finish-retry', {
            operation: retry.id,
            revision: 1,
            success: true,
            observedArtifact: artifact2,
            detail: 'Protocol test: simulated healthy version two'
        })
        const rollback = await owner.commands.rollback('rollback-one', {environment: 'staging', release: 'v-one', revision: 6})
        assert.equal(rollback.status, 'queued')
        console.log('PASS serialized deployment intent, duplicate receipt, bound agent and simulated success/failure reports')

        for (const client of clients.splice(0)) client.close()
        await host.close()
        runtime = createHostingRuntime({accounts})
        host = await createServiceLeaderHost({definition: runtime.definition, env, mount({leader}) {
            return runtime.mount(leader.line.control.store, leader.corridor.system)
        }})
        const restored = await login('owner')
        await restored.views.dashboard.ready
        const snapshot = restored.views.dashboard.store.state
        const restoredPublic = snapshot.environments.find(item => item.id == 'public-app')!
        assert.equal(restoredPublic.publicOrigin, publicInput.publicOrigin, 'public origin persists through native archive restart')
        assert.equal(restoredPublic.route, 'http://127.0.0.1:45678', 'public origin never rewrites internal route')
        assert.deepEqual(await setOrigin(restored, 'public-origin', publicInput), publicConfigured, 'guarded native receipt survives restart')
        assert.equal(snapshot.environments.find(item => item.id == 'staging')?.publicOrigin, undefined, 'legacy missing origin is preserved')
        assert.equal(snapshot.operations.length, 4)
        assert.equal(snapshot.environments[0].active, 'v-two')
        assert.equal(snapshot.environments[0].pending, rollback.id)
        assert.equal(snapshot.operations.find(item => item.id == rollback.id)?.status, 'queued', 'restart does not pretend deployment completed')
        const input = {environment: 'staging', release: 'v-one', revision: 6}
        const replay = await restored.commands.rollback('rollback-one', input)
        assert.equal(replay.id, rollback.id, 'receipt survives restart')
        await restored.commands.cancelQueued('cancel-rollback', {operation: rollback.id, revision: 0})
        await waitFor(() => restored.views.dashboard.store.state.environments[0].pending == '')
        console.log('PASS durable archive and receipts across restart, queued rollback and cancellation')
        const restoredAgent = await login('agent')
        const rollbackAgain = await restored.commands.rollback('rollback-again', {environment: 'staging', release: 'v-one', revision: 8})
        await restoredAgent.commands.claimOperation('claim-rollback', {operation: rollbackAgain.id, revision: 0})
        await restoredAgent.commands.finishOperation('finish-rollback', {
            operation: rollbackAgain.id,
            revision: 1,
            success: true,
            observedArtifact: artifact1,
            detail: 'Protocol test: simulated rollback'
        })
        await waitFor(() => restored.views.dashboard.store.state.environments[0].active == 'v-one')
        const restoredOperator = await login('operator')
        const competing = await Promise.allSettled([
            restored.commands.deploy('race-owner', {environment: 'staging', release: 'v-two', revision: 10}),
            restoredOperator.commands.deploy('race-operator', {environment: 'staging', release: 'v-two', revision: 10}),
        ])
        assert.equal(competing.filter(item => item.status == 'fulfilled').length, 1, 'only one concurrent deployment wins')
        assert.equal(competing.filter(item => item.status == 'rejected').length, 1)
        await restored.commands.deploy('public-first-deploy', {environment: 'public-app', release: 'v-one', revision: 3})
        await assert.rejects(setOrigin(restored, 'deployed-domain-change', {
            ...publicInput, revision: 4, publicOrigin: 'https://new.example.test'
        }), /before the first deployment/)
        console.log('PASS simulated version rollback and two concurrent RPC writers')
        console.log('Hosting control check: ALL GREEN. No VM or Kubernetes was created.')
    } finally {
        for (const client of clients) client.close()
        await host.close()
        assert.equal(path.dirname(await realpath(directory)), root)
        await rm(directory, {recursive: true, force: true})
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})

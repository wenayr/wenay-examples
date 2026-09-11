import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {randomBytes, createHash} from 'node:crypto'
import {mkdtemp, rm} from 'node:fs/promises'
import {readFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createServiceClient, describeService, type ServiceClientDefinition} from 'wenay-common2/service/client'
import {createHostingDefinition} from './service'
import {startDockerAgent} from './agent'
import {createDockerResource, type Deployment} from './docker'
import {organizerDefinition} from '../../pizzeria/organizer/service'

async function main() {
    const kind = process.env.HOSTING_APP_KIND == 'pizzeria' ? 'pizzeria' : 'organizer'
    const prepared = JSON.parse(readFileSync(path.resolve('data/product-images.json'), 'utf8')) as Record<string, string>
    const image = process.env.HOSTING_ORGANIZER_IMAGE ?? prepared[kind + '-first']
    const images: Record<string, string> = {first: image, second: prepared[kind + '-second']}
    const directory = await mkdtemp(path.join(os.tmpdir(), 'wenay-stateful-'))
    const account = 'agent-' + randomBytes(5).toString('hex'), password = randomBytes(24).toString('hex')
    const definition = createHostingDefinition({accounts: [
        {account: 'admin', password, role: 'admin', projects: []},
        {account, password, role: 'agent', projects: ['demo']}
    ]})
    const host = await createServiceLeaderHost({
        definition,
        env: {SERVICE_PORT: '0'},
        mount({app}) {app.get('/api/client', (_req, res) => res.json(describeService(definition)))}
    })
    const control = createServiceClient({definition: describeService(definition), url: host.url, auth: {credentials: {account: 'admin', password}}})
    const socketPath = process.env.DOCKER_SOCKET ?? (process.platform == 'win32' ? '\\\\.\\pipe\\dockerDesktopLinuxEngine' : '/var/run/docker.sock')
    const docker = createDockerResource({socketPath, owner: account})
    let agent: Awaited<ReturnType<typeof startDockerAgent>> | undefined
    const deployments: Deployment[] = []
    const volumes = new Set<string>()
    function volume(environment: string) {
        const name = 'wenay-data-' + createHash('sha256').update(JSON.stringify([account, environment])).digest('hex')
        volumes.add(name)
        return name
    }
    const applications: ReturnType<typeof createServiceClient<typeof organizerDefinition>>[] = []
    async function wait(check: () => boolean | Promise<boolean>, label: string) {
        const until = Date.now() + 30000
        while (!await check()) {
            assert(Date.now() < until, label)
            await new Promise(resolve => setTimeout(resolve, 50))
        }
    }
    try {
        await control.ready()
        await control.views.dashboard.ready
        await control.commands.createProject('project', {id: 'demo', title: 'Stateful test'})
        await control.commands.createEnvironment('environment', {id: 'app', project: 'demo', kind: 'docker', agent: account})
        const profile = {port: 8080, healthPath: '/health', memoryMiB: 256, cpus: 0.5, dataVersion: kind == 'pizzeria' ? 'pizzeria-5' : 'organizer-2'}
        for (const version of ['first', 'second']) await control.commands.publishRelease('release-' + version, {
            id: version,
            project: 'demo',
            version,
            artifact: images[version],
            ...profile
        })
        const agentDeps = {url: host.url, account, password, socketPath, directory, readinessMs: 15000}
        agent = await startDockerAgent(agentDeps)
        let task = ''
        let order = '', photo = ''
        const photoBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64')
        let stable = ''
        let chatRoom = '', messageId = '', aiRun = ''
        let continuity: (() => Promise<void>) | undefined
        for (const [index, release] of ['first', 'second', 'first'].entries()) {
            const environment = control.views.dashboard.store.state.environments[0]
            const input = {environment: 'app', release, revision: environment.revision}
            const operation = index == 2 ? await control.commands.rollback('rollback', input) : await control.commands.deploy('deploy-' + index, input)
            deployments.push({operation: operation.id, environment: 'app', artifact: images[release], workload: profile})
            volume('app')
            await wait(function deployed() {
                return control.views.dashboard.store.state.operations.some(function done(item) {
                    return item.id == operation.id && item.status == 'succeeded'
                })
            }, 'stateful deployment did not succeed')
            const current = control.views.dashboard.store.state.environments[0]
            assert(current.route)
            if (stable) assert.equal(current.route, stable)
            else stable = current.route
            await wait(async function reachable() {
                const answer = fetch(stable + '/health', {signal: AbortSignal.timeout(1000)})
                return answer.then(response => response.ok).catch(() => false)
            }, 'gateway did not activate the ready application')
            if (process.argv.includes('--rest-only')) {
                const login = await fetch(stable + '/api/' + kind + '/login', {
                    method: 'POST',
                    headers: {'content-type': 'application/json'},
                    body: JSON.stringify({args: [{account: 'owner', password: 'owner-pass'}]})
                }).then(response => response.json())
                assert(login.ok)
                const headers = {'content-type': 'application/json', authorization: 'Bearer ' + login.value.token}
                async function as(account: string, command: string, input: object) {
                    const session = await fetch(stable + '/api/pizzeria/login', {
                        method: 'POST',
                        headers: {'content-type': 'application/json'},
                        body: JSON.stringify({args: [{account, password: account + '-pass'}]})
                    }).then(response => response.json())
                    const result = await fetch(stable + '/api/pizzeria/commands/' + command, {
                        method: 'POST',
                        headers: {'content-type': 'application/json', authorization: 'Bearer ' + session.value.token},
                        body: JSON.stringify({args: [command + '-' + index, input]})
                    }).then(response => response.json())
                    assert(result.ok, JSON.stringify(result))
                    return result.value
                }
                if (!index) {
                    const result = await fetch(stable + '/api/' + kind + '/commands/workSaveTask', {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({args: ['persisted-task', {
                            id: '',
                            revision: 0,
                            title: 'Сохранить через обновление',
                            description: '',
                            assignee: 'owner',
                            due: '',
                            priority: 'normal',
                            sourceId: '',
                            checklist: []
                        }]})
                    }).then(response => response.json())
                    assert(result.ok, JSON.stringify(result))
                    task = result.value.id
                    if (kind == 'pizzeria') {
                        const uploaded = await fetch(stable + '/api/media/photos', {
                            method: 'POST',
                            headers: {authorization: headers.authorization, 'content-type': 'image/png'},
                            body: new Uint8Array(photoBytes)
                        }).then(response => response.json())
                        assert(uploaded.ok)
                        photo = uploaded.value.id
                        order = (await as('alice', 'placeOrder', {items: ['margherita'], address: 'Тестовый адрес'})).id
                        await as('chef', 'startCooking', {orderId: order})
                    }
                } else {
                    const result = await fetch(stable + '/api/' + kind + '/views/work', {headers}).then(response => response.json())
                    assert(result.ok && result.value.tasks[task], 'REST task survives replacement')
                    if (kind == 'pizzeria') {
                        assert.deepEqual(Buffer.from(await (await fetch(stable + '/api/media/photos/' + photo)).arrayBuffer()), photoBytes)
                        if (index == 1) await as('chef', 'markReady', {orderId: order})
                        else {
                            await as('rider', 'pickUp', {orderId: order})
                            await as('rider', 'markDelivered', {orderId: order})
                        }
                    }
                }
                console.log('PASS stateful ' + kind + ' stage ' + index + ': REST only, persistent task; does not close public RPC URL gap')
                if (!index) {
                    await agent.close()
                    agent = await startDockerAgent(agentDeps)
                }
                continue
            }
            // Both products expose this shared organizer surface; retain the actual service descriptor.
            const description = await fetch(stable + '/api/client').then(response => response.json()) as ServiceClientDefinition<typeof organizerDefinition>
            const app = createServiceClient({definition: description, url: stable, auth: {credentials: {account: 'owner', password: 'owner-pass'}}})
            applications.push(app)
            const rpcTimeout = new Promise(function expire(_resolve, reject) {
                const failure = new Error('Application RPC behind gateway did not become ready')
                setTimeout(() => reject(failure), 12000)
            })
            try {
                await Promise.race([app.ready(), rpcTimeout])
            }
            catch (error) {
                console.error('Gateway URL:', stable, 'Advertised roster:', app.view.roster().map(row => ({id: row.nodeId, url: row.url})))
                throw error
            }
            const viewTimeout = new Promise(function expire(_resolve, reject) {
                const failure = new Error('Application view behind gateway did not become ready')
                setTimeout(() => reject(failure), 12000)
            })
            await Promise.race([app.views.work.ready, viewTimeout])
            if (!index) task = (await app.commands.workSaveTask('persisted-task', {
                id: '',
                revision: 0,
                title: 'Сохранить через обновление',
                description: '',
                assignee: 'owner',
                due: '',
                priority: 'normal',
                sourceId: '',
                checklist: []
            })).id
            else assert(app.views.work.store.state.tasks[task], 'confirmed task survives replacement')
            assert.equal(app.view.endpoint()?.url, stable, 'RPC uses the advertised gateway')
            const chat = app.resources.open('chat')
            const screen = app.resources.open('screen')
            await wait(() => !!chat.current() && !!screen.current(), 'SC1 resources behind gateway not ready')
            const remote = chat.current()!.remote
            const room = await remote.control.create({requestId: 'gateway-room', title: 'Разговор за gateway', participants: ['owner'], task: ''})
            const message = await remote.control.post({requestId: 'gateway-message', room, text: 'Сохраняется через замену', reply: ''})
            const run = await remote.ai.createRun({
                requestId: 'gateway-ai',
                kind: 'demo-tasks',
                resourceIds: [room],
                input: {room, text: 'Проверить обновление'}
            })
            await wait(async () => (await remote.control.results(room)).length == 1, 'AI result not persisted')
            if (!index) {
                chatRoom = room
                messageId = message
                aiRun = run.id
            }
            else {
                assert.equal(room, chatRoom)
                assert.equal(message, messageId)
                assert.equal(run.id, aiRun)
            }
            await screen.current()!.remote.control.begin()
            await screen.current()!.remote.control.end()
            if (!index) {
                let generation = chat.current()!.generation
                const originalStore = app.views.work.store
                continuity = async function verifyReconnect() {
                    await wait(function reconnected() {
                        if (!app.health.state.connected || !chat.current()) return false
                        return chat.current()!.generation > generation
                    }, 'original client and resource did not reconnect')
                    generation = chat.current()!.generation
                    assert.equal(app.views.work.store, originalStore)
                    assert(originalStore.state.tasks[task])
                    assert.equal((await chat.current()!.remote.control.results(room)).length, 1)
                }
            } else {
                await continuity!()
                await chat.close()
            }
            await screen.close()
            console.log('PASS stateful ' + kind + ' stage ' + index + ': advertised gateway RPC + Store + SC1 screen/chat + durable AI receipt')
            if (index) app.close()
            if (!index) {
                await agent.close()
                agent = await startDockerAgent(agentDeps)
            }
        }
        if (process.argv.includes('--preview')) {
            console.log('HOSTED_PREVIEW=' + stable + ' (owner / owner-pass); automatic test cleanup in two minutes')
            await new Promise<void>(function untilClosed(resolve) {
                const timer = setTimeout(finish, 120000)
                function finish() {
                    clearTimeout(timer)
                    process.off('SIGINT', finish)
                    process.off('SIGTERM', finish)
                    resolve()
                }
                process.once('SIGINT', finish)
                process.once('SIGTERM', finish)
            })
        }
        if (process.argv.includes('--rest-only')) {
            await control.commands.publishRelease('incompatible', {
                id: 'incompatible',
                project: 'demo',
                version: 'incompatible',
                artifact: image,
                ...profile,
                dataVersion: 'different-format'
            })
            await assert.rejects(control.commands.deploy('reject-incompatible', {
                environment: 'app',
                release: 'incompatible',
                revision: control.views.dashboard.store.state.environments.find(item => item.id == 'app')!.revision
            }))
            await control.commands.publishRelease('unhealthy', {
                id: 'unhealthy',
                project: 'demo',
                version: 'unhealthy',
                artifact: image,
                ...profile,
                healthPath: '/api/no-such-health'
            })
            const failed = await control.commands.deploy('deploy-unhealthy', {
                environment: 'app',
                release: 'unhealthy',
                revision: control.views.dashboard.store.state.environments.find(item => item.id == 'app')!.revision
            })
            deployments.push({operation: failed.id, environment: 'app', artifact: image, workload: {...profile, healthPath: '/api/no-such-health'}})
            await wait(function rejected() {
                return control.views.dashboard.store.state.operations.some(function broken(item) {
                    return item.id == failed.id && item.status == 'failed'
                })
            }, 'unhealthy replacement must fail and restore previous writer')
            await wait(async function reachable() {
                const answer = fetch(stable + '/health', {signal: AbortSignal.timeout(1000)})
                return answer.then(response => response.ok).catch(() => false)
            }, 'restored previous writer did not become ready')
            assert.equal(control.views.dashboard.store.state.environments.find(item => item.id == 'app')!.active, 'first')
            console.log('PASS ' + kind + ' rejects incompatible data format; failed readiness restores previous writer and gateway')
            await agent.close()
            agent = undefined
            const active = control.views.dashboard.store.state.environments.find(item => item.id == 'app')!.activeOperation
            await docker.control.remove(deployments.find(item => item.operation == active)!)
            const source = volume('app')
            const target = volume('restored')
            execFileSync('docker', ['run', '--rm', '--memory', '64m', '--cpus', '0.5', '--pids-limit', '32', '--mount', 'type=volume,source=' + source + ',target=/source,readonly', '--mount', 'type=volume,source=' + target + ',target=/data', image,
                'node', '--input-type=module', '-e', "import {cpSync} from 'node:fs'; cpSync('/source', '/data', {recursive:true})"], {windowsHide: true, stdio: 'pipe', timeout: 30000})
            await control.commands.createEnvironment('restore-environment', {id: 'restored', project: 'demo', kind: 'docker', agent: account})
            agent = await startDockerAgent(agentDeps)
            const restoredEnvironment = control.views.dashboard.store.state.environments.find(item => item.id == 'restored')!
            const operation = await control.commands.deploy('restore-deploy', {
                environment: 'restored',
                release: 'first',
                revision: restoredEnvironment.revision
            })
            deployments.push({operation: operation.id, environment: 'restored', artifact: image, workload: profile})
            await wait(function restored() {
                return control.views.dashboard.store.state.operations.some(function done(item) {
                    return item.id == operation.id && item.status == 'succeeded'
                })
            }, 'restore deployment failed')
            const endpoint = control.views.dashboard.store.state.environments.find(item => item.id == 'restored')!.route!
            await wait(async () => fetch(endpoint + '/health').then(response => response.ok).catch(() => false), 'restore route failed')
            const login = await fetch(endpoint + '/api/' + kind + '/login', {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({args: [{account: 'owner', password: 'owner-pass'}]})
            }).then(response => response.json())
            const headers = {authorization: 'Bearer ' + login.value.token}
            const answer = await fetch(endpoint + '/api/' + kind + '/views/work', {headers})
            const result = await answer.json()
            assert(result.ok && result.value.tasks[task], 'backup restores task into a separate volume/environment')
            if (photo) assert.deepEqual(Buffer.from(await (await fetch(endpoint + '/api/media/photos/' + photo)).arrayBuffer()), photoBytes)
            console.log('PASS ' + kind + ' quiesced volume backup restored into a separate environment')
        }
    } finally {
        applications.forEach(app => app.close())
        await agent?.close()
        control.close()
        await host.close()
        for (const deployment of deployments) await docker.control.remove(deployment)
        for (const name of volumes) {
            try {execFileSync('docker', ['volume', 'inspect', name], {windowsHide: true, stdio: 'pipe'})} catch {continue}
            execFileSync('docker', ['volume', 'rm', name], {windowsHide: true, stdio: 'pipe'})
        }
        if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected cleanup directory')
        await rm(directory, {recursive: true, force: true})
    }
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})

import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {randomBytes, createHash} from 'node:crypto'
import {mkdtemp, rm} from 'node:fs/promises'
import {realpathSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createServiceClient, describeService, type ServiceClient} from 'wenay-common2/service/client'
import {createHostingDefinition} from './service'
import {startDockerAgent} from './agent'
import {createDockerResource, type Deployment} from './docker'
import type {DocumentDefinition} from '../../documents/backend/runtime'
import type {DocumentWorkspace} from '../../documents/backend/domain'

type ProcessorRemote = NonNullable<ReturnType<ReturnType<ServiceClient<DocumentDefinition>['resources']['open']>['current']>>['remote']

function textPdf(text: string) {
    const content = 'BT /F1 12 Tf 20 100 Td (' + text + ') Tj ET'
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [5 0 R] /Count 1 >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        '<< /Length ' + Buffer.byteLength(content) + ' >>\nstream\n' + content + '\nendstream',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>']
    let pdf = '%PDF-1.4\n'
    const offsets: number[] = []
    for (const [index, object] of objects.entries()) {
        offsets.push(Buffer.byteLength(pdf))
        pdf += (index + 1) + ' 0 obj\n' + object + '\nendobj\n'
    }
    const xref = Buffer.byteLength(pdf)
    pdf += 'xref\n0 6\n0000000000 65535 f \n' + offsets.map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')
    pdf += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n'
    return Buffer.from(pdf)
}

// Разворачиваем тег в digest: развёртывание закрепляется неизменяемым идентификатором образа.
function imageDigest(application: string, release: string) {
    const reference = 'wenay-examples.local/' + application + ':' + release
    const args = ['image', 'inspect', reference, '--format', '{{index .RepoDigests 0}}']
    return execFileSync('docker', args, {windowsHide: true, encoding: 'utf8'}).trim()
}

async function main() {
    const images = Object.fromEntries(['first', 'second'].map(release => [release,
        imageDigest('documents', release)]))
    for (const value of Object.values(images)) assert(/@sha256:[a-f0-9]{64}$/.test(value), 'Build pinned documents images before live check')
    const temporary = realpathSync(os.tmpdir())
    const directory = await mkdtemp(path.join(temporary, 'documents-hosting-'))
    const account = 'documents-' + randomBytes(5).toString('hex')
    const password = randomBytes(24).toString('hex')
    const definition = createHostingDefinition({accounts: [
        {account: 'admin', password, role: 'admin', projects: []},
        {account, password, role: 'agent', projects: ['documents']}
    ]})
    const host = await createServiceLeaderHost({definition, env: {SERVICE_PORT: '0'}, mount({app}) {
        app.get('/api/client', function descriptor(_request, response) {response.json(describeService(definition))})
    }})
    const control = createServiceClient({definition: describeService(definition), url: host.url, auth: {credentials: {account: 'admin', password}}})
    const socketPath = process.env.DOCKER_SOCKET ?? (process.platform == 'win32' ? '\\\\.\\pipe\\dockerDesktopLinuxEngine' : '/var/run/docker.sock')
    const docker = createDockerResource({socketPath, owner: account})
    const deployments: Deployment[] = []
    let agent: Awaited<ReturnType<typeof startDockerAgent>> | undefined
    let customer: ServiceClient<DocumentDefinition> | undefined
    let reviewer: ServiceClient<DocumentDefinition> | undefined
    let resource: ReturnType<ServiceClient<DocumentDefinition>['resources']['open']> | undefined
    let reviewResource: ReturnType<ServiceClient<DocumentDefinition>['resources']['open']> | undefined
    const profile = {port: 8080, healthPath: '/health', memoryMiB: 256, cpus: 0.5, dataVersion: 'documents-1'}
    async function wait(label: string, predicate: () => boolean | Promise<boolean>, timeout = 40000) {
        const until = Date.now() + timeout
        while (!await predicate()) {
            assert(Date.now() < until, label)
            await new Promise(resolve => setTimeout(resolve, 70))
        }
    }
    function ownContainers() {
        const args = [
            'ps', '-q',
            '--filter', 'label=wenay.owner=' + account,
            '--filter', 'label=wenay.environment=app'
        ]
        const output = execFileSync('docker', args, {windowsHide: true, encoding: 'utf8'})
        return output.trim().split(/\s+/).filter(Boolean)
    }
    function memorySample(label: string) {
        const ids = ownContainers()
        assert.equal(ids.length, 1, 'Exactly one owned application container is running')
        const format = '{"limit":{{.HostConfig.Memory}},"oom":{{.State.OOMKilled}}}'
        const args = ['inspect', ids[0], '--format', format]
        const limits = JSON.parse(execFileSync('docker', args, {windowsHide: true, encoding: 'utf8'}))
        assert.equal(limits.limit, 256 * 1024 * 1024)
        assert.equal(limits.oom, false)
        const sample = execFileSync('docker', ['stats', '--no-stream', '--format', '{{.MemUsage}}', ids[0]], {windowsHide: true, encoding: 'utf8'}).trim()
        console.log('MEMORY SAMPLE ' + label + ': ' + sample + ' (current observation, not peak)')
    }
    const fixtures = [
        {
            name: 'node-invoice.csv',
            processor: 'node',
            bytes: Buffer.from('name,amount\nConsulting,42\nHosting,7'),
            rows: [['Consulting', '43'], ['Hosting', '7']]
        },
        {name: 'python-invoice.csv', processor: 'python', bytes: Buffer.from('name,amount\nPython worker,17'), rows: [['Python worker', '17']]},
        {name: 'invoice.pdf', processor: 'node', bytes: textPdf('Invoice total 42'), rows: [['1', 'Invoice total 42']]}
    ]
    const saved: {id: string, revision: number, fixture: typeof fixtures[number]}[] = []
    try {
        await control.ready()
        await control.views.dashboard.ready
        await control.commands.createProject('project', {id: 'documents', title: 'Documents acceptance'})
        await control.commands.createEnvironment('environment', {id: 'app', project: 'documents', kind: 'docker', agent: account})
        for (const release of ['first', 'second']) await control.commands.publishRelease('release-' + release, {
            id: release,
            project: 'documents',
            version: release,
            artifact: images[release],
            ...profile
        })
        agent = await startDockerAgent({url: host.url, account, password, socketPath, directory, readinessMs: 25000})
        let route = ''
        for (const [index, release] of ['first', 'second', 'first'].entries()) {
            const generation = resource?.current()?.generation ?? 0
            const previous = control.views.dashboard.store.state.environments[0]
            const input = {environment: 'app', release, revision: previous.revision}
            const operation = index == 2 ? await control.commands.rollback('rollback', input) : await control.commands.deploy('deploy-' + index, input)
            deployments.push({operation: operation.id, environment: 'app', artifact: images[release], workload: profile})
            await wait('deployment completes', function terminal() {
                return control.views.dashboard.store.state.operations.some(function done(item) {
                    return item.id == operation.id && ['succeeded', 'failed'].includes(item.status)
                })
            })
            const completed = control.views.dashboard.store.state.operations.find(item => item.id == operation.id)
            assert.equal(completed?.status, 'succeeded', completed?.detail ?? 'deployment failed')
            const endpoint = control.views.dashboard.store.state.environments[0].route!
            route ||= endpoint
            assert.equal(endpoint, route, 'Gateway address stays stable')
            await wait('expected release health', async function healthy() {
                const answer = fetch(route + '/health', {signal: AbortSignal.timeout(2000)})
                const body = await answer.then(response => response.json()).catch(() => null)
                return body?.release == release
            })
            assert((await fetch(route).then(response => response.text())).includes('Papertrail'))
            if (!customer) {
                const descriptor = await fetch(route + '/api/client').then(response => response.json())
                customer = createServiceClient<DocumentDefinition>({
                    definition: descriptor,
                    url: route,
                    auth: {credentials: {account: 'customer', password: 'customer-pass'}}
                })
                reviewer = createServiceClient<DocumentDefinition>({
                    definition: descriptor,
                    url: route,
                    auth: {credentials: {account: 'reviewer', password: 'reviewer-pass'}}
                })
                await customer.ready()
                await reviewer.ready()
                await customer.views.workspace.ready
                await reviewer.views.workspace.ready
                resource = customer.resources.open('processor')
                reviewResource = reviewer.resources.open('processor')
                await wait('processor resources ready', () => !!resource?.current() && !!reviewResource?.current())
                for (const fixture of fixtures) {
                    const remote: ProcessorRemote = resource.current()!.remote
                    const uploaded = await remote.control.upload({orgId: 'northstar', name: fixture.name, bytes: fixture.bytes})
                    await remote.ai.createRun({requestId: 'extract-' + fixture.name, kind: 'extract', resourceIds: [uploaded.id],
                        input: {orgId: 'northstar', documentId: uploaded.id, revision: uploaded.revision, processor: fixture.processor}})
                    function item(): DocumentWorkspace['documents'][number] | undefined {
                        const documents = customer!.views.workspace.store.state.documents
                        return documents.find(value => value.id == uploaded.id)
                    }
                    await wait(fixture.name + ' parsed in container', () => !!item() && ['review', 'failed', 'cancelled', 'uncertain'].includes(item()!.status))
                    assert.equal(item()!.status, 'review', fixture.name + ': ' + item()!.error)
                    let revision = item()!.revision
                    if (fixture.name == 'node-invoice.csv') {
                        revision = (await reviewer.commands.documentRow('correct-node-amount', {
                            orgId: 'northstar',
                            id: uploaded.id,
                            revision,
                            index: 0,
                            values: ['Consulting', '43'],
                            comment: 'Checked against the agreement'
                        })).revision
                    }
                    const detail = await reviewResource.current()!.remote.control.detail({orgId: 'northstar', id: uploaded.id, revision})
                    assert.deepEqual(detail.table.rows, fixture.rows)
                    if (fixture.name.endsWith('.pdf')) assert.equal(detail.sourceType, 'pdf')
                    const approved = await reviewer.commands.documentApprove('approve-' + fixture.name, {orgId: 'northstar', id: uploaded.id, revision})
                    saved.push({id: uploaded.id, revision: approved.revision, fixture})
                    memorySample(fixture.processor + '/' + fixture.name)
                }
            } else {
                await wait('same sessions and resource reconnect', () => customer!.health.state.connected && reviewer!.health.state.connected &&
                    (resource?.current()?.generation ?? 0) > generation && !!reviewResource?.current()
                    && saved.every(function approved(file) {
                        const documents = customer!.views.workspace.store.state.documents
                        return documents.some(item => item.id == file.id && item.status == 'approved')
                    }))
            }
            for (const file of saved) {
                const remote = resource!.current()!.remote
                const exported = await remote.control.export({orgId: 'northstar', id: file.id, revision: file.revision, format: 'json'})
                assert.deepEqual(JSON.parse(Buffer.from(exported.bytes).toString()).rows, file.fixture.rows)
                assert.deepEqual(Buffer.from((await remote.control.download({orgId: 'northstar', id: file.id})).bytes), file.fixture.bytes)
            }
            memorySample(index == 2 ? 'rollback' : 'deploy-' + release)
            console.log('PASS documents through hosting: ' + (index == 2 ? 'rollback first' : 'deploy ' + release) + ', stable live sessions, Node/Python CSV, real PDF, approved exports and original bytes; limit 256 MiB')
        }
    } finally {
        await resource?.close()
        await reviewResource?.close()
        customer?.close()
        reviewer?.close()
        await agent?.close()
        control.close()
        await host.close()
        for (const deployment of deployments) await docker.control.remove(deployment)
        const volume = 'wenay-data-' + createHash('sha256').update(JSON.stringify([account, 'app'])).digest('hex')
        try {
            execFileSync('docker', ['volume', 'inspect', volume], {windowsHide: true, stdio: 'pipe'})
            execFileSync('docker', ['volume', 'rm', volume], {windowsHide: true, stdio: 'pipe'})
        } catch { /* This run may have failed before its volume was created. */ }
        const resolved = path.resolve(directory)
        assert(resolved.startsWith(temporary + path.sep) && path.basename(resolved).startsWith('documents-hosting-'))
        await rm(resolved, {recursive: true, force: true})
    }
}

void main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})

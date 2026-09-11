import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync, realpathSync, rmSync, existsSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {createServiceClient, describeService, type ServiceClient} from 'wenay-common2/service/client'
import type {DocumentDefinition} from './runtime'
import {createProcess} from './process-resource'

const repository = path.resolve('../..')

function run(script: string, args: string[]) {
    return execFileSync('node', [path.join(repository, 'scripts', script), ...args], {
        cwd: repository, encoding: 'utf8', windowsHide: true
    })
}

async function waitFor(label: string, check: () => boolean) {
    const deadline = Date.now() + 15000
    while (!check()) {
        assert(Date.now() < deadline, 'Timeout: ' + label)
        await new Promise(resolve => setTimeout(resolve, 20))
    }
}

// Холодная копия документов: вместе с состоянием обязаны пережить восстановление
// байты исходного файла в blob-хранилище, а не только запись о документе.
async function main() {
    const temporary = realpathSync(tmpdir())
    const directory = mkdtempSync(path.join(temporary, 'documents-backup-'))
    const live = path.join(directory, 'live')
    const copy = path.join(directory, 'copy')
    const restored = path.join(directory, 'restored')
    const env = {
        SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: live,
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')
    }
    let host = createProcess({script: 'server.ts', env})
    let url = await host.ready
    const clients: ServiceClient<DocumentDefinition>[] = []
    const resources: {close(): Promise<void>}[] = []

    async function client(account: string) {
        const body = JSON.stringify({args: [{account, password: account + '-pass'}]})
        const headers = {'content-type': 'application/json'}
        const answer = await fetch(url + '/api/documents/login', {method: 'POST', headers, body}).then(response => response.json())
        assert(answer.ok, JSON.stringify(answer))
        const definition = await fetch(url + '/api/client').then(response => response.json())
        const session = createServiceClient<DocumentDefinition>({definition, url, auth: {token: answer.value.token}})
        clients.push(session)
        await session.ready()
        await session.views.workspace.ready
        return session
    }
    async function processor(session: ServiceClient<DocumentDefinition>) {
        const resource = session.resources.open('processor')
        resources.push(resource)
        await waitFor('processor resource ready', () => resource.status.state.phase == 'ready')
        return resource
    }
    function documents(session: ServiceClient<DocumentDefinition>) {
        return session.views.workspace.store.state.documents
    }
    async function close() {
        for (const resource of resources.splice(0)) await resource.close().catch(() => {})
        for (const session of clients.splice(0)) session.close()
        await host.control.stop()
    }

    const orgId = 'northstar'
    const bytes = Buffer.from('name,amount\nОбучение,48000\nПодписка,12000')
    try {
        const customer = await client('customer')
        const resource = await processor(customer)
        const uploaded = await resource.current()!.remote.control.upload({orgId, name: 'budget.csv', bytes})
        await waitFor('документ виден загрузчику', () => documents(customer).some(item => item.id == uploaded.id))
        const before = documents(customer).length
        await close()

        assert.throws(() => run('backup.mjs', ['documents', copy, '--from=' + live]), /--i-stopped-it/)
        run('backup.mjs', ['documents', copy, '--i-stopped-it', '--from=' + live, '--data-version=docs-1'])
        assert(existsSync(path.join(copy, 'manifest.json')))
        assert(existsSync(path.join(copy, 'complete')))
        const manifest = JSON.parse(execFileSync('node', ['-e', 'process.stdout.write(require("fs").readFileSync(process.argv[1], "utf8"))', path.join(copy, 'manifest.json')], {encoding: 'utf8'}))
        assert(manifest.files.some((item: {path: string}) => item.path.includes('blobs/')), 'байты исходного файла попали в копию')

        assert.throws(() => run('restore.mjs', [copy, restored, '--data-version=docs-2']), /Формат данных/)
        run('restore.mjs', [copy, restored, '--data-version=docs-1'])

        const broken = path.join(directory, 'broken')
        run('backup.mjs', ['documents', broken, '--i-stopped-it', '--from=' + live])
        writeFileSync(path.join(broken, 'data', 'documents.jsonl'), 'повреждено\n', 'utf8')
        assert.throws(() => run('restore.mjs', [broken, path.join(directory, 'broken-restore')]), /Хеш файла|Размер файла/)
        assert(!existsSync(path.join(directory, 'broken-restore', 'documents.jsonl')), 'полукопия не остаётся')

        host = createProcess({script: 'server.ts', env: {...env, SERVICE_DATA_DIR: restored}})
        url = await host.ready
        const again = await client('customer')
        const restoredResource = await processor(again)
        assert.equal(documents(again).length, before, 'число документов сохранилось')
        const document = documents(again).find(item => item.id == uploaded.id)
        assert(document, 'загруженный документ восстановлен')
        assert.equal(document.name, 'budget.csv')
        const source = await restoredResource.current()!.remote.control.download({orgId, id: uploaded.id})
        assert.equal(Buffer.from(source.bytes).toString('utf8'), bytes.toString('utf8'), 'байты исходного файла читаются после восстановления')

        console.log('PASS documents backup: копия включает blob исходного файла, отказ без подтверждения остановки,')
        console.log('  отказ при несовпадении формата данных и по повреждённому файлу без полукопии,')
        console.log('  восстановление в новый каталог с читаемыми байтами исходника')
    } finally {
        await close().catch(() => {})
        assert(path.dirname(path.resolve(directory)) == temporary && path.basename(directory).startsWith('documents-backup-'))
        rmSync(directory, {recursive: true, force: true})
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})

import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync, realpathSync, rmSync, existsSync, readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {createServiceClient, type ServiceClient} from 'wenay-common2/service/client'
import type {ApprovalDefinition} from './runtime'
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

// Общая проверка холодной копии: предметная запись переживает копирование и
// восстановление в новый каталог, а исходные данные при этом не меняются.
async function main() {
    const temporary = realpathSync(tmpdir())
    const directory = mkdtempSync(path.join(temporary, 'approvals-backup-'))
    const live = path.join(directory, 'live')
    const copy = path.join(directory, 'copy')
    const restored = path.join(directory, 'restored')
    const env = {
        SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: live,
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')
    }
    let host = createProcess({script: 'server.ts', env})
    let url = await host.ready
    const clients: ServiceClient<ApprovalDefinition>[] = []

    async function client(account: string) {
        const definition = await fetch(url + '/api/client').then(response => response.json())
        const session = createServiceClient<ApprovalDefinition>({definition, url, auth: {credentials: {account, password: account + '-pass'}}})
        clients.push(session)
        await session.ready()
        await session.views.workspace.ready
        return session
    }
    async function close() {
        for (const session of clients.splice(0)) session.close()
        await host.control.stop()
    }

    function requests(session: ServiceClient<ApprovalDefinition>) {
        return session.views.workspace.store.state.requests
    }

    try {
        const requester = await client('requester')
        const answers = JSON.stringify({purpose: 'Заявка перед копированием', amount: 15000, urgent: false})
        const created = await requester.commands.requestSave('backup-request', {
            orgId: 'northstar', id: '', revision: 0, key: 'backup-request-key',
            title: 'Заявка для копии', answersJson: answers
        })
        await waitFor('заявка видна автору', () => requests(requester).some(item => item.id == created.id))
        const before = requests(requester).length
        await close()

        assert.throws(() => run('backup.mjs', ['approvals', copy, '--from=' + live]), /--i-stopped-it/)
        run('backup.mjs', ['approvals', copy, '--i-stopped-it', '--from=' + live, '--data-version=approvals-1'])
        assert(existsSync(path.join(copy, 'manifest.json')) && existsSync(path.join(copy, 'complete')))
        const manifest = JSON.parse(readFileSync(path.join(copy, 'manifest.json'), 'utf8'))
        assert(manifest.files.length > 0, 'копия перечисляет файлы каталога данных')
        assert.throws(() => run('restore.mjs', [copy, restored, '--data-version=approvals-2']), /Формат данных/)
        run('restore.mjs', [copy, restored, '--data-version=approvals-1'])
        for (const item of manifest.files) {
            const source = path.join(live, item.path.split('/').join(path.sep))
            assert(existsSync(source), 'исходный каталог не тронут: ' + item.path)
        }

        host = createProcess({script: 'server.ts', env: {...env, SERVICE_DATA_DIR: restored}})
        url = await host.ready
        const again = await client('requester')
        assert.equal(requests(again).length, before, 'число заявок сохранилось')
        const request = requests(again).find(item => item.id == created.id)
        assert(request, 'созданная заявка восстановлена')
        assert.equal(request.title, 'Заявка для копии')
        assert.equal(request.status, 'draft')

        console.log('PASS approvals backup: отказ без подтверждения остановки, отказ при несовпадении формата данных,')
        console.log('  восстановленные согласования отдают прежнюю заявку и её статус, исходный каталог не изменён')
    } finally {
        await close().catch(() => {})
        assert(path.dirname(path.resolve(directory)) == temporary && path.basename(directory).startsWith('approvals-backup-'))
        rmSync(directory, {recursive: true, force: true})
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})

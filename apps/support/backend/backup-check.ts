import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync, realpathSync, rmSync, existsSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {createServiceClient, describeService, type ServiceClient} from 'wenay-common2/service/client'
import type {SupportDefinition} from './runtime'
import {createProcess} from './process-resource'

const repository = path.resolve('../..')

function run(script: string, args: string[]) {
    return execFileSync('node', [path.join(repository, 'scripts', script), ...args], {
        cwd: repository, encoding: 'utf8', windowsHide: true
    })
}

// Холодная копия: сервис останавливается, каталог данных копируется с manifest
// и хешами, восстанавливается в новое пустое место и снова обслуживает запросы.
async function main() {
    const temporary = realpathSync(tmpdir())
    const directory = mkdtempSync(path.join(temporary, 'support-backup-'))
    const live = path.join(directory, 'live')
    const copy = path.join(directory, 'copy')
    const restored = path.join(directory, 'restored')
    const env = {
        SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: live,
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')
    }
    let host = createProcess({script: 'server.ts', env})
    let url = await host.ready
    const clients: ServiceClient<SupportDefinition>[] = []

    async function client(account: string) {
        const definition = await fetch(url + '/api/client').then(response => response.json())
        const auth = {credentials: {account, password: account + '-pass'}}
        const session = createServiceClient<SupportDefinition>({definition, url, auth})
        clients.push(session)
        await session.ready()
        await session.views.workspace.ready
        return session
    }
    function tickets(session: ServiceClient<SupportDefinition>) {
        return session.views.workspace.store.state.tickets
    }
    async function close() {
        for (const session of clients.splice(0)) session.close()
        await host.control.stop()
    }

    const orgId = 'northstar'
    const subject = 'Заявка для проверки восстановления'
    try {
        const agent = await client('agent')
        const created = await agent.commands.ticketCreate('backup-ticket', {
            orgId, subject, body: 'Проверяем холодную копию и восстановление данных', priority: 'normal'
        })
        const deadline = Date.now() + 15000
        while (!tickets(agent).some(item => item.id == created.id)) {
            assert(Date.now() < deadline, 'Timeout: обращение видно автору')
            await new Promise(resolve => setTimeout(resolve, 20))
        }
        const before = tickets(agent).length
        await close()

        // Отказ без подтверждения остановки: копия не должна делаться вслепую.
        assert.throws(() => run('backup.mjs', ['support', copy, '--from=' + live]), /--i-stopped-it/)
        run('backup.mjs', ['support', copy, '--i-stopped-it', '--from=' + live, '--data-version=support-1'])
        assert(existsSync(path.join(copy, 'manifest.json')))
        assert(existsSync(path.join(copy, 'complete')))

        // Несовпадение формата данных останавливает восстановление.
        assert.throws(() => run('restore.mjs', [copy, restored, '--data-version=support-2']), /Формат данных/)
        run('restore.mjs', [copy, restored, '--data-version=support-1'])
        assert(existsSync(path.join(restored, 'support.jsonl')))
        assert(existsSync(path.join(restored, 'support.control.jsonl')))

        // Повреждённая копия отклоняется до первой записи.
        const broken = path.join(directory, 'broken')
        run('backup.mjs', ['support', broken, '--i-stopped-it', '--from=' + live])
        writeFileSync(path.join(broken, 'data', 'support.jsonl'), 'повреждено\n', 'utf8')
        assert.throws(() => run('restore.mjs', [broken, path.join(directory, 'broken-restore')]), /Хеш файла|Размер файла/)
        assert(!existsSync(path.join(directory, 'broken-restore', 'support.jsonl')), 'полукопия не остаётся')

        host = createProcess({script: 'server.ts', env: {...env, SERVICE_DATA_DIR: restored}})
        url = await host.ready
        const again = await client('agent')
        assert.equal(tickets(again).length, before, 'число обращений сохранилось')
        const ticket = tickets(again).find(item => item.id == created.id)
        assert(ticket, 'созданное обращение восстановлено')
        assert.equal(ticket.subject, subject)
        assert(ticket.messages.some(message => message.body.includes('холодную копию')), 'переписка восстановлена')

        console.log('PASS support backup: отказ без подтверждения остановки, копия с manifest и хешами,')
        console.log('  отказ при несовпадении формата данных, отказ по повреждённому файлу без полукопии,')
        console.log('  восстановление в новый каталог и работа сервиса с прежними обращениями и перепиской')
    } finally {
        await close().catch(() => {})
        assert(path.dirname(path.resolve(directory)) == temporary && path.basename(directory).startsWith('support-backup-'))
        rmSync(directory, {recursive: true, force: true})
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})

import assert from 'node:assert/strict'
import {mkdtemp, realpath, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {randomBytes, randomUUID} from 'node:crypto'

// Opt-in browser fixture: real native commands/resource, no user archive or external provider configuration.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appRoot = path.join(repository, 'apps/support')
const load = createRequire(path.join(appRoot, 'package.json'))
const {require: requireTs} = load('tsx/cjs/api')
const {createSupportRuntime} = requireTs(path.join(appRoot, 'backend/runtime.ts'), import.meta.url)
const {createServiceLeaderHost} = load('wenay-common2/service/host')
const {describeService} = load('wenay-common2/service/client')
const express = load('express')
await stat(path.join(appRoot, 'public/index.html'))
const temporary = await realpath(tmpdir())
const directory = await mkdtemp(path.join(temporary, 'wenay-support-history-browser-'))
let clock = Date.UTC(2026, 8, 26, 12)
const runtime = createSupportRuntime({directory: path.join(directory, 'assistant'), now: () => clock++, content: {targets: {}},
    provider: {async draft() {throw new Error('History browser fixture: AI drafting disabled')}}})
let host, closing, ticket, revision

async function close() {
    closing ??= (async function stop() {
        await host?.close()
        const resolved = await realpath(directory)
        if (path.dirname(resolved) != temporary || !path.basename(resolved).startsWith('wenay-support-history-browser-')) {
            throw new Error('Refusing to remove an unexpected browser fixture directory')
        }
        await rm(resolved, {recursive: true, force: true})
        process.stdin.pause()
    })()
    return closing
}

try {
    host = await createServiceLeaderHost({definition: runtime.definition, env: {
        SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: directory,
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')
    }, mount({app, leader}) {
        app.get('/api/client', (_request, response) => response.json(describeService(runtime.definition)))
        app.get('/auth/oidc/status', (_request, response) => response.json({enabled: false}))
        app.use(express.static(path.join(appRoot, 'public')))
        return runtime.mount(leader.line.control.store, leader.corridor.system)
    }})
    const customer = host.leader.corridor.fragment('customer')
    const agent = host.leader.corridor.fragment('agent')
    const owner = host.leader.corridor.fragment('owner')
    ticket = await customer.ticketCreate('fixture-history-ticket', {orgId: 'northstar',
        subject: 'История fixture: доставка и оплата', body: 'Первое синтетическое сообщение: начало обращения.', priority: 'normal'})
    revision = ticket.revision
    let authorIndex = 0
    async function reply(body, privateNote = false) {
        // Split native replies across authorised staff without changing the real per-account rate budget.
        const staff = ++authorIndex % 2 ? agent : owner
        const result = await staff.ticketReply('fixture-history-' + randomUUID(),
            {orgId: 'northstar', id: ticket.id, revision, body, private: privateNote})
        revision = result.revision
    }
    for (let index = 1; index <= 60; index++) {
        const topic = index <= 30 ? 'доставка' : 'оплата'
        await reply('Открытый ответ ' + index + ': ' + topic + ' · синтетическая переписка fixture.')
    }
    for (let index = 1; index <= 6; index++) await reply('Заметка команде ' + index + ': доставка · приватная fixture.', true)
    // Seed evidence reads the existing public history resource; no direct journal/store messages are inserted.
    for (const [account, total, matches] of [['agent', 67, 36], ['customer', 61, 30]]) {
        const owned = runtime.definition.resources.conversation.open({principal: host.leader.access.principalOf({account}),
            sessionId: 'fixture-seed-' + account, resourceId: 'fixture-history', signal: new AbortController().signal})
        try {
            const input = {orgId: 'northstar', ticketId: ticket.id, beforeId: '', query: 'доставка', limit: 20}
            const found = owned.facade.control.page(input)
            assert.equal(found.total, matches)
            assert.equal(found.messages.length, 20)
            assert(found.nextBeforeId)
            const older = owned.facade.control.page({...input, beforeId: found.nextBeforeId})
            assert.equal(older.messages.length, matches - 20)
            assert.equal(older.nextBeforeId, '')
            assert.equal(owned.facade.control.page({...input, query: ''}).total, total)
            if (account == 'customer') assert.equal(owned.facade.control.page({...input, query: 'приватная'}).total, 0)
        } finally {owned.close()}
    }
    process.once('SIGINT', () => {void close()})
    process.once('SIGTERM', () => {void close()})
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    let pending = '', controls = Promise.resolve()
    process.stdin.on('data', value => {
        pending += value
        const lines = pending.split(/\r?\n/)
        pending = lines.pop()
        for (const line of lines) controls = controls.then(async () => {
            const command = line.trim()
            if (command == 'stop') await close()
            else if (command == 'append') {
                revision = host.leader.line.control.store.state.tickets[ticket.id].revision
                await reply('Новый открытый ответ: доставка · добавлен terminal-only fixture командой.')
                console.log('FIXTURE_COMMAND=append')
            } else if (command) console.log('Unknown fixture command: ' + command)
        }).catch(error => console.error('FIXTURE_CONTROL_ERROR=' + error.message))
    })
    process.stdin.once('end', () => {void close()})
    console.log('BROWSER_SESSION=' + host.url)
    console.log('BROWSER_DATA=' + directory)
    console.log('FIXTURE_TICKET=' + ticket.id + ' / История fixture: доставка и оплата')
    console.log('FIXTURE_LOGIN=owner / owner-pass; agent / agent-pass; customer / customer-pass; outsider / outsider-pass')
    console.log('EXPECTED: staff history=67, delivery matches=36; customer history=61, delivery matches=30, private matches=0')
    console.log('Commands: append (native public reply), stop. AI/content/metering/OIDC external connections disabled.')
    await new Promise(resolve => process.stdin.once('pause', resolve))
} finally {await close()}

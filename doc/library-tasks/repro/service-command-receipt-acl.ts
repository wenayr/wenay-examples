import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'

// Use only published public exports installed by the caller in apps/chat.
const requireApp = createRequire(path.join(process.cwd(), 'package.json'))
const {createServiceLeaderHost} = requireApp('wenay-common2/service/host')
const {createServiceClient, describeService} = requireApp('wenay-common2/service/client')
const version = requireApp('wenay-common2/package.json').version

async function wait(check: () => boolean) {
    const deadline = Date.now() + 5000
    while (!check()) {
        assert(Date.now() < deadline, 'RPC command facade did not become ready')
        await new Promise(resolve => setTimeout(resolve, 10))
    }
}

async function main() {
    assert.equal(version, '3.1.1', 'This reproduction targets exact published common2 3.1.1')
    const fixtureRoot = path.resolve(tmpdir())
    const directory = await mkdtemp(path.join(fixtureRoot, 'service-command-receipt-acl-'))
    const marker = 'private-service-command-receipt-fixture-result'
    const definition = {
        name: 'receiptAcl', storeId: 'receipt-acl-store', originId: 'receipt-acl-origin',
        initial: {owner: true, member: true},
        access: {
            rolesOf(state: {owner: boolean, member: boolean}, account: string) {
                if (account != 'alice') return []
                const roles = []
                if (state.member) roles.push('member')
                if (state.owner) roles.push('workspace-owner:team')
                return roles
            },
            login: {input: {account: 'string', password: 'string'},
                resolve(_state: unknown, input: {account: string, password: string}) {
                    if (input.account == 'alice' && input.password == 'fixture-pass') return 'alice'
                    return null
                }}
        },
        commands: {teamMemberSet: {
            allow: ['workspace-owner:team'], input: {account: 'string'},
            apply(ctx: {state: {owner: boolean}}, _input: {account: string}) {
                if (!ctx.state.owner) throw new Error('current workspace owner required')
                return {marker}
            }
        }}
    }
    let host: Awaited<ReturnType<typeof createServiceLeaderHost>> | null = null
    let client: ReturnType<typeof createServiceClient> | null = null
    try {
        host = await createServiceLeaderHost({definition,
            env: {SERVICE_HOST: '127.0.0.1', SERVICE_PORT: '0', SERVICE_DATA_DIR: directory}})
        const running = host
        async function http(route: string, args: unknown[], token?: string) {
            const response = await fetch(running.url + '/api/receiptAcl/' + route, {
                method: 'POST', headers: {'content-type': 'application/json', ...(token ? {authorization: 'Bearer ' + token} : {})},
                body: JSON.stringify({args})
            })
            return {status: response.status, body: await response.json() as {ok: boolean, value?: unknown}}
        }
        const login = await http('login', [{account: 'alice', password: 'fixture-pass'}])
        assert.equal(login.body.ok, true)
        const token = (login.body.value as {token: string}).token
        const first = await http('commands/teamMemberSet', ['known', {account: 'bob'}], token)
        assert.deepEqual(first.body.value, {marker})
        client = createServiceClient({definition: describeService(definition), url: running.url, auth: {token}})
        await wait(() => typeof client!.commands.teamMemberSet == 'function')
        const retained = client.commands.teamMemberSet
        assert.deepEqual(await retained('rpc-known', {account: 'bob'}), {marker})
        running.leader.line.control.store.state.owner = false
        assert.equal(running.leader.line.control.store.state.member, true)
        const fresh = await http('commands/teamMemberSet', ['fresh', {account: 'bob'}], token)
        assert.equal(fresh.body.ok, false, 'New request must enforce current owner ACL')
        await assert.rejects(retained('rpc-known', {account: 'bob'}), 'Retained principal RPC must enforce current command.allow')
        const repeated = await http('commands/teamMemberSet', ['known', {account: 'bob'}], token)
        const result = {
            version, freshHttpDenied: !fresh.body.ok, retainedRpcDenied: true,
            repeatedHttpReturnsPrivateResult: repeated.body.ok && JSON.stringify(repeated.body.value).includes(marker)
        }
        console.log(JSON.stringify(result, null, 4))
        assert.equal(result.repeatedHttpReturnsPrivateResult, !process.argv.includes('--expect-fixed'),
            'Current owner ACL must also protect HTTP receipt retries')
    } finally {
        client?.close()
        await host?.close()
        const resolved = path.resolve(directory)
        assert(resolved.startsWith(fixtureRoot + path.sep), 'Cleanup must remain within own temporary fixture root')
        await rm(resolved, {recursive: true, force: true})
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})

import assert from 'node:assert/strict'
import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {createRequire} from 'node:module'
import path from 'node:path'
import {openAiCheckpoint} from '../../../apps/documents/backend/ai-checkpoint'

// Resolve the installed published package from Documents; do not import library internals.
const appDirectory = path.resolve(__dirname, '../../../apps/documents')
const applicationRequire = createRequire(path.join(appDirectory, 'package.json'))
const {createAiRunHost, createAiRunClient} = applicationRequire('wenay-common2/ai') as typeof import('wenay-common2/ai')

async function main() {
    const fixtures = path.join(appDirectory, '.test-data')
    await mkdir(fixtures, {recursive: true})
    const directory = await mkdtemp(path.join(fixtures, 'q05-policy-'))
    const hosts: ReturnType<typeof createAiRunHost>[] = []
    let allowed = true
    let executions = 0
    let interrupt: ((reason: Error) => void) | undefined
    let trusted: {id: string, owner: string, request: string, phase: 'write' | 'create' | 'spent'} | null = null
    let reentrantProbes = 0
    const account = 'product:fixture-key'
    const request = {requestId: 'unfinished-extraction', kind: 'extract', resourceIds: ['fixture-document'], input: {revision: 1}}
    function open() {
        const checkpoint = openAiCheckpoint({directory})
        const host = createAiRunHost({
            ...checkpoint,
            persistence: {commit(record) {
                checkpoint.persistence!.commit(record)
                if (!trusted) return
                assert.equal(trusted.phase, 'spent', 'permit must be consumed before synchronous persistence callbacks')
                reentrantProbes++
                const consumer = host.connection(account)
                try {
                    assert.throws(() => consumer.fragment.createRun(request), /forbidden|must not reenter/)
                    assert.throws(() => consumer.fragment.cancelRun(trusted!.id), /forbidden|must not reenter/)
                    const frame = consumer.fragment.events.keyframe()
                    assert(frame?.event[0].type == 'sync')
                    assert.deepEqual(frame.event[0].runs, [], 'trusted reconciliation must never widen canRead')
                } finally {consumer.close()}
            }},
            capabilities: [{kind: 'extract', acceptsResources: true}],
            policy: {
                canRead: (actor, run) => allowed && actor == run.owner,
                canWrite(actor, run) {
                    const exactRun = trusted?.id == run.id && trusted?.owner == actor && actor == run.owner
                    if (exactRun && trusted?.phase == 'write' && run.recovery) {
                        trusted.phase = 'create'
                        return true
                    }
                    return allowed && actor == run.owner
                },
                canCreate(actor, candidate) {
                    const exactRequest = trusted?.owner == actor && trusted?.request == JSON.stringify(candidate)
                    if (exactRequest && trusted?.phase == 'create') {
                        // Consume the permit before settle mutates state or invokes synchronous native observers.
                        trusted.phase = 'spent'
                        return true
                    }
                    return allowed && actor == account
                }
            },
            runner: {
                run() {
                    executions++
                    return new Promise<never>(function unfinished(_resolve, reject) {interrupt = reject})
                },
                cancel() {interrupt?.(new Error('Fixture host closed'))}
            }
        })
        hosts.push(host)
        return host
    }
    try {
        const original = open()
        const connection = original.connection(account)
        const run = connection.fragment.createRun(request)
        assert.equal(original.store.state.runs[run.id].state, 'running')
        assert.equal(executions, 1)
        connection.close()
        original.close()
        await Promise.resolve()
        // Revoke is current authorization outside the AI checkpoint, as a persisted product key would be.
        allowed = false
        const restored = open()
        const pending = restored.recovery.pending()
        assert.equal(pending.length, 1)
        assert.equal(pending[0].run.id, run.id)
        assert.equal(executions, 1, 'native recovery must not execute the extractor automatically')
        assert.throws(function settleWithRevokedOwner() {
            restored.recovery.settle(run.id, {state: 'failed', error: 'Interrupted extraction'})
        }, /current owner or resources are forbidden/)
        assert(restored.store.state.runs[run.id].recovery, 'refused settle must leave the recovery checkpoint pending')
        console.log('REPRO CONFIRMED common2 3.1.1: unfinished durable run + revoked current policy rejects native recovery.settle')
        // Fixture only: depends on 3.1.1 requireRecovery checking canWrite then canCreate exactly once before mutation.
        // Private synchronous reconciliation: no await, callback argument or caller-selected outcome; not a production adapter decision.
        function settleInterrupted() {
            assert.equal(trusted, null)
            const recovered = pending[0]
            trusted = {id: recovered.run.id, owner: recovered.run.owner, request: JSON.stringify(recovered.request), phase: 'write'}
            try {
                const settled = restored.recovery.settle(recovered.run.id, {state: 'failed', error: 'Interrupted extraction'})
                assert.equal(trusted.phase, 'spent', 'native must consume both exact policy checks before terminal mutation')
                assert.equal(settled.state, 'failed')
            } finally {trusted = null}
        }
        settleInterrupted()
        assert.equal(trusted, null)
        assert.equal(allowed, false)
        assert.equal(restored.recovery.pending().length, 0)
        assert(reentrantProbes > 0, 'synchronous native persistence callback must probe revoked consumer reentry')
        assert.equal(executions, 1)
        const revoked = restored.connection(account)
        assert.throws(() => revoked.fragment.createRun(request), /forbidden/)
        assert.throws(() => revoked.fragment.createRun({...request, requestId: 'new-after-reconcile'}), /forbidden/)
        assert.throws(() => revoked.fragment.cancelRun(run.id), /forbidden/)
        const reader = createAiRunClient({remote: revoked.fragment})
        try {
            await reader.ready
            assert.deepEqual(Object.keys(reader.store.state.runs), [], 'canRead never receives the trusted authorization')
        } finally {
            reader.close()
            revoked.close()
        }
        restored.close()
        const terminal = open()
        assert.equal(terminal.store.state.runs[run.id].state, 'failed', 'trusted terminal outcome must survive native checkpoint restart')
        assert.equal(terminal.recovery.pending().length, 0)
        assert.equal(executions, 1, 'terminal reconciliation never reexecutes the extractor')
        const afterRestart = terminal.connection(account)
        try {
            assert.throws(() => afterRestart.fragment.createRun(request), /forbidden/)
            assert.throws(() => afterRestart.fragment.cancelRun(run.id), /forbidden/)
        } finally {afterRestart.close()}
        console.log('PROBE CONFIRMED: exact one-use synchronous failed-only reconciliation, denied reentry/read/write and durable failed restart')
        console.log('This is a native feasibility fixture, not a machine API implementation or Q05 acceptance.')
    } finally {
        for (const host of hosts.reverse()) host.close()
        const resolved = path.resolve(directory)
        if (!resolved.startsWith(path.resolve(fixtures) + path.sep)) throw new Error('Unexpected fixture path')
        await rm(resolved, {recursive: true, force: true})
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})

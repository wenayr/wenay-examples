import assert from 'node:assert/strict'
import {mkdtempSync, appendFileSync, readFileSync, rmSync} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawn} from 'node:child_process'
import {createAiRunHost, type AiRunRunner} from 'wenay-common2/ai'
import {openAiCheckpoint} from './ai-checkpoint'

const request = {requestId: 'one-intent', kind: 'fixture', input: {text: 'no paid calls'}}
async function child(directory: string) {
    const host = createAiRunHost({...openAiCheckpoint({directory}), runner: {async run() {
        appendFileSync(path.join(directory, 'effect.txt'), 'effect\n')
        process.send?.('effect-written')
        await new Promise(() => {})
    }}})
    host.connection('worker').fragment.createRun(request)
    setInterval(() => {}, 1000)
}

async function main() {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'wenay-ai-recovery-'))
    let effects = 0, allowed = true
    const runner: AiRunRunner = {
        async run(ctx) {
            effects++
            await ctx.waitForInput({label: 'Уточнение'})
            await ctx.requestApproval({kind: 'review', label: 'Подтверждение'})
            return {result: 'confirmed'}
        },
        async recover(ctx) {
            const input = ctx.checkpoint.inputs[0]
            assert.equal(await ctx.waitForInput({id: input.id, label: input.label}), 'retained answer')
            const approval = ctx.checkpoint.approvals[0]
            assert.equal(await ctx.requestApproval({id: approval.id, kind: approval.kind, label: approval.label}), 'approved')
            return {result: 'confirmed'}
        },
    }
    function open() {return createAiRunHost({...openAiCheckpoint({directory}), runner, policy: {canCreate: () => allowed, canWrite: () => allowed}})}
    let host = open()
    async function wait(check: () => boolean) {
        const deadline = Date.now() + 5000
        while (!check()) {assert(Date.now() < deadline, 'AI recovery wait timed out'); await new Promise(resolve => setTimeout(resolve, 10))}
    }
    try {
        let session = host.connection('worker')
        const run = session.fragment.createRun(request)
        session.fragment.provideInput(Object.keys(host.store.state.inputs)[0], 'retained answer')
        await wait(() => Object.keys(host.store.state.approvals).length == 1)
        session.close()
        host.close()
        appendFileSync(path.join(directory, 'runs.replay'), '{"t":"k","v":')
        host = open()
        session = host.connection('worker')
        assert.equal(session.fragment.createRun(request).id, run.id)
        assert.equal(host.recovery.pending()[0].run.recovery?.from, 'waiting_approval')
        assert.equal(effects, 1)
        assert.throws(() => session.fragment.createRun({...request, input: {text: 'changed'}}))
        allowed = false
        await assert.rejects(async () => host.recovery.resume(run.id))
        allowed = true
        const resumed = host.recovery.resume(run.id)
        session.fragment.resolveApproval(Object.keys(host.store.state.approvals)[0], 'approved')
        assert.equal((await resumed).result, 'confirmed')
        session.close()
        host.close()
        host = open()
        assert.equal(host.connection('worker').fragment.createRun(request).result, 'confirmed')
        assert.equal(effects, 1)
        let forbiddenEffects = 0
        const failed = createAiRunHost({runner: {run() {forbiddenEffects++}}, persistence: {commit() {throw new Error('disk unavailable')}}})
        assert.throws(() => failed.connection('worker').fragment.createRun(request), /disk unavailable/)
        assert.equal(forbiddenEffects, 0)
        failed.close()

        const childDirectory = path.join(directory, 'terminated')
        const processChild = spawn(process.execPath, ['--import', 'tsx', path.resolve('organizer/ai-persistence-check.ts'), '--child', childDirectory], {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc']})
        const exited = new Promise<void>(resolve => processChild.once('exit', () => resolve()))
        try {
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Child effect timed out')), 10000)
                processChild.once('message', function ready(value) {clearTimeout(timeout); value == 'effect-written' ? resolve() : reject(new Error('Unexpected child message'))})
                processChild.once('error', function failed(error) {clearTimeout(timeout); reject(error)})
            })
            processChild.kill('SIGKILL')
            await exited
            let repeated = 0
            const restored = createAiRunHost({...openAiCheckpoint({directory: childDirectory}), runner: {run() {repeated++}}})
            try {
                const saved = restored.connection('worker').fragment.createRun(request)
                assert.equal(saved.recovery?.from, 'running')
                assert.equal(repeated, 0)
                assert.equal(readFileSync(path.join(childDirectory, 'effect.txt'), 'utf8'), 'effect\n')
                restored.recovery.settle(saved.id, {state: 'completed', output: {result: 'effect reconciled'}})
                assert.equal(restored.connection('worker').fragment.createRun(request).result, 'effect reconciled')
            } finally {restored.close()}
        } finally {if (processChild.exitCode == null && processChild.signalCode == null) processChild.kill('SIGKILL'); await exited}
        console.log('PASS A1: durable receipt/input/approval, torn append, explicit recovery, current permissions, write-before-effect, terminated child and reconciled result; no paid calls')
    } finally {
        host.close()
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
        rmSync(directory, {recursive: true, force: true})
    }
}
const childIndex = process.argv.indexOf('--child')
void (childIndex >= 0 ? child(process.argv[childIndex + 1]) : main()).catch(function failed(error) {console.error(error); process.exitCode = 1})

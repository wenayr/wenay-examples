#!/usr/bin/env node
// =====================================================================
// pizzeria stand — leader + N serving nodes, all real OS processes
// =====================================================================
// Plain node. The orchestrator owns what an orchestrator owns: it mints the
// corridor secrets ONCE and hands them to every process through env, boots
// the leader, waits for its port, spawns the nodes, and stops everything on
// Ctrl+C. Importable: check.ts starts a stand on ephemeral ports.

import {randomBytes} from 'node:crypto'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createProcessResource} from 'wenay-common2/server/process'

const here = path.dirname(fileURLToPath(import.meta.url))

/** @param {{port?: number, nodes?: number, verbose?: boolean, signal?: AbortSignal}} [deps] */
export async function startStand({port = 0, nodes = 2, verbose = false, signal = undefined} = {}) {
    if (!Number.isInteger(nodes) || nodes < 0 || nodes > 8) throw new Error('nodes must be between 0 and 8')
    const secrets = {
        SERVICE_NODE_TOKEN: randomBytes(24).toString('hex'),
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'),
    }
    const children = []
    let closing
    function aborted() { void close() }
    signal?.addEventListener('abort', aborted, {once: true})
    function boot(script, env, pattern) {
        const resource = createProcessResource({
            command: process.execPath,
            args: ['--import', 'tsx', script],
            cwd: here,
            env: {...process.env, ...secrets, ...env},
            ipc: true,
            signal,
            startTimeoutMs: 20_000,
            stopTimeoutMs: 5_000,
            tailChars: 24_000,
            ready(fact) {
                if (fact.type == 'message') return
                if (verbose) process.stdout.write(fact.value)
                return pattern.exec(fact.tail)?.[1]
            },
            shutdown(child) {
                if (child.connected) child.send({type:'shutdown'}, function sent(error) {if (error) child.kill('SIGKILL')})
                else child.kill('SIGKILL')
            },
        })
        children.push(resource)
        resource.events.failure.on(function unexpectedExit() {
            if (!closing) { process.exitCode = 1; void close() }
        })
        return resource
    }
    function close() {
        if (closing) return closing
        signal?.removeEventListener('abort', aborted)
        closing = Promise.all(children.map(child=>child.close())).then(()=>undefined)
        return closing
    }
    try {
        if (signal?.aborted) throw new Error('stand startup cancelled')
        const leader = boot('leader-pizzeria.ts', {SERVICE_PORT: String(port)}, /leader listening on (http:\/\/localhost:\d+)/)
        const url = await leader.ready
        const nodeUrls = []
        for (let i = 0; i < nodes; i++) {
            const node = boot('node-pizzeria.ts', {SERVICE_NODE_ID: 'pizzeria-node-' + i, SERVICE_UPSTREAM: url, SERVICE_PORT: '0'}, /serving at (http:\/\/localhost:\d+)/)
            nodeUrls.push(await node.ready)
        }
        return {url, nodeUrls, close}
    } catch (error) {
        await close()
        throw error
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) == fileURLToPath(import.meta.url)) {
    const stop = new AbortController()
    function shutdown() { stop.abort() }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
    const stand = await startStand({port: Number(process.env.SERVICE_PORT ?? 3500), nodes: Number(process.env.PIZZERIA_NODES ?? 2), verbose: true, signal: stop.signal})
    console.log('Panel: ' + stand.url + '/panel')
    console.log('Swagger: ' + stand.url + '/docs')
    console.log('Reader endpoints: ' + [stand.url, ...stand.nodeUrls].join(', '))
}

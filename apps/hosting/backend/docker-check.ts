import assert from 'node:assert/strict'
import http from 'node:http'
import {randomBytes} from 'node:crypto'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createDockerResource, DeploymentRejected} from './docker'

async function main() {
    const operation = randomBytes(32).toString('hex')
    const socketPath = process.platform == 'win32' ? '\\\\.\\pipe\\wenay-check-'+operation : path.join(tmpdir(), 'wenay-'+operation+'.sock')
    let healthy = true
    const application = http.createServer(function app(_request, response) {
        response.writeHead(healthy ? 200 : 503)
        response.end('app')
    })
    await new Promise<void>(function start(resolve) {application.listen(0, '127.0.0.1', resolve)})
    const port = (application.address() as {port: number}).port
    let container: any = null
    let creates = 0
    let starts = 0
    let loseCreateReply = true
    const daemon = http.createServer(async function docker(request, response) {
        const url = new URL(request.url!, 'http://local')
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null
        response.setHeader('content-type', 'application/json')
        if (url.pathname.includes('/images/')) {
            response.end('{}')
            return
        }
        if (url.pathname.endsWith('/create')) {
            creates++
            assert.equal(body.HostConfig.Privileged, undefined)
            assert.equal(body.HostConfig.Memory, 256*1024*1024)
            assert.equal(body.HostConfig.PortBindings['8080/tcp'][0].HostIp, '127.0.0.1')
            container = {
                Id: operation,
                Config: body,
                State: {Running: false},
                NetworkSettings: {Ports: {'8080/tcp': [{HostIp: '127.0.0.1', HostPort: String(port)}]}}
            }
            if (loseCreateReply) {
                loseCreateReply = false
                request.socket.destroy()
                return
            }
            response.end(JSON.stringify({Id: operation}))
            return
        }
        if (url.pathname.endsWith('/start')) {
            starts++
            container.State.Running = true
            response.writeHead(204)
            response.end()
            return
        }
        if (request.method == 'DELETE') {
            container = null
            response.writeHead(204)
            response.end()
            return
        }
        if (url.pathname.endsWith('/json') && container) {
            response.end(JSON.stringify(container))
            return
        }
        response.writeHead(404)
        response.end('{}')
    })
    await new Promise<void>(function start(resolve) {daemon.listen(socketPath, resolve)})
    const docker = createDockerResource({socketPath, owner: 'test-agent', readinessMs: 250})
    const deployment = {operation, environment: 'staging', artifact: 'test/image@sha256:'+'a'.repeat(64)}
    const signal = new AbortController().signal
    try {
        await assert.rejects(docker.control.deploy(deployment, signal), /socket hang up|ECONNRESET/)
        const result = await docker.control.deploy(deployment, signal)
        assert.equal(result.endpoint, 'http://127.0.0.1:'+port)
        assert.equal(creates, 1, 'lost create reply reuses the existing deterministic container')
        await docker.control.deploy(deployment, signal)
        assert.equal(starts, 1, 'a healthy running candidate is not restarted')
        container.Config.Labels['wenay.owner'] = 'someone-else'
        await assert.rejects(docker.control.remove(deployment), /identity conflicts/)
        container.Config.Labels['wenay.owner'] = 'test-agent'
        healthy = false
        await assert.rejects(docker.control.deploy(deployment, signal), DeploymentRejected)
        await docker.control.remove(deployment)
        assert.equal(container, null)
        console.log('PASS Docker adapter contract: lost reply recovery, readiness, limits, ownership and targeted removal (HTTP fixture, not a real daemon)')
    } finally {
        application.closeAllConnections()
        daemon.closeAllConnections()
        await Promise.all([new Promise<void>(resolve => application.close(() => resolve())), new Promise<void>(resolve => daemon.close(() => resolve()))])
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})

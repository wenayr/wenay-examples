import express from 'express'
import {createServer} from 'node:http'
import {randomBytes} from 'node:crypto'
import {mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, openSync, closeSync, unlinkSync} from 'node:fs'
import path from 'node:path'
import {createHttpFacadeServer} from 'wenay-common2/server/http'
import {createProcess, type LocalProcess} from './process-resource'

type BranchConfig = {id: string, title: string, port: number, nodes: number, tokenSecret: string, nodeToken: string}
type ServingProcess = LocalProcess & {nodeId: string}
type Branch = {config: BranchConfig, authority: LocalProcess | null, url: string, nodes: ServingProcess[]}

// === Placement and lifetime belong to this local host; replication belongs to common2 ===

export async function startNetwork(deps: {dataDir: string, port?: number, branches?: {id: string, title: string, port: number, nodes: number}[]}) {
    const dataDir = path.resolve(deps.dataDir)
    mkdirSync(dataDir, {recursive: true})
    const lockPath = path.join(dataDir, 'network.lock')
    const lock = openSync(lockPath, 'wx')
    writeFileSync(lock, String(process.pid))
    const configPath = path.join(dataDir, 'network.json')
    const branches = new Map<string, Branch>()
    const app = express()
    const server = createServer(app)
    let closing: Promise<void> | undefined
    let networkUrl = ''
    const queues = new Map<string, Promise<unknown>>()
    function requireOpen() {if (closing) throw new Error('Network is closing')}
    function branchOf(id: string) {
        const branch = branches.get(id)
        if (!branch) throw new Error('Unknown location')
        return branch
    }
    function saveConfig() {
        const temporary = configPath + '.tmp'
        writeFileSync(temporary, JSON.stringify([...branches.values()].map(branch => branch.config), null, 2), {mode: 0o600})
        renameSync(temporary, configPath)
    }
    function environment(branch: Branch) {
        return {
            SERVICE_TOKEN_SECRET: branch.config.tokenSecret,
            SERVICE_NODE_TOKEN: branch.config.nodeToken,
            SERVICE_CORS_ORIGINS: networkUrl,
            SERVICE_DATA_DIR: path.join(dataDir, branch.config.id),
        }
    }
    async function startAuthority(branch: Branch) {
        requireOpen()
        branch.authority = createProcess({script: 'main.ts', env: {...environment(branch), SERVICE_PORT: String(branch.config.port)}})
        branch.url = await branch.authority.ready
        branch.config.port = Number(new URL(branch.url).port)
        requireOpen()
    }
    async function addNode(branch: Branch) {
        requireOpen()
        const nodeId = branch.config.id + '-node-' + randomBytes(5).toString('hex')
        const node = {...createProcess({script: 'serving-node.ts', env: {
            ...environment(branch), SERVICE_PORT: '0', SERVICE_UPSTREAM: branch.url,
            SERVICE_NODE_ID: nodeId,
        }}), nodeId}
        branch.nodes.push(node)
        try {
            await node.ready
            requireOpen()
        }
        catch (error) {
            await node.control.stop()
            branch.nodes = branch.nodes.filter(entry => entry != node)
            throw error
        }
    }
    async function drain(branch: Branch, nodes: ServingProcess[]) {
        if (!nodes.length) return
        const response = await fetch(branch.url + '/internal/nodes/drain', {
            method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + branch.config.nodeToken},
            body: JSON.stringify({ids: nodes.map(node => node.nodeId)}), signal: AbortSignal.timeout(5000),
        })
        if (!response.ok || !(await response.json()).ok) throw new Error('Could not withdraw serving nodes')
    }
    function serial<T>(id: string, run: () => Promise<T>) {
        requireOpen()
        const task = (queues.get(id) ?? Promise.resolve()).catch(function priorFailure() {}).then(run)
        queues.set(id, task)
        return task
    }
    function list() {
        return [...branches.values()].map(branch => ({
            id: branch.config.id,
            title: branch.config.title,
            url: branch.url,
            online: !!branch.authority && !branch.authority.view.stopped()
        }))
    }
    function status(id: string) {
        const branch = branchOf(id)
        return {...list().find(item => item.id==id)!, desiredNodes: branch.config.nodes,
            writerPid: branch.authority?.view.pid() ?? null,
            nodes: branch.nodes.map(node => ({id: node.nodeId, pid: node.view.pid(), online: !node.view.stopped()}))}
    }
    function scaleNodes(id: string, count: number) {
        if (!Number.isInteger(count) || count < 0 || count > 8) throw new Error('Node count must be between 0 and 8')
        return serial(id, async function resize() {
            const branch = branchOf(id)
            if (!branch.authority || branch.authority.view.stopped()) throw new Error('Location is offline')
            const live = branch.nodes.filter(node => !node.view.stopped())
            const removing = branch.nodes.filter(node => node.view.stopped() || live.indexOf(node) >= count)
            // Acknowledge withdrawal of every selected route before stopping the first process.
            await drain(branch, removing)
            await Promise.all(removing.map(node => node.control.stop()))
            branch.nodes = live.slice(0, count)
            while (branch.nodes.length < count) await addNode(branch)
            branch.config.nodes = count
            saveConfig()
            return status(id)
        })
    }
    function restart(id: string) {
        return serial(id, async function restartLocation() {
            const branch = branchOf(id)
            if (branch.authority && !branch.authority.view.stopped()) await drain(branch, branch.nodes)
            await Promise.all(branch.nodes.map(node => node.control.stop()))
            branch.nodes = []
            await branch.authority?.control.stop()
            await startAuthority(branch)
            for (let i = 0; i < branch.config.nodes; i++) await addNode(branch)
            saveConfig()
            return status(id)
        })
    }
    function close() {
        if (closing) return closing
        closing = (async function closeNetwork() {
            server.closeAllConnections()
            if (server.listening) await new Promise<void>(function closed(resolve) {server.close(function finished() {resolve()})})
            await Promise.allSettled([...queues.values()])
            const hosts = [...branches.values()].flatMap(function all(branch) {
                return [...branch.nodes, ...(branch.authority ? [branch.authority] : [])]
            })
            await Promise.all(hosts.map(host => host.control.stop()))
            closeSync(lock)
            unlinkSync(lockPath)
        })()
        return closing
    }
    try {
        const configured: BranchConfig[] = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) :
            (deps.branches ?? [{id: 'center', title: 'Печь · Центр', port: 3511, nodes: 1}, {id: 'north', title: 'Печь · Север', port: 3521, nodes: 1}])
                .map(branch => ({...branch, tokenSecret: randomBytes(32).toString('hex'), nodeToken: randomBytes(32).toString('hex')}))
        for (const config of configured) {
            if (!/^[a-z][a-z0-9_-]{0,40}$/.test(config.id) || branches.has(config.id)) throw new Error('Invalid or duplicate location ID')
            const port = Number.isInteger(config.port) && config.port >= 0 && config.port <= 65535
            const nodes = Number.isInteger(config.nodes) && config.nodes >= 0 && config.nodes <= 8
            if (!port || !nodes) throw new Error('Invalid location port or node count')
            if (!config.tokenSecret || !config.nodeToken) throw new Error('Location secrets are required')
            branches.set(config.id, {config, authority: null, url: '', nodes: []})
        }
        createHttpFacadeServer({app, object: {locations: {list}}, basePath: '/api', method: 'get'})
        // This is the same HTTP facade mechanism as the application REST surface.
        // The owner is checked against the target authority on every request.
        const owner = express.Router()
        owner.use(express.json({limit: '4kb'}))
        owner.use(async function ownerGate(req, res, next) {
            try {
                const id = req.method == 'GET' ? JSON.parse(String(req.query.args ?? '[]'))[0] : req.body?.args?.[0]
                const branch = branchOf(String(id))
                const response = await fetch(branch.url + '/api/pizzeria/me', {
                    headers: {authorization: req.get('authorization') ?? ''},
                    signal: AbortSignal.timeout(3000)
                })
                const me = await response.json()
                if (!me.ok || !me.value.roles.includes('owner')) {
                    res.status(403).json({ok: false, error: {message: 'Нужны права владельца этого заведения'}})
                    return
                }
                next()
            } catch {res.status(503).json({ok: false, error: {message: 'Не удалось проверить доступ к заведению'}})}
        })
        app.use('/api/owner', owner)
        createHttpFacadeServer({app, object: {owner: {status}}, basePath: '/api', method: 'get'})
        createHttpFacadeServer({app, object: {owner: {scaleNodes}}, basePath: '/api', method: 'post'})
        app.use(express.static(path.resolve(__dirname, '../public')))
        await new Promise<void>(function listen(resolve, reject) {
            server.once('error', reject)
            server.listen(deps.port ?? 3500, '127.0.0.1', function bound() {
                networkUrl = 'http://localhost:' + (server.address() as {port: number}).port
                resolve()
            })
        })
        for (const branch of branches.values()) {
            await startAuthority(branch)
            for (let i = 0; i<branch.config.nodes; i++) await addNode(branch)
        }
        saveConfig()
        return {
            url: networkUrl,
            view: {list, status},
            control: {scaleNodes, restart, close,
                async stopLocation(id: string) {
                    await serial(id, async function stopLocationProcesses() {
                        const branch = branchOf(id)
                        await Promise.all(branch.nodes.map(node => node.control.stop(true)))
                        branch.nodes = []
                        await branch.authority?.control.stop(true)
                    })
                },
                async stopNode(id: string, index: number) {
                    await serial(id, async function stopNodeProcess() {
                        const node = branchOf(id).nodes[index]
                        if (!node) throw new Error('Unknown node')
                        await node.control.stop(true)
                    })
                },
            },
        }
    } catch (error) {await close()
    throw error}
}

export type PizzeriaNetwork = Awaited<ReturnType<typeof startNetwork>>

if (require.main == module) {
    startNetwork({dataDir: process.env.PIZZERIA_NETWORK_DATA ?? path.resolve('network-data'), port: Number(process.env.SERVICE_PORT ?? 3500)})
        .then(function started(network) {
            console.log('Сеть пиццерий: ' + network.url)
            for (const branch of network.view.list()) console.log(branch.title + ': ' + branch.url)
            async function shutdown() {await network.control.close()}
            process.once('SIGINT', shutdown)
            process.once('SIGTERM', shutdown)
        }).catch(function failed(error) {console.error(error)
        process.exitCode = 1})
}

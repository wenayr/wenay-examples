import http from 'node:http'
import {setTimeout as pause} from 'node:timers/promises'
import {machineIdentity, type MachineSpec} from './machine-spec'

type Reply<T> = {type: 'sync' | 'async' | 'error', status_code: number, metadata: T, operation?: string, error_code?: number}
type Instance = {name: string, type: string, config: Record<string, string>, devices: Record<string, Record<string, string>>, profiles: string[], status_code: number}
export type MachineRequest = {id: string, project: string, spec: MachineSpec, providerName?: string}

export class MachineRejected extends Error {}

export function createLxdResource(deps: {socketPath: string, owner: string, project: string, pool: string, network: string, timeoutMs?: number}) {
    for (const value of [deps.owner, deps.project, deps.pool, deps.network]) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/.test(value)) throw new Error('invalid LXD resource configuration')
    }

    async function request<T>(method: string, pathname: string, signal: AbortSignal, body?: unknown): Promise<Reply<T>> {
        const payload = body == undefined ? undefined : JSON.stringify(body)
        const url = new URL(pathname, 'http://localhost')
        url.searchParams.set('project', deps.project)
        return new Promise(function call(resolve, reject) {
            const call = http.request({socketPath: deps.socketPath, path: url.pathname+url.search, method, signal,
                headers: payload ? {'content-type': 'application/json', 'content-length': Buffer.byteLength(payload)} : {},
            }, function response(response) {
                const chunks: Buffer[] = []
                let bytes = 0
                response.on('data', function data(chunk: Buffer) {
                    bytes += chunk.length
                    if (bytes > 4*1024*1024) {call.destroy(new Error('LXD response exceeded limit')); return}
                    chunks.push(chunk)
                })
                response.on('error', reject)
                response.on('end', function ended() {
                    try {
                        const reply = JSON.parse(Buffer.concat(chunks).toString()) as Reply<T>
                        if ((response.statusCode ?? 500) >= 400 || reply.type == 'error') {
                            reject(Object.assign(new Error('LXD API returned '+(reply.error_code ?? response.statusCode)), {status: reply.error_code ?? response.statusCode}))
                        } else resolve(reply)
                    } catch (error) {reject(error)}
                })
            })
            call.on('error', reject)
            call.end(payload)
        })
    }

    function deadline(signal?: AbortSignal) {return AbortSignal.any([AbortSignal.timeout(deps.timeoutMs ?? 120_000), ...(signal ? [signal] : [])])}

    async function complete(reply: Reply<unknown>, signal: AbortSignal) {
        if (reply.type != 'async' || !reply.operation) throw new Error('LXD mutation did not return an asynchronous operation')
        const url = new URL(reply.operation, 'http://localhost')
        if (url.origin != 'http://localhost' || !/^\/1\.0\/operations\/[a-f0-9-]+$/.test(url.pathname)) throw new Error('invalid LXD operation URL')
        while (true) {
            const result = await request<{status_code: number}>('GET', url.pathname+'/wait?timeout=5', signal)
            const code = result.metadata.status_code
            if (code == 200) return
            if (code >= 400) throw new MachineRejected('LXD operation failed (status '+code+')')
            await pause(100, undefined, {signal})
        }
    }

    async function inspect(name: string, signal: AbortSignal) {
        try {return (await request<Instance>('GET', '/1.0/instances/'+name, signal)).metadata}
        catch (error) {if ((error as {status?: number}).status == 404) return null; throw error}
    }

    function expected(machine: MachineRequest) {
        const identity = machineIdentity({...machine, owner: deps.owner})
        const config = {
            'user.wenay.owner': deps.owner, 'user.wenay.project': machine.project, 'user.wenay.machine': machine.id, 'user.wenay.spec': identity.fingerprint,
            'limits.cpu': String(machine.spec.cpus), 'limits.memory': machine.spec.memoryMiB+'MiB',
            'security.privileged': 'false', 'security.nesting': 'false',
            'cloud-init.user-data': '#cloud-config\n'+JSON.stringify({users: [{name: 'hosting', groups: ['sudo'], shell: '/bin/bash', sudo: ['ALL=(ALL) NOPASSWD:ALL'], lock_passwd: true, ssh_authorized_keys: [machine.spec.sshKey]}], ssh_pwauth: false, disable_root: true}),
        }
        // Container-only security options are rejected by the VM API.
        if (machine.spec.kind == 'virtual-machine') {
            delete (config as Partial<typeof config>)['security.privileged']
            delete (config as Partial<typeof config>)['security.nesting']
        }
        const devices = {root: {type: 'disk', path: '/', pool: deps.pool, size: machine.spec.diskGiB+'GiB'}, eth0: {type: 'nic', network: deps.network, name: 'eth0'}}
        function owned(instance: Instance) {
            if (instance.name != identity.name || instance.type != machine.spec.kind || instance.profiles.length || instance.config['volatile.base_image'] != machine.spec.image ||
                Object.entries(config).some(([key, value])=>instance.config[key] != value) ||
                Object.keys(instance.devices).length != 2 || Object.entries(devices).some(([key, values])=>Object.entries(values).some(([field, value])=>instance.devices[key]?.[field] != value))) {
                throw new MachineRejected('machine identity or configuration conflicts with the request')
            }
        }
        return {...identity, config, devices, owned}
    }

    async function preflight(kind: MachineSpec['kind'], signal?: AbortSignal) {
        const active = deadline(signal)
        const server = (await request<{auth: string, environment: {instance_types: string[]}}>('GET', '/1.0', active)).metadata
        if (server.auth != 'trusted' || !server.environment.instance_types.includes(kind)) throw new MachineRejected('LXD host does not support the requested instance type or access')
        await request('GET', '/1.0/storage-pools/'+deps.pool, active)
        const network = (await request<{managed: boolean, type: string}>('GET', '/1.0/networks/'+deps.network, active)).metadata
        if (!network.managed || network.type != 'bridge') throw new MachineRejected('an existing managed bridge network is required')
        return {kind, project: deps.project, pool: deps.pool, network: deps.network}
    }

    async function ensure(machine: MachineRequest, target: 'running' | 'stopped', signal?: AbortSignal) {
        if (target != 'running' && target != 'stopped') throw new MachineRejected('invalid machine target')
        const active = deadline(signal)
        const identity = expected(machine)
        let instance = await inspect(identity.name, active)
        if (!instance) {
            if (target == 'stopped' || machine.providerName) throw new MachineRejected('previously created machine is missing; explicit recovery is required')
            await preflight(machine.spec.kind, active)
            const image = (await request<{fingerprint: string, type: string}>('GET', '/1.0/images/'+machine.spec.image, active)).metadata
            if (image.fingerprint != machine.spec.image || image.type != machine.spec.kind) throw new MachineRejected('local image does not match requested fingerprint and type')
            try {
                await complete(await request('POST', '/1.0/instances', active, {name: identity.name, type: machine.spec.kind,
                    source: {type: 'image', fingerprint: machine.spec.image}, profiles: [], config: identity.config, devices: identity.devices,
                }), active)
            } catch (error) {
                if ((error as {status?: number}).status != 409) throw error
            }
            instance = await inspect(identity.name, active)
        }
        if (!instance) throw new Error('LXD instance is not observable yet')
        identity.owned(instance)
        const desired = target == 'running' ? 103 : 102
        // Re-entering after a lost reply observes an in-flight state instead of issuing a conflicting action.
        while (![102, 103].includes(instance.status_code)) {
            await pause(250, undefined, {signal: active})
            instance = await inspect(identity.name, active)
            if (!instance) throw new Error('LXD instance disappeared')
            identity.owned(instance)
        }
        if (instance.status_code != desired) {
            await complete(await request('PUT', '/1.0/instances/'+identity.name+'/state', active, {action: target == 'running' ? 'start' : 'stop', timeout: 30, force: false, stateful: false}), active)
        }
        instance = await inspect(identity.name, active)
        if (!instance) throw new Error('LXD instance disappeared after operation')
        identity.owned(instance)
        if (instance.status_code != desired) throw new Error('LXD state does not yet match target')
        return {providerName: identity.name, image: machine.spec.image, power: target, preparation: 'unverified' as const}
    }

    return {control: {ensure}, view: {preflight}}
}

export type LxdResource = ReturnType<typeof createLxdResource>

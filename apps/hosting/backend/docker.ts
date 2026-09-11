import http from 'node:http'
import {createHash} from 'node:crypto'
import {workload, type Workload} from './workload'

type Container = {Id: string, Config: {Image: string, Labels: Record<string, string>}, State: {Running: boolean}, NetworkSettings: {Ports: Record<string, {HostIp: string, HostPort: string}[] | null>}}
export type Deployment = {operation: string, environment: string, artifact: string, workload?: Workload}

export class DeploymentRejected extends Error {}

export function createDockerResource(deps: {socketPath: string, owner: string, readinessMs?: number, runtime?: (environment: string) => Promise<string[]>}) {
    function dataName(environment: string) {return 'wenay-data-' + createHash('sha256').update(JSON.stringify([deps.owner, environment])).digest('hex')}
    function nameOf(deployment: Deployment) {return deployment.workload?.dataVersion ? dataName(deployment.environment) + '-writer' : 'wenay-' + deployment.operation}
    async function request<T>(method: string, pathname: string, body?: unknown, signal?: AbortSignal): Promise<T> {
        const text = body == undefined ? undefined : JSON.stringify(body)
        return new Promise(function call(resolve, reject) {
            const call = http.request({socketPath: deps.socketPath, path: '/v1.47'+pathname, method,
                signal: AbortSignal.any([AbortSignal.timeout(120_000), ...(signal ? [signal] : [])]),
                headers: text ? {'content-type': 'application/json', 'content-length': Buffer.byteLength(text)} : {},
            }, function response(response) {
                let bytes = 0
                const chunks: Buffer[] = []
                response.on('data', function data(chunk: Buffer) {
                    bytes += chunk.length
                    if (bytes > 4*1024*1024) {call.destroy(new Error('Docker response exceeded limit')); return}
                    chunks.push(chunk)
                })
                response.on('error', reject)
                response.on('end', function ended() {
                    const raw = Buffer.concat(chunks).toString('utf8')
                    if ((response.statusCode ?? 500) >= 400) {
                        reject(Object.assign(new Error('Docker API returned '+response.statusCode), {status: response.statusCode}))
                        return
                    }
                    try {resolve((raw ? JSON.parse(raw) : undefined) as T)} catch (error) {reject(error)}
                })
            })
            call.on('error', reject)
            call.end(text)
        })
    }

    async function inspect(name: string, signal?: AbortSignal) {
        try {return await request<Container>('GET', '/containers/'+encodeURIComponent(name)+'/json', undefined, signal)}
        catch (error) {if ((error as {status?: number}).status == 404) return null; throw error}
    }

    function owned(container: Container, deployment: Deployment) {
        if (container.Config.Labels?.['wenay.owner'] != deps.owner || container.Config.Labels?.['wenay.operation'] != deployment.operation || container.Config.Labels?.['wenay.environment'] != deployment.environment || container.Config.Image != deployment.artifact) throw new Error('container identity conflicts with requested operation')
    }

    async function deploy(deployment: Deployment, signal: AbortSignal) {
        if (!/^[a-f0-9]{64}$/.test(deployment.operation)) throw new Error('invalid operation id')
        const profile = workload(deployment.workload ?? {})
        const name = nameOf(deployment)
        let container = await inspect(name, signal)
        if (!container) {
            // Pull is handled by the host preparation/build pipeline. A missing digest fails before creating a resource.
            await request('GET', '/images/'+encodeURIComponent(deployment.artifact)+'/json', undefined, signal).catch(function missing(error) {
                if (error.status == 404) throw new DeploymentRejected('Pinned image is not installed on the host')
                throw error
            })
            try {
                await request('POST', '/containers/create?name='+name, {
                    Image: deployment.artifact,
                    ...(profile.dataVersion ? {Env: ['SERVICE_PORT=' + profile.port, 'SERVICE_DATA_DIR=/data', ...(await deps.runtime?.(deployment.environment) ?? [])]} : {}),
                    Labels: {'wenay.owner': deps.owner, 'wenay.operation': deployment.operation, 'wenay.environment': deployment.environment},
                    ExposedPorts: {[profile.port+'/tcp']: {}},
                    HostConfig: {Memory: profile.memoryMiB*1024*1024, NanoCpus: Math.round(profile.cpus*1e9),
                        PortBindings: {[profile.port+'/tcp']: [{HostIp: '127.0.0.1', HostPort: '0'}]},
                        CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'], PidsLimit: 128,
                        ...(profile.dataVersion ? {Mounts: [{Type: 'volume', Source: dataName(deployment.environment), Target: '/data'}]} : {}),
                    },
                }, signal)
            } catch (error) {
                if ((error as {status?: number}).status != 409) throw error
            }
            container = await inspect(name, signal)
        }
        if (!container) throw new Error('Docker container not found after create')
        owned(container, deployment)
        if (!container.State.Running) await request('POST', '/containers/'+container.Id+'/start', undefined, signal)
        const deadline = Date.now()+(deps.readinessMs ?? 30_000)
        while (Date.now() < deadline) {
            signal.throwIfAborted()
            container = await inspect(name, signal)
            if (!container || !container.State.Running) throw new DeploymentRejected('Candidate stopped before readiness')
            owned(container, deployment)
            const binding = container.NetworkSettings.Ports[profile.port+'/tcp']?.find(item=>item.HostIp == '127.0.0.1')
            if (binding && /^\d+$/.test(binding.HostPort)) {
                const endpoint = 'http://127.0.0.1:'+binding.HostPort
                try {
                    const response = await fetch(endpoint+profile.healthPath, {redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(1000)])})
                    await response.body?.cancel()
                    if (response.ok) return {artifact: deployment.artifact, endpoint, resourceId: container.Id}
                } catch (error) {if (signal.aborted) throw error}
            }
            await new Promise<void>(function pause(resolve) {setTimeout(resolve, 200)})
        }
        throw new DeploymentRejected('Candidate did not pass readiness before deadline')
    }

    async function remove(deployment: Deployment) {
        if (!/^[a-f0-9]{64}$/.test(deployment.operation)) throw new Error('invalid operation id')
        const container = await inspect(nameOf(deployment))
        if (!container) return
        if (deployment.workload?.dataVersion && container.Config.Labels?.['wenay.owner'] == deps.owner && container.Config.Labels?.['wenay.environment'] == deployment.environment && container.Config.Labels?.['wenay.operation'] != deployment.operation) return
        owned(container, deployment)
        if (deployment.workload?.dataVersion && container.State.Running) await request('POST', '/containers/' + container.Id + '/stop?t=10')
        await request('DELETE', '/containers/'+container.Id+'?force=true')
    }

    async function observe(deployment: Deployment, signal?: AbortSignal) {
        if (!/^[a-f0-9]{64}$/.test(deployment.operation)) throw new Error('invalid operation id')
        const container = await inspect(nameOf(deployment), signal)
        if (!container) return null
        if (deployment.workload?.dataVersion && container.Config.Labels?.['wenay.operation'] != deployment.operation) return null
        owned(container, deployment)
        if (!container.State.Running) return null
        const profile = workload(deployment.workload ?? {})
        const binding = container.NetworkSettings.Ports[profile.port+'/tcp']?.find(item=>item.HostIp == '127.0.0.1')
        if (!binding || !/^[1-9][0-9]{0,4}$/.test(binding.HostPort) || Number(binding.HostPort) > 65535) return null
        return {endpoint: 'http://127.0.0.1:'+binding.HostPort}
    }

    return {control: {deploy, remove}, view: {observe, version: ()=>request<{Version: string, Os: string}>('GET', '/version')}}
}

export type DockerResource = ReturnType<typeof createDockerResource>

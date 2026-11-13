export const defaultWorkload = {port: 8080, healthPath: '/healthz', memoryMiB: 256, cpus: 1} as const
export type Workload = {port: number, healthPath: string, memoryMiB: number, cpus: number, dataVersion?: string}

export function workload(input: Partial<Workload>) {
    const value = {...defaultWorkload, ...Object.fromEntries(Object.entries(input).filter(([, value])=>value != undefined))} as Workload
    if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error('invalid application port')
    if (!/^\/[a-zA-Z0-9/_-]*$/.test(value.healthPath) || value.healthPath.length > 120) throw new Error('invalid health path')
    if (!Number.isInteger(value.memoryMiB) || value.memoryMiB < 32 || value.memoryMiB > 8192) throw new Error('memory must be 32..8192 MiB')
    if (!Number.isFinite(value.cpus) || value.cpus < 0.1 || value.cpus > 8) throw new Error('CPU limit must be 0.1..8')
    if (value.dataVersion != undefined && !/^[a-z][a-z0-9-]{0,62}$/.test(value.dataVersion)) throw new Error('invalid persistent data contract')
    return value
}

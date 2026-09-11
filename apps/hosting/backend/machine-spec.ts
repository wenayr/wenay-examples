import {createHash} from 'node:crypto'

export const machineKinds = ['container', 'virtual-machine'] as const
export type MachineSpec = {kind: typeof machineKinds[number], image: string, cpus: number, memoryMiB: number, diskGiB: number, sshKey: string}

export function validateMachineSpec(spec: MachineSpec) {
    if (!machineKinds.includes(spec.kind)) throw new Error('unsupported machine kind')
    if (!/^[a-f0-9]{64}$/.test(spec.image)) throw new Error('a complete local LXD image fingerprint is required')
    for (const [value, min, max] of [[spec.cpus, 1, 64], [spec.memoryMiB, 256, 262144], [spec.diskGiB, 2, 2048]]) {
        if (!Number.isInteger(value) || value < min || value > max) throw new Error('machine resource limit is out of range')
    }
    if (!/^ssh-ed25519 [A-Za-z0-9+/]{68}={0,2}( [^\r\n]{1,100})?$/.test(spec.sshKey)) throw new Error('an Ed25519 public SSH key is required')
    const raw = Buffer.from(spec.sshKey.split(' ')[1], 'base64')
    if (raw.length != 51 || raw.readUInt32BE(0) != 11 || raw.subarray(4, 15).toString() != 'ssh-ed25519' || raw.readUInt32BE(15) != 32) throw new Error('invalid Ed25519 public key')
}

export function machineIdentity(input: {owner: string, id: string, project: string, spec: MachineSpec}) {
    validateMachineSpec(input.spec)
    const spec = input.spec
    const fingerprint = createHash('sha256').update(JSON.stringify([spec.kind, spec.image, spec.cpus, spec.memoryMiB, spec.diskGiB, spec.sshKey])).digest('hex')
    const name = 'wenay-'+createHash('sha256').update(JSON.stringify([input.owner, input.project, input.id])).digest('hex').slice(0, 40)
    return {name, fingerprint}
}

import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {fingerprint} from './run-all.mjs'
import {dependencyLabel, inspectImageEvidence} from './hosting-live-gate.mjs'

const exec = promisify(execFile)
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = path.join(repository, 'work', 'hosting-live-images')
const manifestFile = path.join(outputDirectory, 'product-images.json')
export const products = ['organizer', 'pizzeria', 'support', 'metering', 'documents', 'crm', 'booking', 'forms', 'monitoring', 'approvals', 'content']

export function selectProducts(argv) {
    let only
    let plan = false
    for (const argument of argv) {
        if (argument == '--plan' && !plan) plan = true
        else if (argument.startsWith('--only=') && only == undefined) only = argument.slice(7)
        else throw new Error('Unknown or repeated parameter: ' + argument)
    }
    const requested = only?.split(',').map(value => value.trim())
    if (requested?.some(value => !products.includes(value))) throw new Error('Invalid --only product; choose: ' + products.join(','))
    if (requested && new Set(requested).size != requested.length) throw new Error('Repeated product in --only')
    return {selected: requested ? products.filter(value => requested.includes(value)) : products, plan}
}

function application(product) {return ['organizer', 'pizzeria'].includes(product) ? 'pizzeria' : product}

function buildArguments(product, release, dependencies) {
    const app = application(product)
    return ['build', '--memory', '768m', '--label', dependencyLabel + '=' + dependencies,
        '--build-arg', 'APP_RELEASE=' + release,
        ...(['organizer', 'pizzeria'].includes(product) ? ['--build-arg', 'APP_MODE=' + product] : []),
        '--tag', 'wenay-examples.local/' + product + ':' + release,
        '--file', path.join(repository, 'apps', app, 'Dockerfile'), path.join(repository, 'apps', app)]
}

async function pinnedDockerfile(product) {
    const dockerfile = await readFile(path.join(repository, 'apps', application(product), 'Dockerfile'), 'utf8')
    const bases = dockerfile.split(/\r?\n/).filter(line => /^FROM\s/i.test(line))
    if (!bases.length || bases.some(line => !/^FROM\s+[^\s]+@sha256:[a-f0-9]{64}(?:\s+AS\s+\w+)?\s*$/i.test(line))) {
        throw new Error('Dockerfile must retain exact pinned base images: ' + product)
    }
}

async function inspect(docker, reference, env) {
    const result = await exec(docker, ['image', 'inspect', reference], {env, windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024})
    const images = JSON.parse(result.stdout)
    if (images.length != 1 || !/^sha256:[a-f0-9]{64}$/.test(images[0]?.Id ?? '')) throw new Error('Invalid inspected image ID: ' + reference)
    return images[0]
}

async function evidence(docker, product, release, expectedDependencies, env) {
    const name = 'wenay-examples.local/' + product
    const tag = name + ':' + release
    const image = await inspect(docker, tag, env)
    if (!image.RepoTags?.includes(tag)) throw new Error('Built image does not retain its own tag: ' + tag)
    const digest = image.RepoDigests?.find(value => value.startsWith(name + '@sha256:') && /@sha256:[a-f0-9]{64}$/.test(value))
    if (!digest) throw new Error('Built image has no RepoDigest in its own namespace: ' + tag)
    const checked = inspectImageEvidence({reference: digest, image: {...image, RepoDigests: [digest]}, expectedDependencies, requireDigestReference: true})
    if (checked.reason) throw new Error(checked.reason)
    const pinned = await inspect(docker, digest, env)
    if (pinned.Id != image.Id || pinned.Config?.Labels?.[dependencyLabel] != expectedDependencies) {
        throw new Error('Digest resolves to a different image or dependency label: ' + digest)
    }
    return checked.evidence
}

async function saveManifest(manifest) {
    await mkdir(outputDirectory, {recursive: true})
    const temporary = path.join(outputDirectory, 'product-images-' + randomUUID() + '.tmp')
    try {
        await writeFile(temporary, JSON.stringify(manifest, null, 4) + '\n', {flag: 'wx'})
        await rename(temporary, manifestFile)
    } finally {
        await unlink(temporary).catch(function missing(error) {if (error.code != 'ENOENT') throw error})
    }
}

export async function prepareLiveImages(argv) {
    const {selected, plan} = selectProducts(argv)
    const docker = process.env.DOCKER_BIN ?? 'docker'
    const env = {...process.env}
    if (path.isAbsolute(docker)) env.PATH = path.dirname(docker) + path.delimiter + (env.PATH ?? '')
    const dependencies = new Map(selected.map(product => [product, fingerprint(application(product))]))
    for (const product of selected) await pinnedDockerfile(product)
    if (plan) {
        for (const product of selected) for (const release of ['first', 'second']) {
            console.log(JSON.stringify({command: docker, args: buildArguments(product, release, dependencies.get(product))}))
        }
        console.log('Manifest after verified builds: ' + manifestFile)
        console.log('PLAN ONLY: no Docker calls or file writes; application build outputs must already be prepared.')
        return
    }
    const manifest = {}
    for (const product of selected) for (const release of ['first', 'second']) {
        console.log('Building ' + product + ':' + release)
        await exec(docker, buildArguments(product, release, dependencies.get(product)), {
            cwd: repository, env, windowsHide: true, timeout: 600000, maxBuffer: 16 * 1024 * 1024
        })
        if (fingerprint(application(product)) != dependencies.get(product)) throw new Error('Dependencies changed during build: ' + product)
        const verified = await evidence(docker, product, release, dependencies.get(product), env)
        manifest[product + '-' + release] = verified.digest
        console.log(JSON.stringify({product, release, ...verified}))
    }
    for (const product of selected) if (fingerprint(application(product)) != dependencies.get(product)) {
        throw new Error('Dependencies changed before manifest publication: ' + product)
    }
    await saveManifest(manifest)
    console.log('Verified manifest: ' + manifestFile)
    console.log('Live gate argument: --images=' + manifestFile)
}

if (process.argv[1] && path.resolve(process.argv[1]) == fileURLToPath(import.meta.url)) {
    prepareLiveImages(process.argv.slice(2)).catch(function failed(error) {
        console.error(error.message)
        process.exitCode = 1
    })
}

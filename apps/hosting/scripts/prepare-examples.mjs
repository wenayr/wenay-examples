import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {existsSync} from 'node:fs'
import {mkdir, writeFile} from 'node:fs/promises'
import {randomBytes} from 'node:crypto'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const exec = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktopCli = path.join(process.env.LOCALAPPDATA ?? '', 'Programs/DockerDesktop/resources/bin/docker.exe')
const docker = process.env.DOCKER_BIN ?? (process.platform == 'win32' && existsSync(desktopCli) ? desktopCli : 'docker')
const pathKey = Object.keys(process.env).find(key=>key.toLowerCase() == 'path') ?? 'PATH'
const env = {...process.env}
// Existing desktop sessions may predate installation; the CLI also needs its credential helper on PATH.
if (path.isAbsolute(docker)) env[pathKey] = path.dirname(docker)+path.delimiter+(process.env[pathKey] ?? '')
const runId = randomBytes(6).toString('hex')

async function run(args) {
    const result = await exec(docker, args, {cwd: root, env, windowsHide: true, timeout: 600_000, maxBuffer: 8*1024*1024})
    return result.stdout.trim()
}

async function main() {
    await run(['info', '--format', '{{.OSType}}']).then(function linux(value) {if (value != 'linux') throw new Error('Linux Docker Engine is required')})
    const images = {}
    for (const runtime of ['node', 'python']) {
        const repository = 'wenay-examples.local/'+runtime
        const tag = repository+':'+runId
        console.log('Building '+runtime+' example')
        await run(['build', '-t', tag, path.join(root, 'examples', runtime)])
        const image = JSON.parse(await run(['image', 'inspect', tag]))[0]
        const digest = image.RepoDigests?.find(value=>value.startsWith(repository+'@sha256:'))
        if (!digest) throw new Error('Local manifest digest is missing for '+runtime+'. Use a containerd image store or supply previously pulled HOSTING_NODE_IMAGE/HOSTING_PYTHON_IMAGE to test:docker.')
        // Verify the exact reference that the agent will use; never substitute the image config ID for a manifest digest.
        await run(['image', 'inspect', digest])
        images[runtime] = digest
    }
    await mkdir(path.join(root, 'data'), {recursive: true})
    await writeFile(path.join(root, 'data/example-images.json'), JSON.stringify(images, null, 4))
    console.log('Pinned local Node/Python images prepared without a registry. Run npm run test:docker.')
}

main().catch(function failed(error) {console.error(error.message); process.exitCode = 1})

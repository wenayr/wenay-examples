import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const exec = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.resolve(root, '../pizzeria')
const images = {}
for (const mode of ['organizer', 'pizzeria']) {
    for (const release of ['first', 'second']) {
        const tag = 'wenay-examples.local/' + mode + ':' + release
        console.log('Build', mode, release)
        await exec('docker', ['build', '--memory', '768m', '--build-arg', 'APP_MODE=' + mode, '--build-arg', 'APP_RELEASE=' + release, '-t', tag, source], {
            windowsHide: true,
            timeout: 600000,
            maxBuffer: 8 * 1024 * 1024
        })
        const result = await exec('docker', ['image', 'inspect', tag, '--format', '{{index .RepoDigests 0}}'], {windowsHide: true})
        images[mode + '-' + release] = result.stdout.trim()
    }
}
await mkdir(path.join(root, 'data'), {recursive: true})
await writeFile(path.join(root, 'data/product-images.json'), JSON.stringify(images, null, 4))
console.log('Pinned product images prepared. No application container started.')

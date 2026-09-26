import assert from 'node:assert/strict'
import {mkdtemp, mkdir, writeFile, unlink, realpath, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {measureBundle} from './status.mjs'

const temporary = await realpath(tmpdir())
const directory = await mkdtemp(path.join(temporary, 'wenay-bundle-status-'))

async function put(root, name, content) {
    const file = path.join(root, name)
    await mkdir(path.dirname(file), {recursive: true})
    await writeFile(file, content)
}

try {
    const first = path.join(directory, 'pizza')
    const second = path.join(directory, 'organizer')
    const graph = {
        'index.html': {file: 'assets/entry.js', isEntry: true, imports: ['shared'], dynamicImports: ['lazy'], css: ['assets/entry.css']},
        shared: {file: 'assets/shared.js', imports: ['index.html'], css: ['assets/base.css']},
        lazy: {file: 'assets/lazy.js', imports: ['shared'], dynamicImports: ['nested'], css: ['assets/lazy.css', 'assets/base.css']},
        nested: {file: 'assets/nested.js', imports: ['shared']},
        unused: {file: 'assets/unused.js', isEntry: true, css: ['assets/unused.css']}
    }
    const sizes = {'entry.js': 10, 'shared.js': 20, 'entry.css': 7, 'base.css': 5, 'lazy.js': 30, 'lazy.css': 11, 'nested.js': 40,
        'unused.js': 900, 'unused.css': 800, 'old.js': 700}
    for (const [name, size] of Object.entries(sizes)) await put(first, 'assets/' + name, Buffer.alloc(size))
    await put(first, 'index.html', '<script src="/assets/entry.js"></script><link rel="modulepreload" href="/assets/shared.js">'
        + '<link href="/assets/entry.css"><link href="/assets/entry.css"><script src="https://cdn.example/external.js"></script>')
    const manifest = '.vite/manifest.json'
    await put(first, manifest, JSON.stringify(graph))
    assert.deepEqual(measureBundle([first]), {initial: 42, total: 123, largest: 40, complete: true})
    await put(second, 'index.html', "<script src='/assets/entry.js'></script><link href='/assets/entry.css'>")
    await put(second, 'assets/entry.js', Buffer.alloc(100))
    await put(second, 'assets/entry.css', Buffer.alloc(10))
    const other = {'index.html': {file: 'assets/entry.js', css: ['assets/entry.css']}}
    await put(second, manifest, JSON.stringify(other))
    assert.deepEqual(measureBundle([first, second]), {initial: 152, total: 233, largest: 100, complete: true})
    await unlink(path.join(second, manifest))
    assert.deepEqual(measureBundle([first, second]), {initial: 152, total: 0, largest: 0, complete: false})
    await put(second, manifest, JSON.stringify(other))
    await unlink(path.join(second, 'assets/entry.js'))
    assert.throws(() => measureBundle([second]), /Bundle asset missing/)
    await put(second, 'assets/entry.js', Buffer.alloc(100))
    await put(second, manifest, JSON.stringify({'index.html': {...other['index.html'], imports: ['missing']}}))
    assert.throws(() => measureBundle([second]), /missing chunk/)
    await put(second, manifest, JSON.stringify({'index.html': {...other['index.html'], css: ['../../outside.css']}}))
    assert.throws(() => measureBundle([second]), /escapes output/)
    assert.equal(measureBundle([path.join(directory, 'missing-ui')]).complete, false)
    console.log('PASS bundle graph: static vs dynamic imports, nested chunks, CSS, cycles, deduplication, two UI roots,')
    console.log('  unused/stale assets excluded; absent manifest stays unknown; missing assets/chunks and escaping paths fail')
} finally {
    assert.equal(path.dirname(await realpath(directory)), temporary)
    assert(path.basename(directory).startsWith('wenay-bundle-status-'))
    await rm(directory, {recursive: true, force: true})
}

import {cp, readFile, writeFile, mkdir} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const at = process.argv.indexOf('--destination')
const target = at >= 0 ? process.argv[at + 1] : null
if (!target || !path.isAbsolute(target) || path.resolve(target) == path.resolve(root)) throw new Error('Укажите отдельный абсолютный --destination.')
const manifest = JSON.parse(await readFile(path.join(target, '.openai/hosting.json'), 'utf8'))
if (!manifest.project_id) throw new Error('В Site checkout должен уже существовать project_id.')
const entries = ['backend', 'frontend', 'src', 'scripts', 'demo', 'test', 'docs', 'public',
    'GUIDE.md', 'AGENTS.md', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.mjs', 'server.mjs']
function sourceOnly(filename) {
    const name = path.basename(filename)
    const runtime = ['node_modules', '.git', '.cache', 'dist', 'travel-data'].includes(name)
    return !runtime && !name.startsWith('.env') && !/\.(sqlite|sqlite3|db)(-wal|-shm)?$/.test(name)
}
await mkdir(target, {recursive: true})
for (const entry of entries) await cp(path.join(root, entry), path.join(target, entry), {recursive: true, filter: sourceOnly})
const pkg = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'))
pkg.scripts = {...pkg.scripts, dev: 'node scripts/preview-hosted.mjs', build: 'node scripts/build-hosted.mjs'}
delete pkg.scripts.prebuild
await writeFile(path.join(target, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
const ignorePath = path.join(target, '.gitignore')
const previousIgnore = await readFile(ignorePath, 'utf8').catch(() => '')
const ignored = new Set(previousIgnore.split('\n').filter(Boolean))
for (const entry of ['node_modules/', 'dist/', '.cache/', 'travel-data/', '.env*']) ignored.add(entry)
await writeFile(ignorePath, [...ignored].join('\n') + '\n')
await writeFile(path.join(target, 'SOURCE.md'), '# Wenay Travel\n\nСамостоятельная копия приложения `apps/travel` из `wenayr/wenay-examples`, ветка `demo/travel-flexible-dates`.\n\nУстановите точные зависимости командой `npm ci`, затем `npm run build`. `npm run dev` запускает настоящий Worker.fetch через Node HTTP для managed preview.\n\nSite identity сохраняется в `.openai/hosting.json`. Секреты и пользовательские runtime-данные не копируются.\n')
console.log(JSON.stringify({checkout: target, projectId: manifest.project_id, entries: entries.length, independentSource: true}))
